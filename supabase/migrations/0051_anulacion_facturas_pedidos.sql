-- Pedidos interubicación, etapa C3: anular la factura de un pedido.
--
-- Una factura de pedido no es una venta normal: la mercadería salió de la
-- ubicación que entregó (no de la que facturó) y el dinero se cobró en el
-- pedido. Por eso no se anula con anular_venta(), que devuelve la mercadería a
-- la ubicación de la venta, y anular_venta() no cambia.
--
-- Anular la factura deja:
-- - la venta «Anulada», con su registro inmutable en anulaciones_venta
--   (tratamiento del dinero «pedido»): deja de contar como venta y como
--   deuda, y conserva su número, productos y pagos;
-- - el pedido «Cancelado», con su registro en cancelaciones_de_pedido
--   (estado anterior «facturado»). Desde ahí, todo es lo de C2a y C2b, sin
--   duplicarlo: los productos se reciben donde de verdad vuelvan (solo los de
--   buen estado suman, y solo en la ubicación que los recibe), el dinero
--   cobrado en el pedido queda por devolver y se devuelve en una o varias
--   entregas, y las obligaciones entre ubicaciones salen de dónde quedó el
--   efectivo, también si ya había liquidaciones confirmadas.
-- No mueve inventario ni registra ningún reembolso por sí sola.
--
-- Decisiones del propietario (2026-11-19):
-- - abonos registrados después de facturar (pagos del cliente repartidos por
--   FIFO): la factura no se anula con este procedimiento (AV005); queda para
--   los ajustes de crédito (C5). La prima cobrada en el pedido sí se admite;
-- - quién anula: lo mismo que anular_venta(). El administrador, siempre; el
--   vendedor con «Historial de facturas» y «Anular ventas», en la ubicación
--   que facturó y el mismo día de la factura. Recibir y devolver después
--   siguen con las reglas de C2a.
-- Las facturas fiscales (CAI) siguen sin anularse (AV004), igual que en la 0033.
-- Con una liquidación por confirmar, no se anula (PI013).
--
-- Errores: AV001 motivo, AV002 la factura no existe o no es de un pedido,
-- AV003 fuera del día, AV004 fiscal, AV005 abonos posteriores, AV009 clave
-- reusada, PI012 el pedido no está facturado, PI013 liquidación por
-- confirmar, 42501 sin permiso.
--
-- No cambia ninguna fila existente. Idempotente.

-- ─────────────────────────────────────────────────────────
-- LOS REGISTROS ADMITEN LA FACTURA DE UN PEDIDO
-- ─────────────────────────────────────────────────────────
/*
  Un pedido con factura está facturado, o cancelado con su factura anulada (el
  disparador de abajo no deja llegar a cancelado de otro modo). Uno facturado
  sigue exigiendo su factura.
*/
alter table public.pedidos_ubicacion drop constraint if exists pedidos_facturado_con_su_factura;
alter table public.pedidos_ubicacion add constraint pedidos_facturado_con_su_factura
  check ((estado <> 'facturado' or venta_id is not null) and (venta_id is null or estado in ('facturado', 'cancelado')));

-- La cancelación de un pedido ya facturado (su factura anulada).
alter table public.cancelaciones_de_pedido drop constraint if exists cancelaciones_de_pedido_estado_anterior_check;
alter table public.cancelaciones_de_pedido add constraint cancelaciones_de_pedido_estado_anterior_check
  check (estado_anterior in ('pendiente', 'por_resolver', 'facturado'));

/*
  «pedido»: el dinero de la factura es el que se cobró en el pedido, y se
  devuelve con los reembolsos del pedido (C2a). No es un reembolso pendiente
  aparte: así los reportes no lo cuentan dos veces.
*/
alter table public.anulaciones_venta drop constraint if exists anulaciones_venta_tratamiento_dinero_check;
alter table public.anulaciones_venta add constraint anulaciones_venta_tratamiento_dinero_check
  check (tratamiento_dinero in ('reembolso_pendiente', 'no_cobrado', 'credito_sin_abonos', 'pedido'));

alter table public.anulaciones_venta drop constraint if exists anulaciones_venta_dinero_segun_forma_de_pago;
alter table public.anulaciones_venta add constraint anulaciones_venta_dinero_segun_forma_de_pago
  check (
    (forma_pago = 'contado' and tratamiento_dinero in ('reembolso_pendiente', 'no_cobrado'))
    or (forma_pago = 'credito' and tratamiento_dinero = 'credito_sin_abonos')
    or tratamiento_dinero = 'pedido'
  );

