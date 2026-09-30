-- El reparto del pago de un cliente entre sus facturas pendientes.
--
-- La 0012 creó dónde vive el dinero; esta pone quién lo reparte, y lo pone
-- dentro de PostgreSQL a propósito. Hacerlo desde React obliga a leer el
-- saldo, decidir, y escribir en varias llamadas: entre la lectura y la
-- escritura cabe otro cajero cobrándole al mismo cliente, y entre una
-- escritura y la siguiente cabe que se caiga la red. Lo primero cobra de
-- más; lo segundo deja el dinero aplicado a medias. Ninguna de las dos se
-- arregla con cuidado, solo con una transacción.
--
-- Todo lo que decide la operación se resuelve aquí: la empresa, el usuario,
-- la deuda, qué facturas y en qué orden. Del navegador solo llegan el
-- cliente, el monto, la clave del intento y una nota.

-- ─────────────────────────────────────────────────────────
-- EL RENGLÓN GUARDA SU ANTES Y DESPUÉS
-- ─────────────────────────────────────────────────────────
/*
  Cuánto debía esa factura justo antes de este pago, y cuánto quedó.
  Sin esto, reconstruir el reparto de un pago ya registrado obliga a sumar
  los abonos anteriores ordenándolos por fecha, y dos abonos del mismo
  instante hacen que el resultado dependa de cuál salga primero.

  Nullable porque el abono contra una factura suelta no los tiene y sigue
  siendo válido. Sin backfill: a los que ya existan no se les puede
  inventar un pasado.
*/
alter table abonos
  add column if not exists saldo_anterior numeric(12,2),
  add column if not exists saldo_posterior numeric(12,2);

-- ─────────────────────────────────────────────────────────
-- LA FUNCIÓN
-- ─────────────────────────────────────────────────────────

