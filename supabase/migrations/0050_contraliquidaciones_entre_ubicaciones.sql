-- Pedidos interubicación, etapa C2b: contraliquidaciones, reembolsos desde una
-- tercera ubicación y obligaciones entre ubicaciones en cualquier sentido.
--
-- La regla: el sistema representa dónde está el efectivo de un pedido
-- cancelado y quién lo desembolsó de verdad. Para cada ubicación:
--
--   conserva = cobrado en efectivo
--            + recibido por liquidaciones confirmadas
--            − entregado por liquidaciones confirmadas
--            − devuelto en efectivo al cliente
--
-- Las ubicaciones que quedaron en negativo (devolvieron más de lo que tenían)
-- reciben de las que quedaron en positivo. Lo que sobra entre todas es lo que
-- falta devolver al cliente: no es deuda entre ubicaciones. Las obligaciones
-- no se guardan: se calculan de los cobros, las liquidaciones confirmadas y los
-- reembolsos, que ya están registrados y no se modifican. Así no se duplican ni
-- se desfasan, y un reintento no puede crearlas dos veces.
--
-- Una obligación se paga con una liquidación como las de siempre
-- (liquidaciones_ubicacion), solo que en el sentido que toque: el destino puede
-- entregarle al origen (contraliquidación) y cualquiera puede deberle a una
-- tercera ubicación. Se registra, se confirma o se rechaza igual que antes. La
-- liquidación original no se toca.
--
-- Decisiones del propietario (2026-11-19):
-- - cuando queda dinero por devolver al cliente y varias ubicaciones conservan
--   efectivo, lo que se le debe a quien devolvió lo cubre primero la ubicación
--   que cobró; después el origen, el destino y las demás por nombre. Quien
--   recibe se atiende en el mismo orden (origen, destino, y las demás por su
--   primera devolución);
-- - mientras el pedido tenga una liquidación por confirmar no se registran
--   reembolsos en efectivo (PI013);
-- - el efectivo se puede devolver desde una tercera ubicación solo si lo
--   registra el administrador, con referencia y si esa ubicación está
--   activa (PI015);
-- - las obligaciones opuestas no se compensan solas.
--
-- Cambian las reglas de la 0049:
-- - un pedido con efectivo en una liquidación confirmada ya se puede cancelar.
--   Con una por confirmar, no (PI013);
-- - el rechazo y la resolución de C1 siguen bloqueados con liquidaciones por
--   confirmar o confirmadas (liquidaciones_del_pedido no cambia).
--
-- Una contraliquidación no es venta, cobro, abono ni ingreso: no toca facturas,
-- cuentas por cobrar ni inventario. C2b no anula facturas: un pedido facturado
-- sigue sin poder cancelarse (C3).
--
-- Sin tablas nuevas. No cambia ninguna fila existente. Idempotente.

