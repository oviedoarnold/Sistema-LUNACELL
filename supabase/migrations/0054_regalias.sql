-- Regalías a clientes.
--
-- Una regalía es un producto físico que se entrega sin cargo junto con una
-- venta. No es un descuento ni un precio en cero: no entra en detalle_venta,
-- así que no toca subtotal, ISV, total, cargo por medio, cobros, crédito,
-- abonos ni cuentas por cobrar. Queda en su propio registro, ligado a la
-- venta, y sale del inventario con su propio movimiento (tipo «regalia»).
--
-- Decisiones del propietario (D1–D9, 2026-11-21):
-- - permiso nuevo «Autorizar regalías» (regalias), que nadie recibe al
--   instalar: el administrador siempre; el vendedor, con el permiso; el
--   contador, nunca (solo consulta);
-- - la venta con regalías necesita un cliente registrado y un motivo por
--   factura; «otro» exige una descripción;
-- - bloqueadas en facturas fiscales hasta que el contador defina su
--   tratamiento (RG004). No cambia CAI, correlativos ni ISV;
-- - el costo del producto se guarda al entregar y solo lo ve el
--   administrador: la columna no se concede a `authenticated`;
-- - D5: anular la factura NO devuelve la regalía al inventario. anular_venta()
--   devuelve solo los movimientos «salida» de la venta, y la regalía tiene
--   su tipo propio: el registro y su movimiento quedan como están;
-- - las devoluciones trabajan con detalle_venta, así que no ven la regalía;
-- - sin regalías sin conexión ni en pedidos interubicación.
--
-- Errores: RG001 datos, RG002 motivo, RG003 sin cliente registrado,
-- RG004 factura fiscal, RG005 clave reusada con otras regalías,
-- RG006 producto inexistente o inactivo, RG007 existencia insuficiente, 42501.
--
-- Lo que NO hace: no cambia ninguna fila existente ni ninguna función de
-- venta, cobro, anulación, devolución, pedido o traslado. Idempotente.

-- ─────────────────────────────────────────────────────────
-- EL PERMISO Y EL TIPO DE MOVIMIENTO
-- ─────────────────────────────────────────────────────────
alter table public.permisos_usuario drop constraint if exists permisos_usuario_seccion_check;
alter table public.permisos_usuario add constraint permisos_usuario_seccion_check
  check (seccion in (
    'dashboard', 'pos', 'quotes', 'products', 'clients', 'suppliers', 'sales-history', 'settings', 'locations',
    'inventory-own', 'inventory-all', 'sales-void', 'sales-return', 'products-read',
    'orders-resolve', 'orders-cancel', 'settlements-view', 'settlements-manage',
    'regalias'
  ));

alter table public.movimientos_inventario drop constraint if exists movimientos_inventario_tipo_check;
alter table public.movimientos_inventario add constraint movimientos_inventario_tipo_check
  check (tipo in (
    'entrada', 'salida', 'ajuste', 'devolucion',
    'traslado_salida', 'traslado_entrada',
    'anulacion_venta',
    'entrega_pedido',
    'regalia'
  ));

-- Una regalía siempre sale (cantidad negativa) y siempre por una venta, una sola vez por producto.
alter table public.movimientos_inventario drop constraint if exists movimientos_regalia_de_una_venta;
alter table public.movimientos_inventario add constraint movimientos_regalia_de_una_venta
  check (tipo <> 'regalia' or (venta_id is not null and cantidad < 0));

create unique index if not exists movimientos_regalia_una_vez
  on public.movimientos_inventario (venta_id, producto_id) where tipo = 'regalia';