create or replace function registrar_pago_cliente(
  p_cliente_id         uuid,
  p_monto              numeric,
  p_clave_idempotencia text default null,
  p_nota               text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_empresa      uuid;
  v_usuario      uuid;
  v_monto        numeric(12,2);
  v_deuda        numeric(12,2);
  v_restante     numeric(12,2);
  v_aplicado     numeric(12,2);
  v_pago         pagos%rowtype;
  v_factura      record;
  v_aplicaciones jsonb := '[]'::jsonb;
begin
  /*
    SECURITY DEFINER es necesario: la función escribe en pagos, abonos y
    ventas dentro de una sola transacción y necesita ver la deuda entera
    del cliente para calcularla bien. Pero eso apaga RLS, así que la
    empresa NO se acepta como parámetro: se deriva del usuario autenticado
    con la misma función que usan todas las políticas del esquema. Un
    llamador no puede pedir que se le cobre a otra empresa porque no hay
    dónde decirlo.
  */
  v_empresa := empresa_del_usuario();

  if v_empresa is null then
    raise exception 'Solo un usuario activo de una empresa puede registrar pagos'
      using errcode = '42501';
  end if;

  select id into v_usuario
    from usuarios
   where auth_id = auth.uid()
     and activo
   limit 1;

  if p_monto is null then
    raise exception 'El monto del pago es obligatorio'
      using errcode = '22023';
  end if;

  v_monto := round(p_monto, 2);

  if v_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor que cero'
      using errcode = '22023';
  end if;

  /*
    El candado de la cuenta.

    Se toma sobre la fila del cliente y no sobre la empresa: dos cajeros
    cobrándole a dos clientes distintos no tienen por qué esperarse. Y se
    toma ANTES de mirar la deuda, que es lo que hace segura la operación:
    mientras esta transacción lo tenga, otra que venga a cobrarle al mismo
    cliente se queda esperando aquí, y cuando entre volverá a calcular la
    deuda —ya con el pago anterior descontado— en vez de repartir un saldo
    que ya no existe.

    Sirve además de cierre para la idempotencia: la comprobación de la
    clave y la inserción quedan las dos dentro del candado, así que no hace
    falta confiar en chocar contra el índice único para no duplicar. El
    índice sigue ahí como última defensa, no como mecanismo.
  */
  perform 1
     from clientes
    where id = p_cliente_id
      and empresa_id = v_empresa
      for update;

  if not found then
    raise exception 'El cliente no existe en esta empresa'
      using errcode = '42501';
  end if;

  -- ── ¿ya se registró este mismo intento? ──
  if p_clave_idempotencia is not null then
    select * into v_pago
      from pagos
     where empresa_id = v_empresa
       and clave_idempotencia = p_clave_idempotencia;

    if found then
      /*
        Reintento legítimo: se devuelve lo que ya se hizo y no se cobra
        otra vez. Pero si la clave viene con otro cliente o con otro monto
        no es un reintento, es un error de quien llama, y devolver el pago
        viejo lo disfrazaría de éxito.
      */
      if v_pago.cliente_id <> p_cliente_id or v_pago.monto <> v_monto then
        raise exception
          'La clave % ya se usó para un pago distinto de esta empresa',
          p_clave_idempotencia
          using errcode = 'LC003';
      end if;

      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'venta_id',               a.venta_id,
                 'numero_factura',         v.numero_factura,
                 'correlativo',            v.correlativo,
                 'monto_aplicado',         a.monto,
                 'saldo_anterior_factura', a.saldo_anterior,
                 'saldo_posterior_factura', a.saldo_posterior
               )
               order by v.fecha, v.correlativo, v.id
             ), '[]'::jsonb)
        into v_aplicaciones
        from abonos a
        join ventas v on v.id = a.venta_id
       where a.pago_id = v_pago.id;

      return jsonb_build_object(
        'pago_id',         v_pago.id,
        'cliente_id',      v_pago.cliente_id,
        'monto',           v_pago.monto,
        'saldo_anterior',  v_pago.saldo_anterior,
        'saldo_posterior', v_pago.saldo_posterior,
        'fecha',           v_pago.fecha,
        'repetido',        true,
        'aplicaciones',    v_aplicaciones
      );
    end if;
  end if;

  /*
    Las facturas que entran en la deuda quedan bloqueadas antes de sumarlas.
    El candado del cliente ya serializa a otro pago consolidado; este
    protege además contra que alguien cierre o cambie una de estas facturas
    por otro camino mientras se reparte.

    Una factura anulada no se debe (D7), y una de contado nació saldada.
  */
  perform 1
     from ventas
    where empresa_id = v_empresa
      and cliente_id = p_cliente_id
      and forma_pago = 'credito'
      and estado <> 'anulada'
      for update;

  /*
    La deuda se calcula aquí y ahora, nunca se recibe. El saldo de una
    factura es su total menos lo abonado, que es exactamente la regla que
    ya usa el resto del sistema; cuentan todos sus abonos, incluidos los
    que no tienen pago_id porque se registraron contra la factura suelta.

    Solo suman las que deben algo: una factura sobrepagada por el camino
    viejo no puede restarle deuda a las demás.
  */
  select coalesce(sum(s.saldo), 0)
    into v_deuda
    from (
      select round(
               v.total - coalesce((
                 select sum(a.monto) from abonos a where a.venta_id = v.id
               ), 0), 2) as saldo
        from ventas v
       where v.empresa_id = v_empresa
         and v.cliente_id = p_cliente_id
         and v.forma_pago = 'credito'
         and v.estado <> 'anulada'
    ) s
   where s.saldo > 0;

  if v_deuda <= 0 then
    raise exception 'El cliente no tiene deuda pendiente'
      using errcode = 'LC002';
  end if;

  /*
    El sobrepago se rechaza entero (D2): ni se aplica una parte, ni se
    recorta el monto, ni se guarda a favor. El check de la 0012 volvería a
    atraparlo al insertar, pero llegar hasta ahí daría un mensaje sobre
    saldos negativos en vez de decir lo que pasó.
  */
  if v_monto > v_deuda then
    raise exception
      'El pago de % supera la deuda del cliente, que es de %',
      to_char(v_monto, 'FM999999990.00'), to_char(v_deuda, 'FM999999990.00')
      using errcode = 'LC001';
  end if;

  insert into pagos (
    empresa_id, cliente_id, usuario_id,
    monto, saldo_anterior, saldo_posterior,
    nota, clave_idempotencia
  )
  values (
    v_empresa, p_cliente_id, v_usuario,
    v_monto, v_deuda, round(v_deuda - v_monto, 2),
    coalesce(p_nota, ''), p_clave_idempotencia
  )
  returning * into v_pago;

  v_restante := v_monto;

  /*
    FIFO: la más vieja primero (D1). El desempate por correlativo es
    necesario porque fecha es un timestamp y dos facturas del mismo
    instante quedarían en un orden que decide el planificador; el id lo
    cierra del todo para que el reparto sea reproducible siempre.
  */
  for v_factura in
    select v.id,
           v.numero_factura,
           v.correlativo,
           round(
             v.total - coalesce((
               select sum(a.monto) from abonos a where a.venta_id = v.id
             ), 0), 2) as saldo
      from ventas v
     where v.empresa_id = v_empresa
       and v.cliente_id = p_cliente_id
       and v.forma_pago = 'credito'
       and v.estado <> 'anulada'
     order by v.fecha asc, v.correlativo asc, v.id asc
  loop
    exit when v_restante <= 0;

    if v_factura.saldo <= 0 then
      continue;
    end if;

    v_aplicado := least(v_restante, v_factura.saldo);

    -- Un abono de cero no dice nada y ensuciaría el historial.
    if v_aplicado <= 0 then
      continue;
    end if;

    insert into abonos (
      empresa_id, venta_id, usuario_id, monto, nota, pago_id,
      saldo_anterior, saldo_posterior
    )
    values (
      v_empresa, v_factura.id, v_usuario, v_aplicado, coalesce(p_nota, ''),
      v_pago.id,
      v_factura.saldo, round(v_factura.saldo - v_aplicado, 2)
    );

    -- El estado lo decide el saldo, no quien llama (D3).
    if round(v_factura.saldo - v_aplicado, 2) <= 0 then
      update ventas set estado = 'pagada' where id = v_factura.id;
    end if;

    v_aplicaciones := v_aplicaciones || jsonb_build_object(
      'venta_id',                v_factura.id,
      'numero_factura',          v_factura.numero_factura,
      'correlativo',             v_factura.correlativo,
      'monto_aplicado',          v_aplicado,
      'saldo_anterior_factura',  v_factura.saldo,
      'saldo_posterior_factura', round(v_factura.saldo - v_aplicado, 2)
    );

    v_restante := round(v_restante - v_aplicado, 2);
  end loop;

  /*
    No debería poder pasar: el monto ya se comparó contra la deuda, que es
    la suma de estos mismos saldos. Si pasara, significa que la deuda se
    calculó sobre un conjunto distinto del que se recorrió, y entonces lo
    correcto es deshacerlo todo y no dejar un pago que no cuadra.
  */
  if v_restante > 0 then
    raise exception
      'Quedaron % sin aplicar de un pago de %; la operación se deshace',
      to_char(v_restante, 'FM999999990.00'), to_char(v_monto, 'FM999999990.00')
      using errcode = 'LC004';
  end if;

  return jsonb_build_object(
    'pago_id',         v_pago.id,
    'cliente_id',      v_pago.cliente_id,
    'monto',           v_pago.monto,
    'saldo_anterior',  v_pago.saldo_anterior,
    'saldo_posterior', v_pago.saldo_posterior,
    'fecha',           v_pago.fecha,
    'repetido',        false,
    'aplicaciones',    v_aplicaciones
  );
end;
$$;

-- ─────────────────────────────────────────────────────────
-- QUIÉN PUEDE LLAMARLA
-- ─────────────────────────────────────────────────────────
/*
  PostgreSQL da EXECUTE a PUBLIC en cada función nueva, y Supabase publica
  el esquema public como API. Sin revocar, esta función quedaría colgando
  de /rest/v1/rpc/ al alcance de cualquiera con la clave anónima.

  Se revoca primero a PUBLIC —que es de donde lo heredan todos— y después
  explícitamente a anon, para que quede escrito y no dependa de que nadie
  se lo vuelva a conceder. Dentro, empresa_del_usuario() ya devolvería nulo
  para un anónimo; esto es la puerta de fuera.

  El permiso configurable por usuario es de otra fase: aquí cualquier
  usuario autenticado y activo de la empresa puede cobrar, que es lo que ya
  podía hacer contra una factura suelta.
*/
revoke all on function registrar_pago_cliente(uuid, numeric, text, text) from public;
revoke all on function registrar_pago_cliente(uuid, numeric, text, text) from anon;

grant execute on function registrar_pago_cliente(uuid, numeric, text, text) to authenticated;
