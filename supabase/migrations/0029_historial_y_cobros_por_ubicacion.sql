-- Historial y cuentas por cobrar por ubicación (OFF-1.1).
--
-- Vendedores: ventas, detalle, abonos, pagos y cobros de SU ubicación.
-- Administradores: todas las ubicaciones, como hasta ahora.
--
-- Hasta aquí cualquier usuario activo leía todas las ventas de la empresa.
-- Con varios camiones vendiendo, el vendedor de uno veía las del otro.
--
-- Limitar solo la lectura no alcanza: registrar_pago_cliente() es
-- SECURITY DEFINER, pasa por encima de RLS y reparte el pago entre TODAS
-- las facturas del cliente. Un vendedor habría podido abonar a una factura
-- de otro camión que ya no ve. Por eso el alcance del cobro se limita
-- dentro de la función, con la misma regla.
--
-- La venta del POS no cambia: registrar_venta_ubicacion() es SECURITY
-- DEFINER y no depende de estas políticas. Las escrituras directas ya
-- estaban retiradas (0021): aquí solo se reemplazan políticas de lectura.
--
-- Lo que NO hace: no toca ningún dato. Las ventas sin ubicación (las de
-- antes del inventario por ubicación) solo las verá el administrador.

-- ─────────────────────────────────────────────────────────
-- LECTURA POR UBICACIÓN
-- ─────────────────────────────────────────────────────────
drop policy if exists ventas_de_mi_empresa on public.ventas;
drop policy if exists ventas_lectura on public.ventas;
create policy ventas_lectura on public.ventas
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and ((select public.usuario_es_admin()) or ubicacion_id = (select public.ubicacion_del_usuario()))
  );

-- El detalle y los abonos se ven si se ve su venta: la regla vive en un solo lugar.
drop policy if exists detalle_venta_de_mi_empresa on public.detalle_venta;
drop policy if exists detalle_venta_lectura on public.detalle_venta;
create policy detalle_venta_lectura on public.detalle_venta
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and exists (select 1 from public.ventas v where v.id = detalle_venta.venta_id)
  );

drop policy if exists abonos_de_mi_empresa on public.abonos;
drop policy if exists abonos_lectura on public.abonos;
create policy abonos_lectura on public.abonos
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and exists (select 1 from public.ventas v where v.id = abonos.venta_id)
  );

/*
  Un pago es de un cliente, no de una factura: se reparte entre varias. Por
  eso lleva la ubicación de quien cobró —nula cuando cobra el administrador
  sobre todas— y se ve con la misma regla que las ventas.
*/
alter table public.pagos add column if not exists ubicacion_id uuid;

alter table public.pagos drop constraint if exists pagos_ubicacion_de_la_empresa;
alter table public.pagos add constraint pagos_ubicacion_de_la_empresa
  foreign key (ubicacion_id, empresa_id) references public.ubicaciones (id, empresa_id);

drop policy if exists pagos_de_mi_empresa on public.pagos;
drop policy if exists pagos_lectura on public.pagos;
create policy pagos_lectura on public.pagos
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and ((select public.usuario_es_admin()) or ubicacion_id = (select public.ubicacion_del_usuario()))
  );

-- ─────────────────────────────────────────────────────────
-- EL COBRO, CON EL MISMO ALCANCE
-- ─────────────────────────────────────────────────────────
/*
  Mismo contrato, mismas respuestas y mismas reglas que la 0013 (candado
  del cliente, idempotencia, FIFO, sobrepago rechazado entero). Lo único
  que cambia es qué facturas entran:
  - administrador: todas las del cliente, como hasta ahora;
  - vendedor: solo las de su ubicación operativa. La deuda, el reparto y
    el mensaje de sobrepago se miden contra esas facturas. Sin ubicación
    no cobra (LC005).
*/
create or replace function public.registrar_pago_cliente(
  p_cliente_id         uuid,
  p_monto              numeric,
  p_clave_idempotencia text default null,
  p_nota               text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa      uuid;
  v_usuario      uuid;
  v_alcance      uuid;
  v_monto        numeric(12,2);
  v_deuda        numeric(12,2);
  v_restante     numeric(12,2);
  v_aplicado     numeric(12,2);
  v_pago         pagos%rowtype;
  v_factura      record;
  v_aplicaciones jsonb := '[]'::jsonb;
begin
  -- La empresa se deriva del usuario autenticado; nunca llega como parámetro.
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

  -- Null = todas las ubicaciones (administrador).
  if not usuario_es_admin() then
    v_alcance := ubicacion_del_usuario();

    if v_alcance is null then
      raise exception 'No tienes una ubicación operativa asignada: pide que te asignen una antes de cobrar'
        using errcode = 'LC005';
    end if;
  end if;

  if p_monto is null then
    raise exception 'El monto del pago es obligatorio'
      using errcode = '22023';
  end if;

  v_monto := round(p_monto, 2);

  if v_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor que cero'
      using errcode = '22023';
  end if;

  -- El candado de la cuenta, antes de mirar la deuda (ver 0013).
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

  -- Las facturas que entran en la deuda, bloqueadas antes de sumarlas.
  perform 1
     from ventas
    where empresa_id = v_empresa
      and cliente_id = p_cliente_id
      and forma_pago = 'credito'
      and estado <> 'anulada'
      and (v_alcance is null or ubicacion_id = v_alcance)
      for update;

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
         and (v_alcance is null or v.ubicacion_id = v_alcance)
    ) s
   where s.saldo > 0;

  if v_deuda <= 0 then
    raise exception 'El cliente no tiene deuda pendiente'
      using errcode = 'LC002';
  end if;

  if v_monto > v_deuda then
    raise exception
      'El pago de % supera la deuda del cliente, que es de %',
      to_char(v_monto, 'FM999999990.00'), to_char(v_deuda, 'FM999999990.00')
      using errcode = 'LC001';
  end if;

  insert into pagos (
    empresa_id, cliente_id, usuario_id, ubicacion_id,
    monto, saldo_anterior, saldo_posterior,
    nota, clave_idempotencia
  )
  values (
    v_empresa, p_cliente_id, v_usuario, v_alcance,
    v_monto, v_deuda, round(v_deuda - v_monto, 2),
    coalesce(p_nota, ''), p_clave_idempotencia
  )
  returning * into v_pago;

  v_restante := v_monto;

  -- FIFO: la más vieja primero; correlativo e id desempatan.
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
       and (v_alcance is null or v.ubicacion_id = v_alcance)
     order by v.fecha asc, v.correlativo asc, v.id asc
  loop
    exit when v_restante <= 0;

    if v_factura.saldo <= 0 then
      continue;
    end if;

    v_aplicado := least(v_restante, v_factura.saldo);

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