-- ─────────────────────────────────────────────────────────
-- EL REGISTRO
-- ─────────────────────────────────────────────────────────
/*
  Una fila por venta y producto. El nombre, el código y el costo son los de
  ese momento: corregir el catálogo después no cambia lo entregado.
*/
create table if not exists public.regalias_venta (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id),
  venta_id       uuid not null references public.ventas (id),
  cliente_id     uuid not null references public.clientes (id),
  producto_id    uuid not null references public.productos (id),
  nombre         text not null,
  codigo         text not null default '',
  cantidad       integer not null check (cantidad > 0),
  ubicacion_id   uuid not null,
  usuario_id     uuid not null references public.usuarios (id),
  usuario_nombre text not null,
  motivo         text not null check (motivo in ('cliente_frecuente', 'cortesia_comercial', 'compra_volumen', 'promocion_autorizada', 'otro')),
  detalle_motivo text not null default '' check (char_length(detalle_motivo) <= 300),
  costo_unitario numeric(12,2) not null check (costo_unitario >= 0),
  creado_en      timestamptz not null default now(),
  constraint regalias_ubicacion_de_la_empresa foreign key (ubicacion_id, empresa_id) references public.ubicaciones (id, empresa_id),
  constraint regalias_una_por_producto unique (venta_id, producto_id),
  constraint regalias_otro_con_descripcion check (motivo <> 'otro' or char_length(btrim(detalle_motivo)) >= 5)
);

create index if not exists regalias_venta_empresa_fecha on public.regalias_venta (empresa_id, creado_en);

create or replace function public.regalia_no_cambia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Una regalía entregada no se modifica ni se borra' using errcode = '42501';
end $$;

revoke execute on function public.regalia_no_cambia() from public, anon, authenticated;

drop trigger if exists regalias_venta_no_cambia on public.regalias_venta;
create trigger regalias_venta_no_cambia before update or delete on public.regalias_venta
  for each row execute function public.regalia_no_cambia();

drop trigger if exists regalias_venta_no_se_vacia on public.regalias_venta;
create trigger regalias_venta_no_se_vacia before truncate on public.regalias_venta
  for each statement execute function public.regalia_no_cambia();

drop trigger if exists impedir_escritura_del_contador on public.regalias_venta;
create trigger impedir_escritura_del_contador before insert or update or delete or truncate on public.regalias_venta
  for each statement execute function public.impedir_escritura_del_contador();

/*
  Se lee con la misma regla que la venta: la política de ventas decide. Solo
  escribe registrar_venta_con_regalias().

  El costo no se concede: RLS decide filas, no columnas. Sin el privilegio,
  la API no lo devuelve, ni filtra ni ordena por él (como productos.costo en
  la 0035). El administrador lo lee en reporte_de_regalias().
*/
alter table public.regalias_venta enable row level security;
revoke all on public.regalias_venta from public, anon, authenticated;
grant select (
  id, empresa_id, venta_id, cliente_id, producto_id, nombre, codigo, cantidad,
  ubicacion_id, usuario_id, usuario_nombre, motivo, detalle_motivo, creado_en
) on public.regalias_venta to authenticated;

drop policy if exists regalias_venta_lectura on public.regalias_venta;
create policy regalias_venta_lectura on public.regalias_venta for select to authenticated
  using (empresa_id = (select public.empresa_del_usuario()) and exists (select 1 from public.ventas v where v.id = regalias_venta.venta_id));