-- ─────────────────────────────────────────────────────────
-- UN PEDIDO SOLO AVANZA
-- ─────────────────────────────────────────────────────────
/*
  Las transiciones de la 0049, ahora en una tabla, más una: un pedido
  facturado pasa a cancelado solo si su factura ya está anulada, y solo cambia
  su estado. Lo demás, igual: cada transición dice qué columnas puede tocar.
*/
create or replace function public.pedido_solo_avanza()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cambia text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un pedido no se borra' using errcode = '42501';
  end if;

  select t.columnas into v_cambia
    from (values
      ('pendiente', 'facturado', new.venta_id is not null, array['estado', 'venta_id', 'facturado_por', 'facturado_por_nombre', 'facturado_en']),
      ('pendiente', 'por_resolver', true, array['estado']),
      ('por_resolver', 'pendiente', new.destino_id <> old.destino_id, array['estado', 'destino_id']),
      ('pendiente', 'cancelado', true, array['estado']),
      ('por_resolver', 'cancelado', true, array['estado']),
      ('facturado', 'cancelado', exists (select 1 from public.ventas v where v.id = old.venta_id and v.estado = 'anulada'), array['estado'])
    ) as t (de, a, vale, columnas)
   where t.de = old.estado and t.a = new.estado and t.vale;

  if v_cambia is null then
    raise exception '%', case old.estado
        when 'pendiente' then 'Un pedido pendiente solo puede pasar a facturado, a por resolver o a cancelado'
        when 'por_resolver' then 'Un pedido por resolver solo vuelve a pendiente con otra ubicación destino, o se cancela'
        when 'facturado' then 'Un pedido facturado solo se cancela con la anulación de su factura'
        else 'Un pedido ' || old.estado || ' ya no cambia'
      end
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - v_cambia) <> (to_jsonb(old) - v_cambia) then
    raise exception 'Los datos de un pedido entregado no se modifican' using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function public.pedido_solo_avanza() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- ANULAR LA FACTURA DE UN PEDIDO