-- ─────────────────────────────────────────────────────────
-- LAS OBLIGACIONES
-- ─────────────────────────────────────────────────────────
/*
  Una fila por pedido y por sentido: quién debe (origen_id) y quién recibe
  (destino_id), con el pedido real en pedido_origen_id y pedido_destino_id.

  - Pedido activo (pendiente o facturado en otra ubicación): lo de siempre. El
    origen le debe al destino el efectivo que cobró (motivo «cobro»).
  - Pedido cancelado: lo que resulte de dónde quedó el efectivo (motivo
    «cancelacion»). `efectivo` es lo que se debe más lo ya liquidado después
    de cancelar; `liquidado` y `por_confirmar` son las liquidaciones de ese
    sentido registradas después de cancelar. Las de antes de cancelar ya
    están en lo que conserva cada ubicación.

  Lo electrónico y su cargo van a la cuenta de la empresa: en un cancelado no
  crean obligaciones. Pieza interna: no revisa permisos.
*/
create or replace function public.obligaciones_de_pedidos(p_empresa uuid)
returns table (
  pedido_id         uuid,
  numero            text,
  estado            text,
  origen_id         uuid,
  destino_id        uuid,
  pedido_origen_id  uuid,
  pedido_destino_id uuid,
  cliente           text,
  forma_pago        text,
  entregado_en      timestamptz,
  venta_id          uuid,
  efectivo          numeric,
  electronico       numeric,
  cargo             numeric,
  por_confirmar     numeric,
  liquidado         numeric,
  pendiente         numeric,
  motivo            text
)
language sql
stable
security definer
set search_path = ''
as $$
  with
  activos as (
    select s.pedido_id, s.numero, s.estado, s.origen_id, s.destino_id, s.origen_id as pedido_origen_id, s.destino_id as pedido_destino_id,
           s.cliente, s.forma_pago, s.entregado_en, s.venta_id,
           s.efectivo, s.electronico, s.cargo, s.por_confirmar, s.liquidado, s.pendiente, 'cobro'::text as motivo
      from public.saldos_de_pedidos_base(p_empresa) s
     where s.origen_id <> s.destino_id
       and s.estado not in ('por_resolver', 'cancelado')
  ),
  cancelados as (
    select p.id, p.numero, p.estado, p.origen_id, p.destino_id, p.nombre_cliente, p.forma_pago, p.entregado_en, p.venta_id, c.cancelado_en
      from public.pedidos_ubicacion p
      join public.cancelaciones_de_pedido c on c.pedido_id = p.id
     where p.empresa_id = p_empresa
       and p.estado = 'cancelado'
  ),
  -- Cada entrada y salida de efectivo del pedido, por ubicación.
  movimientos as (
    select cm.pedido_id, cm.ubicacion_id, cm.monto as neto, true as cobro, null::timestamptz as devuelto_en
      from public.cobros_por_medio cm
      join cancelados k on k.id = cm.pedido_id
     where cm.medio = 'efectivo'
    union all
    select d.pedido_id, l.destino_id, d.monto, false, null
      from public.liquidacion_detalle d
      join public.liquidaciones_ubicacion l on l.id = d.liquidacion_id
      join cancelados k on k.id = d.pedido_id
     where l.estado = 'confirmada'
    union all
    select d.pedido_id, l.origen_id, -d.monto, false, null
      from public.liquidacion_detalle d
      join public.liquidaciones_ubicacion l on l.id = d.liquidacion_id
      join cancelados k on k.id = d.pedido_id
     where l.estado = 'confirmada'
    union all
    select r.pedido_id, r.ubicacion_id, -r.importe, false, r.reembolsado_en
      from public.reembolsos_de_pedido r
      join cancelados k on k.id = r.pedido_id
     where r.medio = 'efectivo'
  ),
  conserva as (
    select m.pedido_id, m.ubicacion_id, sum(m.neto) as monto, bool_or(m.cobro) as cobro, min(m.devuelto_en) as primera_devolucion
      from movimientos m
     group by m.pedido_id, m.ubicacion_id
  ),
  /*
    El reparto. Quienes conservan efectivo y quienes devolvieron de más se
    ponen cada uno en fila, en el orden que decidió el propietario, como
    tramos de una misma recta; lo que una ubicación le debe a otra es lo que
    se solapan sus tramos. Es determinista, nunca atribuye a nadie más de lo
    que conserva, y lo que nadie cubre es lo pendiente de devolver al cliente.
  */
  tenedores as (
    select x.pedido_id, x.ubicacion_id, x.monto,
           sum(x.monto) over (partition by x.pedido_id
                              order by x.cobro desc, x.ubicacion_id = k.origen_id desc, x.ubicacion_id = k.destino_id desc, u.nombre, x.ubicacion_id
                              rows between unbounded preceding and current row) as hasta
      from conserva x
      join cancelados k on k.id = x.pedido_id
      join public.ubicaciones u on u.id = x.ubicacion_id
     where x.monto > 0
  ),
  acreedores as (
    select x.pedido_id, x.ubicacion_id, -x.monto as monto,
           sum(-x.monto) over (partition by x.pedido_id
                               order by x.ubicacion_id = k.origen_id desc, x.ubicacion_id = k.destino_id desc, x.primera_devolucion nulls last, u.nombre, x.ubicacion_id
                               rows between unbounded preceding and current row) as hasta
      from conserva x
      join cancelados k on k.id = x.pedido_id
      join public.ubicaciones u on u.id = x.ubicacion_id
     where x.monto < 0
  ),
  asignado as (
    select t.pedido_id, t.ubicacion_id as deudor_id, a.ubicacion_id as acreedor_id,
           sum(least(t.hasta, a.hasta) - greatest(t.hasta - t.monto, a.hasta - a.monto)) as monto
      from tenedores t
      join acreedores a on a.pedido_id = t.pedido_id
     where least(t.hasta, a.hasta) > greatest(t.hasta - t.monto, a.hasta - a.monto)
     group by t.pedido_id, t.ubicacion_id, a.ubicacion_id
  ),
  -- Las liquidaciones registradas después de cancelar, por sentido.
  posteriores as (
    select d.pedido_id, l.origen_id as deudor_id, l.destino_id as acreedor_id,
           coalesce(sum(d.monto) filter (where l.estado = 'por_confirmar'), 0) as por_confirmar,
           coalesce(sum(d.monto) filter (where l.estado = 'confirmada'), 0) as liquidado
      from public.liquidacion_detalle d
      join public.liquidaciones_ubicacion l on l.id = d.liquidacion_id
      join cancelados k on k.id = d.pedido_id
     where l.registrada_en > k.cancelado_en
       and l.estado in ('por_confirmar', 'confirmada')
     group by d.pedido_id, l.origen_id, l.destino_id
  ),
  pares as (
    select coalesce(a.pedido_id, q.pedido_id) as pedido_id,
           coalesce(a.deudor_id, q.deudor_id) as deudor_id,
           coalesce(a.acreedor_id, q.acreedor_id) as acreedor_id,
           coalesce(a.monto, 0) as debe,
           coalesce(q.por_confirmar, 0) as por_confirmar,
           coalesce(q.liquidado, 0) as liquidado
      from asignado a
      full join posteriores q
        on q.pedido_id = a.pedido_id and q.deudor_id = a.deudor_id and q.acreedor_id = a.acreedor_id
  )
  select * from activos
  union all
  select k.id, k.numero, k.estado, x.deudor_id, x.acreedor_id, k.origen_id, k.destino_id,
         k.nombre_cliente, k.forma_pago, k.entregado_en, k.venta_id,
         x.debe + x.liquidado, 0::numeric, 0::numeric, x.por_confirmar, x.liquidado,
         greatest(x.debe - x.por_confirmar, 0), 'cancelacion'::text
    from pares x
    join cancelados k on k.id = x.pedido_id
$$;

revoke execute on function public.obligaciones_de_pedidos(uuid) from public, anon, authenticated;