-- ─────────────────────────────────────────────────────────
-- LO QUE SE PIDE REGALAR
-- ─────────────────────────────────────────────────────────
/*
  La lista [{producto_id, cantidad}] agrupada por producto y en orden de
  producto. El mismo producto dos veces se suma, como en la venta. Pieza
  interna.
*/
create or replace function public.regalias_pedidas(p_regalias jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_elemento jsonb;
  v_producto uuid;
  v_cantidad integer;
begin
  if jsonb_typeof(p_regalias) is distinct from 'array' or jsonb_array_length(p_regalias) = 0 then
    raise exception 'Agrega al menos un producto a las regalías' using errcode = 'RG001';
  end if;

  if jsonb_array_length(p_regalias) > 100 then
    raise exception 'Una venta admite hasta 100 renglones de regalías' using errcode = 'RG001';
  end if;

  for v_elemento in select * from jsonb_array_elements(p_regalias) loop
    begin
      v_producto := v_elemento->>'producto_id';
      v_cantidad := v_elemento->>'cantidad';
    exception
      when invalid_text_representation or numeric_value_out_of_range or wrong_object_type then
        v_producto := null;
    end;

    if jsonb_typeof(v_elemento) <> 'object' or v_producto is null or v_cantidad is null or v_cantidad not between 1 and 100000 then
      raise exception 'Cada regalía necesita un producto y una cantidad entera mayor que cero' using errcode = 'RG001';
    end if;
  end loop;

  return (
    select jsonb_agg(jsonb_build_object('producto_id', pid, 'cantidad', qty) order by pid)
      from (
        select (e->>'producto_id')::uuid as pid, sum((e->>'cantidad')::integer)::integer as qty
          from jsonb_array_elements(p_regalias) e
         group by 1
      ) agrupado
  );
end $$;

-- Las regalías ya guardadas de una venta, con la misma forma. Pieza interna.
create or replace function public.regalias_guardadas(p_venta uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', r.producto_id, 'cantidad', r.cantidad) order by r.producto_id), '[]'::jsonb)
    from public.regalias_venta r
   where r.venta_id = p_venta
$$;

revoke execute on function public.regalias_pedidas(jsonb), public.regalias_guardadas(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- VENDER CON REGALÍAS
-- ─────────────────────────────────────────────────────────
/*
  La venta de siempre más sus regalías, en una sola transacción.

  1. Quién: un usuario activo con «Autorizar regalías» (el administrador
     siempre); nunca el contador. La venta lleva un cliente registrado, un
     motivo y una clave de idempotencia.
  2. Bloquea primero las existencias de su ubicación de TODO lo que sale,
     vendido y regalado, en orden de producto: el mismo orden que ventas,
     traslados y anulaciones. Así la venta y la regalía no se cruzan con
     otra operación, y un reintento simultáneo espera al primero.
  3. La venta la hace registrar_venta_con_medios(), sin copiarla: precios,
     precios negociados, ISV, medios, crédito, correlativo e idempotencia.
  4. Si es un reintento, las regalías guardadas tienen que ser las mismas;
     si no, es otra operación con la misma clave (RG005).
  5. Si la venta salió fiscal, se rechaza todo (RG004).
  6. Cada regalía se valida contra lo que quedó DESPUÉS de descontar lo
     vendido, que es validar la suma de las dos cantidades. Se guarda, se
     descuenta de la misma ubicación y se anota su movimiento.

  Si algo falla no queda ni la venta, ni la regalía, ni el movimiento.
*/
create or replace function public.registrar_venta_con_regalias(
  p_items              jsonb,
  p_forma_pago         text,
  p_cobros             jsonb,
  p_regalias           jsonb,
  p_motivo_regalia     text,
  p_detalle_motivo     text default '',
  p_cliente_id         uuid default null,
  p_nombre_cliente     text default null,
  p_rtn_comprador      text default '',
  p_fecha_vencimiento  date default null,
  p_nota               text default '',
  p_clave_idempotencia text default null,
  p_con_isv            boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario  usuarios;
  v_detalle  text := btrim(coalesce(p_detalle_motivo, ''));
  v_pedidas  jsonb;
  v_venta    jsonb;
  v_venta_id uuid;
  v_numero   text;
  v_item     record;
  v_producto record;
  v_quedan   integer;
  v_vendido  integer;
begin
  -- ── quién ──
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid() and u.activo and not u.debe_cambiar_contrasena
   limit 1;

  if v_usuario.id is null or v_usuario.rol = 'contador'
     or not (v_usuario.rol = 'admin' or usuario_tiene_permiso('regalias')) then
    raise exception 'No tienes permiso para autorizar regalías' using errcode = '42501';
  end if;

  -- ── qué se pide ──
  v_pedidas := regalias_pedidas(p_regalias);

  if p_motivo_regalia is null
     or p_motivo_regalia not in ('cliente_frecuente', 'cortesia_comercial', 'compra_volumen', 'promocion_autorizada', 'otro') then
    raise exception 'Elige el motivo de la regalía' using errcode = 'RG002';
  end if;

  if p_motivo_regalia = 'otro' and char_length(v_detalle) < 5 then
    raise exception 'Describe el motivo de la regalía (al menos 5 caracteres)' using errcode = 'RG002';
  end if;

  if char_length(v_detalle) > 300 then
    raise exception 'La descripción del motivo admite hasta 300 caracteres' using errcode = 'RG002';
  end if;

  if p_cliente_id is null then
    raise exception 'Una venta con regalías necesita un cliente registrado' using errcode = 'RG003';
  end if;

  if not exists (select 1 from clientes c where c.id = p_cliente_id and c.empresa_id = v_usuario.empresa_id) then
    raise exception 'El cliente no existe en esta empresa' using errcode = '42501';
  end if;

  if btrim(coalesce(p_clave_idempotencia, '')) = '' then
    raise exception 'Falta la clave de la operación' using errcode = 'RG001';
  end if;

  -- ── todo lo que sale, bajo candado y en orden ──
  perform 1
     from inventario_ubicacion iu
    where iu.ubicacion_id = v_usuario.ubicacion_id
      and iu.producto_id in (
        select (e->>'producto_id')::uuid from jsonb_array_elements(v_pedidas) e
        union
        select (e->>'producto_id')::uuid
          from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e
         where jsonb_typeof(e) = 'object'
      )
    order by iu.producto_id
      for update;

  -- ── la venta, como siempre ──
  v_venta := registrar_venta_con_medios(
    p_items, p_forma_pago, p_cobros, p_cliente_id, p_nombre_cliente, p_rtn_comprador,
    p_fecha_vencimiento, p_nota, p_clave_idempotencia, p_con_isv);

  v_venta_id := (v_venta->>'venta_id')::uuid;

  if (v_venta->>'repetida')::boolean then
    if regalias_guardadas(v_venta_id) <> v_pedidas
       or not exists (
         select 1 from regalias_venta r
          where r.venta_id = v_venta_id and r.motivo = p_motivo_regalia and r.detalle_motivo = v_detalle
       ) then
      raise exception 'La clave % ya se usó con otras regalías', p_clave_idempotencia using errcode = 'RG005';
    end if;

    return v_venta || jsonb_build_object('regalias', v_pedidas);
  end if;

  if (v_venta->>'es_fiscal')::boolean then
    raise exception 'Las regalías no se registran en facturas fiscales hasta que el contador defina su tratamiento'
      using errcode = 'RG004';
  end if;

  v_numero := v_venta->>'numero_factura';

  -- ── las regalías ──
  for v_item in
    select (e->>'producto_id')::uuid as producto_id, (e->>'cantidad')::integer as cantidad
      from jsonb_array_elements(v_pedidas) e
     order by (e->>'producto_id')::uuid
  loop
    select p.id, p.nombre, coalesce(p.codigo, '') as codigo, p.costo into v_producto
      from productos p
     where p.id = v_item.producto_id and p.empresa_id = v_usuario.empresa_id and p.activo;

    if not found then
      raise exception 'Uno de los productos de las regalías no existe o está inactivo' using errcode = 'RG006';
    end if;

    select iu.cantidad into v_quedan
      from inventario_ubicacion iu
     where iu.ubicacion_id = v_usuario.ubicacion_id and iu.producto_id = v_item.producto_id
       for update;

    if coalesce(v_quedan, 0) < v_item.cantidad then
      select coalesce(sum(d.cantidad), 0)::integer into v_vendido
        from detalle_venta d where d.venta_id = v_venta_id and d.producto_id = v_item.producto_id;

      raise exception 'No hay suficiente «%» en %: hay %, y entre lo vendido (%) y lo regalado (%) se piden %',
        v_producto.nombre, (select u.nombre from ubicaciones u where u.id = v_usuario.ubicacion_id),
        coalesce(v_quedan, 0) + v_vendido, v_vendido, v_item.cantidad, v_vendido + v_item.cantidad
        using errcode = 'RG007';
    end if;

    insert into regalias_venta (
      empresa_id, venta_id, cliente_id, producto_id, nombre, codigo, cantidad, ubicacion_id,
      usuario_id, usuario_nombre, motivo, detalle_motivo, costo_unitario
    ) values (
      v_usuario.empresa_id, v_venta_id, p_cliente_id, v_producto.id, v_producto.nombre, v_producto.codigo,
      v_item.cantidad, v_usuario.ubicacion_id, v_usuario.id, v_usuario.nombre, p_motivo_regalia, v_detalle,
      v_producto.costo
    );

    update inventario_ubicacion
       set cantidad = cantidad - v_item.cantidad, actualizado_en = now()
     where ubicacion_id = v_usuario.ubicacion_id and producto_id = v_item.producto_id;

    insert into movimientos_inventario (empresa_id, producto_id, usuario_id, venta_id, ubicacion_id, tipo, cantidad, motivo)
    values (v_usuario.empresa_id, v_item.producto_id, v_usuario.id, v_venta_id, v_usuario.ubicacion_id,
            'regalia', -v_item.cantidad, 'Regalía en ' || v_numero);
  end loop;

  return v_venta || jsonb_build_object('regalias', v_pedidas);
end $$;

revoke execute on function public.registrar_venta_con_regalias(jsonb, text, jsonb, jsonb, text, text, uuid, text, text, date, text, text, boolean) from public, anon;
grant execute on function public.registrar_venta_con_regalias(jsonb, text, jsonb, jsonb, text, text, uuid, text, text, date, text, text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────
-- EL REPORTE
-- ─────────────────────────────────────────────────────────
/*
  Las regalías entregadas entre dos días (hora de Honduras), con el estado
  actual de su factura: una factura anulada conserva su regalía, que se
  entregó y no volvió.

  Quién ve qué:
  - el administrador, toda su empresa, con el costo;
  - el contador con «Historial», todas las ubicaciones, sin costo;
  - el vendedor con «Historial», solo su ubicación, sin costo;
  - nadie más, ni otra empresa.

  SECURITY DEFINER para leer el costo, que `authenticated` no tiene; por eso
  la empresa y la visibilidad se derivan aquí del usuario, nunca de un
  parámetro, y el costo sale nulo para quien no es administrador.
*/
create or replace function public.reporte_de_regalias(
  p_desde     date default null,
  p_hasta     date default null,
  p_ubicacion uuid default null
)
returns table (
  regalia_id     uuid,
  fecha          timestamptz,
  venta_id       uuid,
  numero_factura text,
  estado_factura text,
  cliente_id     uuid,
  cliente        text,
  producto_id    uuid,
  producto       text,
  codigo         text,
  cantidad       integer,
  ubicacion_id   uuid,
  ubicacion      text,
  usuario        text,
  motivo         text,
  detalle_motivo text,
  costo_unitario numeric,
  costo_total    numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario public.usuarios;
  v_admin   boolean;
  v_todas   boolean;
  v_hoy     date := (now() at time zone 'America/Tegucigalpa')::date;
  v_desde   date := coalesce(p_desde, v_hoy - 30);
  v_hasta   date := coalesce(p_hasta, v_hoy);
begin
  select u.* into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid() and u.activo and not u.debe_cambiar_contrasena
   limit 1;

  v_admin := v_usuario.rol = 'admin';

  if v_usuario.id is null or not (v_admin or public.usuario_tiene_permiso('sales-history')) then
    raise exception 'No tienes permiso para consultar las regalías' using errcode = '42501';
  end if;

  if v_desde > v_hasta then
    raise exception 'La fecha inicial es posterior a la final' using errcode = 'RG001';
  end if;

  v_todas := v_admin or v_usuario.rol = 'contador';

  return query
    select r.id, r.creado_en, r.venta_id, v.numero_factura, v.estado, r.cliente_id, v.nombre_cliente,
           r.producto_id, r.nombre, r.codigo, r.cantidad, r.ubicacion_id, u.nombre, r.usuario_nombre,
           r.motivo, r.detalle_motivo,
           case when v_admin then r.costo_unitario end,
           case when v_admin then round(r.costo_unitario * r.cantidad, 2) end
      from public.regalias_venta r
      join public.ventas v on v.id = r.venta_id
      left join public.ubicaciones u on u.id = r.ubicacion_id
     where r.empresa_id = v_usuario.empresa_id
       and r.creado_en >= (v_desde::timestamp at time zone 'America/Tegucigalpa')
       and r.creado_en < ((v_hasta + 1)::timestamp at time zone 'America/Tegucigalpa')
       and (p_ubicacion is null or r.ubicacion_id = p_ubicacion)
       and (v_todas or (v_usuario.ubicacion_id is not null and r.ubicacion_id = v_usuario.ubicacion_id))
     order by r.creado_en desc, r.id;
end $$;

revoke execute on function public.reporte_de_regalias(date, date, uuid) from public, anon;
grant execute on function public.reporte_de_regalias(date, date, uuid) to authenticated;