-- ─────────────────────────────────────────────────────────
/*
  Todo en una transacción. Primero el pedido (con el candado de su par, el
  mismo de liquidar, cancelar y reembolsar) y después la factura (el de
  cobrar): una liquidación, un reembolso o un abono simultáneos esperan o
  ya se ven.

  Un reintento con la factura ya anulada responde «ya_anulada» sin escribir
  nada. La clave es obligatoria.
*/
create or replace function public.anular_factura_de_pedido(
  p_venta_id           uuid,
  p_motivo             text,
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario   usuarios;
  v_es_admin  boolean;
  v_motivo    text := btrim(coalesce(p_motivo, ''));
  v_venta     ventas;
  v_pedido    pedidos_ubicacion;
  v_registro  anulaciones_venta;
  v_bloqueo   text;
  v_prima     numeric;
  v_principal numeric;
  v_cargo     numeric;
  v_pedido_id uuid;
begin
  perform exigir_clave(p_clave_idempotencia);

  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid() and u.activo and not u.debe_cambiar_contrasena
   limit 1
     for share;

  v_es_admin := coalesce(v_usuario.rol = 'admin', false);

  -- Las mismas marcas que anular_venta(); el contador nunca anula.
  if v_usuario.id is null or v_usuario.rol = 'contador'
     or not (v_es_admin or (usuario_tiene_permiso('sales-history') and usuario_tiene_permiso('sales-void') and v_usuario.ubicacion_id is not null)) then
    raise exception 'No tienes permiso para anular facturas' using errcode = '42501';
  end if;

  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Escribe el motivo de la anulación (de 10 a 500 caracteres)' using errcode = 'AV001';
  end if;

  select v.pedido_id into v_pedido_id
    from ventas v
   where v.id = p_venta_id and v.empresa_id = v_usuario.empresa_id;

  if v_pedido_id is null then
    raise exception 'La factura no existe en tu empresa o no es de un pedido: una venta normal se anula con «Anular venta»'
      using errcode = 'AV002';
  end if;

  v_pedido := tomar_pedido(v_usuario.empresa_id, v_pedido_id);

  select v.* into v_venta from ventas v where v.id = p_venta_id for update;

  if not v_es_admin and v_venta.ubicacion_id is distinct from v_usuario.ubicacion_id then
    raise exception 'Solo puedes anular facturas de tu ubicación' using errcode = '42501';
  end if;

  if v_venta.estado = 'anulada' then
    select a.* into v_registro from anulaciones_venta a where a.venta_id = v_venta.id;

    return jsonb_build_object('estado', 'ya_anulada', 'venta_id', v_venta.id, 'numero_factura', v_venta.numero_factura,
                              'pedido_id', v_pedido.id, 'pedido', v_pedido.numero, 'anulada_en', v_registro.anulada_en,
                              'motivo', v_registro.motivo);
  end if;

  if exists (select 1 from anulaciones_venta a where a.empresa_id = v_usuario.empresa_id and a.clave_idempotencia = p_clave_idempotencia) then
    raise exception 'La clave % ya se usó para anular otra venta', p_clave_idempotencia using errcode = 'AV009';
  end if;

  if not v_es_admin
     and (v_venta.fecha at time zone 'America/Tegucigalpa')::date <> (now() at time zone 'America/Tegucigalpa')::date then
    raise exception 'Solo puedes anular facturas del mismo día. Para una anterior, contacta con el administrador' using errcode = 'AV003';
  end if;

  if v_venta.es_fiscal or btrim(coalesce(v_venta.cai_emision, '')) <> '' then
    raise exception 'Las facturas fiscales no se anulan con este procedimiento: falta definir su anulación o nota de crédito con el contador'
      using errcode = 'AV004';
  end if;

  -- Lo abonado después de facturar no se revierte aquí (C5). La prima es del pedido y sí se admite.
  if exists (
    select 1 from abonos a left join pagos g on g.id = a.pago_id
     where a.venta_id = v_venta.id and g.pedido_id is distinct from v_pedido.id
  ) then
    raise exception 'Esta factura tiene abonos registrados después de facturar y no puede anularse con este procedimiento: queda para los ajustes de crédito. Contacta con el administrador'
      using errcode = 'AV005';
  end if;

  if v_pedido.estado <> 'facturado' then
    raise exception 'El pedido % está %: solo se anula la factura de un pedido facturado', v_pedido.numero, v_pedido.estado
      using errcode = 'PI012';
  end if;

  v_bloqueo := liquidaciones_por_confirmar_del_pedido(v_pedido.id);

  if v_bloqueo is not null then
    raise exception 'El efectivo de este pedido está en la liquidación %. Mientras no se confirme o se rechace en Liquidaciones, la factura no se anula', v_bloqueo
      using errcode = 'PI013';
  end if;

  select coalesce(sum(a.monto), 0) into v_prima from abonos a where a.venta_id = v_venta.id;

  -- La factura: su registro (antes que el estado, como exige el disparador) y «Anulada».
  insert into anulaciones_venta (
    empresa_id, venta_id, numero_documento, estado_anterior, forma_pago, total, saldo_cancelado,
    ubicacion_venta, usuario_id, usuario_nombre, usuario_rol, ubicacion_usuario, motivo, tratamiento_dinero, clave_idempotencia
  ) values (
    v_usuario.empresa_id, v_venta.id, v_venta.numero_factura, v_venta.estado, v_venta.forma_pago, v_venta.total,
    case when v_venta.forma_pago = 'credito' then greatest(v_venta.total - v_prima, 0) else 0 end,
    v_venta.ubicacion_id, v_usuario.id, v_usuario.nombre, v_usuario.rol, v_usuario.ubicacion_id, v_motivo, 'pedido', p_clave_idempotencia
  )
  returning * into v_registro;

  update ventas set estado = 'anulada' where id = v_venta.id;

  -- El pedido: su cancelación, con lo que se recibió del cliente (es lo que hay que devolverle), y «Cancelado».
  select coalesce(sum(d.monto), 0), coalesce(sum(d.cargo), 0) into v_principal, v_cargo from dinero_a_devolver(v_pedido.id) d;

  insert into cancelaciones_de_pedido (
    empresa_id, pedido_id, estado_anterior, motivo, usuario_id, usuario_nombre, ubicacion_usuario,
    principal_recibido, cargo_recibido, clave_idempotencia, huella
  ) values (
    v_usuario.empresa_id, v_pedido.id, 'facturado', v_motivo, v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id,
    v_principal, v_cargo, p_clave_idempotencia || '|pedido', concat_ws('|', 'anular_factura', v_venta.id::text, v_motivo)
  );

  update pedidos_ubicacion set estado = 'cancelado' where id = v_pedido.id;

  insert into eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle)
  values (
    v_usuario.empresa_id, v_pedido.id, 'cancelado', v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id, v_motivo,
    jsonb_build_object('estado_anterior', 'facturado', 'venta_id', v_venta.id, 'numero_factura', v_venta.numero_factura,
                       'principal_recibido', v_principal, 'cargo_recibido', v_cargo)
  );

  return jsonb_build_object(
    'estado', 'anulada', 'venta_id', v_venta.id, 'numero_factura', v_venta.numero_factura,
    'pedido_id', v_pedido.id, 'pedido', v_pedido.numero, 'anulacion_id', v_registro.id, 'anulada_en', v_registro.anulada_en,
    'saldo_cancelado', v_registro.saldo_cancelado, 'dinero_por_devolver', v_principal + v_cargo
  );
end $$;

revoke execute on function public.anular_factura_de_pedido(uuid, text, text) from public, anon;
grant execute on function public.anular_factura_de_pedido(uuid, text, text) to authenticated;