/*
  Lo de siempre, una fila por obligación: `origen_id` es quien debe y
  `destino_id` quien recibe. Los pedidos activos quedan exactamente igual; un
  cancelado puede tener varias filas (una por sentido) o ninguna.
*/
create or replace function public.saldos_de_pedidos(p_empresa uuid)
returns table (
  pedido_id     uuid,
  numero        text,
  estado        text,
  origen_id     uuid,
  destino_id    uuid,
  cliente       text,
  forma_pago    text,
  entregado_en  timestamptz,
  venta_id      uuid,
  efectivo      numeric,
  electronico   numeric,
  cargo         numeric,
  por_confirmar numeric,
  liquidado     numeric,
  pendiente     numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.pedido_id, o.numero, o.estado, o.origen_id, o.destino_id, o.cliente, o.forma_pago, o.entregado_en, o.venta_id,
         o.efectivo, o.electronico, o.cargo, o.por_confirmar, o.liquidado, o.pendiente
    from public.obligaciones_de_pedidos(p_empresa) o
$$;

revoke execute on function public.saldos_de_pedidos(uuid) from public, anon, authenticated;

-- Las liquidaciones por confirmar de un pedido («LIQ-000001 (por confirmar)»), o null. Pieza interna.
create or replace function public.liquidaciones_por_confirmar_del_pedido(p_pedido uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(l.numero || ' (por confirmar)', ', ' order by l.correlativo)
    from public.liquidacion_detalle d
    join public.liquidaciones_ubicacion l on l.id = d.liquidacion_id
   where d.pedido_id = p_pedido
     and l.estado = 'por_confirmar'
$$;

revoke execute on function public.liquidaciones_por_confirmar_del_pedido(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- REGISTRAR LA ENTREGA
-- ─────────────────────────────────────────────────────────
/*
  La de la 0046, en cualquier sentido (quien debe entrega a quien recibe) y con
  cada pedido bloqueado antes de tomar su parte: cancelar, reembolsar y
  liquidar el mismo pedido se ponen en fila, y su saldo se vuelve a leer ya
  bloqueado. Si en ese momento ya no alcanza, LQ002 y no se registra nada. Los
  pedidos se bloquean siempre en el mismo orden.
*/
create or replace function public.registrar_liquidacion(
  p_origen             uuid,
  p_destino            uuid,
  p_monto              numeric,
  p_metodo             text,
  p_fecha_efectiva     date default null,
  p_referencia         text default '',
  p_observacion        text default '',
  p_pedido             uuid default null,
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario     usuarios;
  v_empresa     uuid;
  v_monto       numeric(12,2);
  v_fecha       date := coalesce(p_fecha_efectiva, (now() at time zone 'America/Tegucigalpa')::date);
  v_huella      text;
  v_previa      liquidaciones_ubicacion;
  v_disponible  numeric(12,2);
  v_resto       numeric(12,2);
  v_toma        numeric(12,2);
  v_fresco      numeric(12,2);
  v_saldo       record;
  v_correlativo bigint;
  v_id          uuid := gen_random_uuid();
begin
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid() and u.activo and not u.debe_cambiar_contrasena
   limit 1;

  if v_usuario.id is null or not usuario_opera_liquidacion(p_origen) then
    raise exception 'No tienes permiso para registrar liquidaciones de esta ubicación'
      using errcode = '42501';
  end if;

  v_empresa := v_usuario.empresa_id;

  if p_clave_idempotencia is null or btrim(p_clave_idempotencia) = '' then
    raise exception 'Falta la clave de la liquidación' using errcode = 'LQ001';
  end if;

  if p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) or p_monto >= 10000000000 then
    raise exception 'El monto debe ser mayor que cero y tener hasta dos decimales' using errcode = 'LQ001';
  end if;

  v_monto := p_monto;

  if coalesce(p_metodo, '') not in ('entrega_en_efectivo', 'deposito_a_cuenta') then
    raise exception 'Método de liquidación desconocido: %', p_metodo using errcode = 'LQ001';
  end if;

  if v_fecha > (now() at time zone 'America/Tegucigalpa')::date then
    raise exception 'La fecha efectiva no puede ser futura' using errcode = 'LQ001';
  end if;

  if char_length(btrim(coalesce(p_referencia, ''))) > 120 or char_length(btrim(coalesce(p_observacion, ''))) > 500 then
    raise exception 'La referencia o la observación son demasiado largas' using errcode = 'LQ001';
  end if;

  if p_origen is null or p_destino is null or p_origen = p_destino
     or (select count(*) from ubicaciones u where u.id in (p_origen, p_destino) and u.empresa_id = v_empresa) <> 2 then
    raise exception 'Las ubicaciones de la liquidación no son válidas' using errcode = 'LQ001';
  end if;

  -- Todo lo del mismo par, en fila: el saldo no se puede gastar dos veces.
  perform pg_advisory_xact_lock(hashtextextended('liquidacion|' || v_empresa::text || '|' || p_origen::text || '|' || p_destino::text, 0));

  v_huella := concat_ws('|', p_origen, p_destino, v_monto, p_metodo, v_fecha, coalesce(p_pedido::text, '-'),
                        btrim(coalesce(p_referencia, '')), btrim(coalesce(p_observacion, '')));

  select l.* into v_previa
    from liquidaciones_ubicacion l
   where l.empresa_id = v_empresa and l.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_previa.huella <> v_huella then
      raise exception 'La clave % ya se usó para otra liquidación', p_clave_idempotencia using errcode = 'LQ003';
    end if;

    return to_jsonb(v_previa) - 'huella' - 'clave_idempotencia' || jsonb_build_object('repetida', true);
  end if;

  select coalesce(sum(s.pendiente), 0) into v_disponible
    from saldos_de_pedidos(v_empresa) s
   where s.origen_id = p_origen and s.destino_id = p_destino
     and (p_pedido is null or s.pedido_id = p_pedido);

  if v_monto > v_disponible then
    raise exception 'El monto (%) supera lo pendiente por liquidar (%)',
      to_char(v_monto, 'FM999999990.00'), to_char(v_disponible, 'FM999999990.00')
      using errcode = 'LQ002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('liquidacion-correlativo|' || v_empresa::text, 0));

  select coalesce(max(l.correlativo), 0) + 1 into v_correlativo
    from liquidaciones_ubicacion l where l.empresa_id = v_empresa;

  insert into liquidaciones_ubicacion (
    id, empresa_id, numero, correlativo, origen_id, destino_id,
    monto, metodo, fecha_efectiva, referencia, observacion,
    registrada_por, registrada_por_nombre, clave_idempotencia, huella
  ) values (
    v_id, v_empresa, 'LIQ-' || lpad(v_correlativo::text, 6, '0'), v_correlativo, p_origen, p_destino,
    v_monto, p_metodo, v_fecha, btrim(coalesce(p_referencia, '')), btrim(coalesce(p_observacion, '')),
    v_usuario.id, v_usuario.nombre, p_clave_idempotencia, v_huella
  );

  -- El reparto: del pedido más antiguo al más reciente, cada uno ya bloqueado.
  v_resto := v_monto;

  for v_saldo in
    select s.pedido_id
      from saldos_de_pedidos(v_empresa) s
     where s.origen_id = p_origen and s.destino_id = p_destino
       and (p_pedido is null or s.pedido_id = p_pedido)
       and s.pendiente > 0
     order by s.entregado_en, s.numero, s.pedido_id
  loop
    exit when v_resto <= 0;

    perform 1 from pedidos_ubicacion p where p.id = v_saldo.pedido_id for update;

    select coalesce(sum(s.pendiente), 0) into v_fresco
      from saldos_de_pedidos(v_empresa) s
     where s.pedido_id = v_saldo.pedido_id and s.origen_id = p_origen and s.destino_id = p_destino;

    continue when v_fresco <= 0;

    v_toma := least(v_resto, v_fresco);

    insert into liquidacion_detalle (empresa_id, liquidacion_id, pedido_id, monto)
    values (v_empresa, v_id, v_saldo.pedido_id, v_toma);

    v_resto := v_resto - v_toma;
  end loop;

  if v_resto > 0 then
    raise exception 'El monto (%) supera lo pendiente por liquidar: otra operación cambió el saldo mientras se registraba',
      to_char(v_monto, 'FM999999990.00')
      using errcode = 'LQ002';
  end if;

  return (select to_jsonb(l) - 'huella' - 'clave_idempotencia' from liquidaciones_ubicacion l where l.id = v_id)
         || jsonb_build_object('repetida', false);
end $$;

-- ─────────────────────────────────────────────────────────
-- REEMBOLSAR
-- ─────────────────────────────────────────────────────────
/*
  La de la 0049, con dos cambios en el efectivo:
  - no se devuelve mientras el pedido tenga una liquidación por confirmar
    (PI013): primero se confirma o se rechaza;
  - el administrador puede devolverlo desde una tercera ubicación activa de
    la empresa, con la referencia de la entrega real (PI015 si está
    desactivada o sin referencia). Los empleados siguen devolviendo solo
    desde su ubicación, si es el origen o el destino. El origen y el destino
    valen aunque se hayan desactivado después (pedidos históricos).
*/
create or replace function public.reembolsar_al_cliente(
  p_pedido     public.pedidos_ubicacion,
  p_usuario    public.usuarios,
  p_medio      text,
  p_importe    numeric,
  p_ubicacion  uuid,
  p_referencia text,
  p_clave      text,
  p_huella     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referencia text := btrim(coalesce(p_referencia, ''));
  v_pendiente  numeric;
  v_desde      uuid;
  v_nombre     text;
  v_bloqueo    text;
  v_id         uuid := gen_random_uuid();
begin
  if coalesce(p_medio, '') not in ('efectivo', 'transferencia', 'tarjeta', 'enlace') then
    raise exception 'Medio de reembolso desconocido: %', p_medio using errcode = 'PI015';
  end if;

  if p_importe is null or p_importe <= 0 or p_importe <> round(p_importe, 2) or p_importe >= 10000000000 then
    raise exception 'El importe del reembolso debe ser mayor que cero y tener hasta dos decimales' using errcode = 'PI015';
  end if;

  if char_length(v_referencia) > 120 then
    raise exception 'La referencia es demasiado larga' using errcode = 'PI015';
  end if;

  select d.pendiente into v_pendiente from public.dinero_a_devolver(p_pedido.id) d where d.medio = p_medio;

  if v_pendiente is null then
    raise exception 'El cliente no pagó este pedido con %: no hay nada que devolver por ese medio', p_medio using errcode = 'PI015';
  end if;

  if p_importe > v_pendiente then
    raise exception 'El reembolso (%) supera lo pendiente de devolver con % (%)',
      to_char(p_importe, 'FM999999990.00'), p_medio, to_char(v_pendiente, 'FM999999990.00')
      using errcode = 'PI015';
  end if;

  if p_medio = 'efectivo' then
    v_bloqueo := public.liquidaciones_por_confirmar_del_pedido(p_pedido.id);

    if v_bloqueo is not null then
      raise exception 'El efectivo de este pedido está en la liquidación %. Mientras no se confirme o se rechace en Liquidaciones, no se registran devoluciones en efectivo', v_bloqueo
        using errcode = 'PI013';
    end if;

    v_desde := case when p_usuario.rol = 'admin' then coalesce(p_ubicacion, p_pedido.origen_id) else p_usuario.ubicacion_id end;

    if p_usuario.rol <> 'admin' and p_ubicacion is not null and p_ubicacion is distinct from p_usuario.ubicacion_id then
      raise exception 'El efectivo se devuelve desde tu ubicación' using errcode = '42501';
    end if;

    if v_desde is null or not exists (select 1 from public.ubicaciones u where u.id = v_desde and u.empresa_id = p_pedido.empresa_id) then
      raise exception 'Elige la ubicación desde la que se devuelve el efectivo' using errcode = 'PI015';
    end if;

    -- El origen y el destino valen aunque después se hayan desactivado (pedidos históricos).
    if v_desde not in (p_pedido.origen_id, p_pedido.destino_id) then
      if p_usuario.rol <> 'admin' then
        raise exception 'El efectivo se devuelve desde el origen o el destino del pedido. Desde otra ubicación, solo el administrador'
          using errcode = '42501';
      end if;

      -- Una tercera ubicación, solo si está activa: lo mismo que ofrece la pantalla, también por RPC directo.
      if not exists (select 1 from public.ubicaciones u where u.id = v_desde and u.empresa_id = p_pedido.empresa_id and u.activa) then
        raise exception 'La ubicación desde la que se devuelve el efectivo está desactivada' using errcode = 'PI015';
      end if;

      if v_referencia = '' then
        raise exception 'Escribe la referencia de la entrega hecha desde otra ubicación (recibo, quién entregó)' using errcode = 'PI015';
      end if;
    end if;
  else
    if p_usuario.rol <> 'admin' then
      raise exception 'Las devoluciones por transferencia, tarjeta o enlace las registra el administrador' using errcode = '42501';
    end if;

    if v_referencia = '' then
      raise exception 'Escribe la referencia de la devolución hecha por %', p_medio using errcode = 'PI015';
    end if;
  end if;

  insert into public.reembolsos_de_pedido (
    id, empresa_id, pedido_id, medio, importe, ubicacion_id, referencia,
    usuario_id, usuario_nombre, usuario_rol, ubicacion_usuario, clave_idempotencia, huella
  ) values (
    v_id, p_pedido.empresa_id, p_pedido.id, p_medio, p_importe, v_desde, v_referencia,
    p_usuario.id, p_usuario.nombre, p_usuario.rol, p_usuario.ubicacion_id, p_clave, p_huella
  );

  select u.nombre into v_nombre from public.ubicaciones u where u.id = v_desde;

  insert into public.eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle)
  values (
    p_pedido.empresa_id, p_pedido.id, 'reembolso_registrado', p_usuario.id, p_usuario.nombre, p_usuario.ubicacion_id, v_referencia,
    jsonb_build_object('reembolso_id', v_id, 'medio', p_medio, 'importe', p_importe, 'ubicacion_id', v_desde, 'ubicacion', v_nombre)
  );

  return v_id;
end $$;

revoke execute on function
  public.reembolsar_al_cliente(public.pedidos_ubicacion, public.usuarios, text, numeric, uuid, text, text, text)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- CANCELAR
-- ─────────────────────────────────────────────────────────
/*
  La de la 0049, salvo el bloqueo: con efectivo en una liquidación confirmada
  ya se cancela (lo que conserva cada ubicación lo tiene en cuenta); con una
  por confirmar, no (PI013), hasta que se confirme o se rechace.
*/
create or replace function public.cancelar_pedido(
  p_pedido             uuid,
  p_motivo             text,
  p_recepcion          jsonb default null,
  p_reembolsos         jsonb default '[]'::jsonb,
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa   uuid := empresa_del_usuario();
  v_usuario   usuarios;
  v_pedido    pedidos_ubicacion;
  v_motivo    text := btrim(coalesce(p_motivo, ''));
  v_reembolsos jsonb := coalesce(p_reembolsos, '[]'::jsonb);
  v_huella    text;
  v_previa    cancelaciones_de_pedido;
  v_bloqueo   text;
  v_principal numeric;
  v_cargo     numeric;
  v_r         record;
begin
  perform exigir_clave(p_clave_idempotencia);

  if v_empresa is null then
    raise exception 'Inicia sesión con un usuario activo para cancelar pedidos' using errcode = '42501';
  end if;

  if char_length(v_motivo) < 5 or char_length(v_motivo) > 500 then
    raise exception 'Escribe el motivo de la cancelación (de 5 a 500 caracteres)' using errcode = 'PI001';
  end if;

  if jsonb_typeof(v_reembolsos) is distinct from 'array'
     or (p_recepcion is not null and jsonb_typeof(p_recepcion) is distinct from 'object') then
    raise exception 'Los datos de la recepción o del reembolso no son válidos' using errcode = 'PI001';
  end if;

  v_pedido := tomar_pedido(v_empresa, p_pedido);
  v_huella := concat_ws('|', 'cancelar', p_pedido::text, v_motivo, coalesce(p_recepcion::text, '-'), v_reembolsos::text);

  select c.* into v_previa from cancelaciones_de_pedido c where c.empresa_id = v_empresa and c.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_previa.huella <> v_huella then
      raise exception 'La clave % ya se usó para otra operación', p_clave_idempotencia using errcode = 'PI011';
    end if;

    return resumen_de_pedido(p_pedido) || jsonb_build_object('repetido', true);
  end if;

  v_usuario := quien_cancela(p_pedido);

  if v_pedido.estado not in ('pendiente', 'por_resolver') then
    raise exception '%', case v_pedido.estado
        when 'facturado' then 'El pedido ' || v_pedido.numero || ' ya está facturado: su anulación se hará con la anulación de facturas de pedido'
        when 'cancelado' then 'El pedido ' || v_pedido.numero || ' ya está cancelado'
        else 'El pedido ' || v_pedido.numero || ' está ' || v_pedido.estado || ': no se puede cancelar'
      end
      using errcode = 'PI012';
  end if;

  v_bloqueo := liquidaciones_por_confirmar_del_pedido(p_pedido);

  if v_bloqueo is not null then
    raise exception 'El efectivo de este pedido está en la liquidación %. Mientras no se confirme o se rechace en Liquidaciones, el pedido no se puede cancelar', v_bloqueo
      using errcode = 'PI013';
  end if;

  select coalesce(sum(d.monto), 0), coalesce(sum(d.cargo), 0) into v_principal, v_cargo
    from dinero_a_devolver(p_pedido) d;

  insert into cancelaciones_de_pedido (
    empresa_id, pedido_id, estado_anterior, motivo, usuario_id, usuario_nombre, ubicacion_usuario,
    principal_recibido, cargo_recibido, clave_idempotencia, huella
  ) values (
    v_empresa, p_pedido, v_pedido.estado, v_motivo, v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id,
    v_principal, v_cargo, p_clave_idempotencia, v_huella
  );

  update pedidos_ubicacion set estado = 'cancelado' where id = p_pedido;

  insert into eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle)
  values (
    v_empresa, p_pedido, 'cancelado', v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id, v_motivo,
    jsonb_build_object('estado_anterior', v_pedido.estado, 'principal_recibido', v_principal, 'cargo_recibido', v_cargo)
  );

  if p_recepcion is not null and jsonb_array_length(coalesce(p_recepcion->'productos', '[]'::jsonb)) > 0 then
    perform recibir_productos_del_pedido(
      v_pedido, v_usuario, (p_recepcion->>'ubicacion_id')::uuid, p_recepcion->'productos', p_recepcion->>'nota',
      p_clave_idempotencia || '|recepcion', v_huella);
  end if;

  for v_r in select e, n from jsonb_array_elements(v_reembolsos) with ordinality x(e, n) loop
    perform reembolsar_al_cliente(
      v_pedido, v_usuario, v_r.e->>'medio', (v_r.e->>'importe')::numeric, (v_r.e->>'ubicacion_id')::uuid, v_r.e->>'referencia',
      p_clave_idempotencia || '|reembolso|' || v_r.n, v_huella);
  end loop;

  return resumen_de_pedido(p_pedido) || jsonb_build_object('repetido', false);
end $$;

-- ─────────────────────────────────────────────────────────
-- LO QUE VE LA PANTALLA DEL PEDIDO
-- ─────────────────────────────────────────────────────────
/*
  La de la 0049 con lo de C2b:
  - `bloqueo_por_liquidacion`: solo las liquidaciones por confirmar bloquean
    cancelar;
  - `bloqueo_de_reembolsos`: en un cancelado, la liquidación por confirmar que
    impide devolver efectivo;
  - `ubicaciones_para_reembolsar`: el administrador, cualquier ubicación activa
    (`otra` si no es el origen ni el destino); el empleado, la suya si es del
    pedido;
  - `obligaciones`: en un cancelado, quién le debe a quién por ese pedido.
*/
create or replace function public.cancelacion_de_pedido(p_pedido uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos_ubicacion;
  v_admin  boolean := coalesce(public.usuario_es_admin(), false);
  v_aqui   uuid := public.ubicacion_del_usuario();
  v_opera  boolean;
begin
  select p.* into v_pedido from public.pedidos_ubicacion p where p.id = p_pedido;

  if v_pedido.id is null or not public.pedido_visible(v_pedido.empresa_id, v_pedido.origen_id, v_pedido.destino_id) then
    raise exception 'El pedido no existe o no es de tus ubicaciones' using errcode = 'PI008';
  end if;

  v_opera := coalesce(public.usuario_puede_autorizar_cancelacion(v_pedido.id), false);

  return jsonb_build_object(
    'puede_cancelar', v_opera and v_pedido.estado in ('pendiente', 'por_resolver'),
    'bloqueo_por_liquidacion', case
      when v_pedido.estado in ('pendiente', 'por_resolver') then public.liquidaciones_por_confirmar_del_pedido(v_pedido.id)
    end,
    'bloqueo_de_reembolsos', case
      when v_pedido.estado = 'cancelado' then public.liquidaciones_por_confirmar_del_pedido(v_pedido.id)
    end,
    'puede_registrar', v_opera and v_pedido.estado = 'cancelado',
    'es_admin', v_admin,
    'cancelacion', (
      select jsonb_build_object('motivo', c.motivo, 'usuario', c.usuario_nombre, 'fecha', c.cancelado_en,
                                'estado_anterior', c.estado_anterior, 'principal', c.principal_recibido, 'cargo', c.cargo_recibido)
        from public.cancelaciones_de_pedido c where c.pedido_id = v_pedido.id
    ),
    'productos', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.nombre, x.producto_id) from public.productos_por_recibir(v_pedido.id) x
    ), '[]'::jsonb),
    'dinero', coalesce((
      select jsonb_agg(to_jsonb(x) order by array_position(array['efectivo', 'transferencia', 'tarjeta', 'enlace'], x.medio))
        from public.dinero_a_devolver(v_pedido.id) x
    ), '[]'::jsonb),
    'recepciones', coalesce((
      select jsonb_agg(
               jsonb_build_object('ubicacion', u.nombre, 'en_otra_ubicacion', r.en_otra_ubicacion, 'nota', r.nota,
                                  'usuario', r.usuario_nombre, 'fecha', r.recibido_en,
                                  'productos', (select jsonb_agg(jsonb_build_object('producto_id', d.producto_id, 'nombre', pd.nombre,
                                                                                    'cantidad', d.cantidad, 'condicion', d.condicion)
                                                                 order by pd.nombre, d.condicion)
                                                  from public.recepcion_detalle d
                                                  join public.pedido_detalle pd on pd.pedido_id = d.pedido_id and pd.producto_id = d.producto_id
                                                 where d.recepcion_id = r.id))
               order by r.recibido_en, r.id)
        from public.recepciones_de_pedido r
        join public.ubicaciones u on u.id = r.ubicacion_id
       where r.pedido_id = v_pedido.id
    ), '[]'::jsonb),
    'reembolsos', coalesce((
      select jsonb_agg(jsonb_build_object('medio', r.medio, 'importe', r.importe, 'ubicacion', u.nombre, 'referencia', r.referencia,
                                          'usuario', r.usuario_nombre, 'fecha', r.reembolsado_en,
                                          'en_otra_ubicacion', r.ubicacion_id is not null and r.ubicacion_id not in (v_pedido.origen_id, v_pedido.destino_id))
                       order by r.reembolsado_en, r.id)
        from public.reembolsos_de_pedido r
        left join public.ubicaciones u on u.id = r.ubicacion_id
       where r.pedido_id = v_pedido.id
    ), '[]'::jsonb),
    -- Dónde puede recibir quien mira: el administrador, cualquier ubicación activa; el empleado, la suya si es del pedido.
    'ubicaciones_para_recibir', case when v_opera then coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre,
                                          'otra', u.id not in (v_pedido.origen_id, v_pedido.destino_id))
                       order by u.id not in (v_pedido.origen_id, v_pedido.destino_id), u.id <> coalesce(v_aqui, v_pedido.origen_id), u.nombre)
        from public.ubicaciones u
       where u.empresa_id = v_pedido.empresa_id
         and u.activa
         and (v_admin or (u.id = v_aqui and u.id in (v_pedido.origen_id, v_pedido.destino_id)))
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- Desde dónde puede devolver efectivo: el administrador, cualquier ubicación activa; el empleado, la suya si es del pedido.
    'ubicaciones_para_reembolsar', case when v_opera then coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre,
                                          'otra', u.id not in (v_pedido.origen_id, v_pedido.destino_id))
                       order by u.id not in (v_pedido.origen_id, v_pedido.destino_id), u.id <> coalesce(v_aqui, v_pedido.origen_id), u.nombre)
        from public.ubicaciones u
       where u.empresa_id = v_pedido.empresa_id
         and (
           (v_admin and (u.activa or u.id in (v_pedido.origen_id, v_pedido.destino_id)))
           or (not v_admin and u.id = v_aqui and u.id in (v_pedido.origen_id, v_pedido.destino_id))
         )
    ), '[]'::jsonb) else '[]'::jsonb end,
    'puede_reembolsar_electronico', v_opera and v_admin,
    'obligaciones', case when v_pedido.estado = 'cancelado' then coalesce((
      select jsonb_agg(jsonb_build_object('debe', d.nombre, 'recibe', a.nombre,
                                          'monto', o.efectivo, 'por_confirmar', o.por_confirmar,
                                          'liquidado', o.liquidado, 'pendiente', o.pendiente)
                       order by d.nombre, a.nombre)
        from public.obligaciones_de_pedidos(v_pedido.empresa_id) o
        join public.ubicaciones d on d.id = o.origen_id
        join public.ubicaciones a on a.id = o.destino_id
       where o.pedido_id = v_pedido.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

-- ─────────────────────────────────────────────────────────
-- LA PANTALLA DE LIQUIDACIONES
-- ─────────────────────────────────────────────────────────
/*
  La de la 0046, con las obligaciones en cualquier sentido. En cada pedido,
  además: el motivo («cobro» o «cancelacion») y el origen y el destino reales
  del pedido. En cada liquidación: si es una contraliquidación (paga una
  obligación de un pedido cancelado) y el motivo de cada pedido que paga.
*/
create or replace function public.control_de_liquidaciones(p_origen uuid default null, p_destino uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := public.empresa_del_usuario();
begin
  if v_empresa is null
     or not (public.usuario_es_admin() or public.usuario_tiene_permiso('settlements-view') or public.usuario_tiene_permiso('settlements-manage')) then
    raise exception 'No tienes permiso para consultar liquidaciones' using errcode = '42501';
  end if;

  return (
    with
    pedidos as (
      select s.*, o.nombre as origen, d.nombre as destino, po.nombre as pedido_origen, pd.nombre as pedido_destino, v.numero_factura,
             case
               when s.efectivo = 0 then 'sin_efectivo'
               when s.pendiente = 0 and s.por_confirmar = 0 then 'liquidado'
               when s.por_confirmar > 0 then 'por_confirmar'
               when s.liquidado > 0 then 'parcial'
               else 'pendiente'
             end as estado_liquidacion
        from public.obligaciones_de_pedidos(v_empresa) s
        join public.ubicaciones o on o.id = s.origen_id
        join public.ubicaciones d on d.id = s.destino_id
        join public.ubicaciones po on po.id = s.pedido_origen_id
        join public.ubicaciones pd on pd.id = s.pedido_destino_id
        left join public.ventas v on v.id = s.venta_id
       where public.liquidacion_visible(v_empresa, s.origen_id, s.destino_id)
         and (p_origen is null or s.origen_id = p_origen)
         and (p_destino is null or s.destino_id = p_destino)
         and s.efectivo + s.electronico > 0
    ),
    liquidaciones as (
      select l.*, o.nombre as origen, d.nombre as destino
        from public.liquidaciones_ubicacion l
        join public.ubicaciones o on o.id = l.origen_id
        join public.ubicaciones d on d.id = l.destino_id
       where l.empresa_id = v_empresa
         and public.liquidacion_visible(v_empresa, l.origen_id, l.destino_id)
         and (p_origen is null or l.origen_id = p_origen)
         and (p_destino is null or l.destino_id = p_destino)
    )
    select jsonb_build_object(
      'pares', coalesce((
        select jsonb_agg(x order by x.origen, x.destino)
          from (
            select origen_id, origen, destino_id, destino,
                   sum(efectivo) as efectivo, sum(electronico) as electronico, sum(cargo) as cargo,
                   sum(por_confirmar) as por_confirmar, sum(liquidado) as liquidado, sum(pendiente) as pendiente,
                   bool_or(motivo = 'cancelacion') as por_cancelaciones,
                   public.usuario_opera_liquidacion(origen_id) as puede_registrar
              from pedidos
             group by origen_id, origen, destino_id, destino
          ) x
      ), '[]'::jsonb),
      'pedidos', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'pedido_id', p.pedido_id, 'numero', p.numero, 'estado', p.estado,
                   'origen_id', p.origen_id, 'origen', p.origen, 'destino_id', p.destino_id, 'destino', p.destino,
                   'cliente', p.cliente, 'forma_pago', p.forma_pago, 'entregado_en', p.entregado_en,
                   'numero_factura', p.numero_factura,
                   'efectivo', p.efectivo, 'electronico', p.electronico, 'cargo', p.cargo,
                   'por_confirmar', p.por_confirmar, 'liquidado', p.liquidado, 'pendiente', p.pendiente,
                   'estado_liquidacion', p.estado_liquidacion,
                   'motivo', p.motivo,
                   'pedido_origen_id', p.pedido_origen_id, 'pedido_origen', p.pedido_origen,
                   'pedido_destino_id', p.pedido_destino_id, 'pedido_destino', p.pedido_destino,
                   'medios', coalesce((
                     select jsonb_agg(jsonb_build_object('medio', c.medio, 'monto', c.monto, 'cargo', c.cargo, 'fecha', c.fecha) order by c.medio)
                       from public.cobros_por_medio c where c.pedido_id = p.pedido_id
                   ), '[]'::jsonb)
                 )
                 order by p.entregado_en desc, p.numero desc, p.origen, p.destino
               )
          from pedidos p
      ), '[]'::jsonb),
      'liquidaciones', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', l.id, 'numero', l.numero, 'estado', l.estado,
                   'origen_id', l.origen_id, 'origen', l.origen, 'destino_id', l.destino_id, 'destino', l.destino,
                   'monto', l.monto, 'metodo', l.metodo, 'fecha_efectiva', l.fecha_efectiva,
                   'referencia', l.referencia, 'observacion', l.observacion,
                   'registrada_por', l.registrada_por_nombre, 'registrada_en', l.registrada_en,
                   'resuelta_por', l.resuelta_por_nombre, 'resuelta_en', l.resuelta_en, 'motivo_rechazo', l.motivo_rechazo,
                   'puede_resolver', l.estado = 'por_confirmar' and public.usuario_opera_liquidacion(l.destino_id),
                   'contraliquidacion', exists (
                     select 1
                       from public.liquidacion_detalle d
                       join public.cancelaciones_de_pedido c on c.pedido_id = d.pedido_id
                      where d.liquidacion_id = l.id and l.registrada_en > c.cancelado_en
                   ),
                   'pedidos', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'numero', q.numero, 'monto', d.monto,
                              'motivo', case when c.cancelado_en is not null and l.registrada_en > c.cancelado_en then 'cancelacion' else 'cobro' end)
                            order by q.numero)
                       from public.liquidacion_detalle d
                       join public.pedidos_ubicacion q on q.id = d.pedido_id
                       left join public.cancelaciones_de_pedido c on c.pedido_id = d.pedido_id
                      where d.liquidacion_id = l.id
                   ), '[]'::jsonb)
                 )
                 order by l.registrada_en desc, l.correlativo desc
               )
          from liquidaciones l
      ), '[]'::jsonb)
    )
  );
end $$;
