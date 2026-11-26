-- Precio de venta de las regalías y su valor comercial.
--
-- El reporte de regalías muestra cuánto vale, a precio de venta, lo que se
-- entregó sin cargo. Para eso cada regalía guarda el precio general del
-- catálogo (productos.precio, sin ISV) del momento en que se entregó: un
-- cambio posterior del catálogo no cambia el valor de lo ya entregado.
--
-- Decisiones del propietario (2026-11-25):
-- - el precio es el general del catálogo, sin ISV; no el especial del
--   cliente ni el negociado en la venta;
-- - lo copia la base al guardar la regalía, con un disparador: no se toca
--   registrar_venta_con_regalias() y se ignora cualquier precio que llegue;
-- - las regalías anteriores a esta migración quedan sin precio (null): no se
--   reconstruye con el precio actual del catálogo, que no es el de entonces;
-- - el valor comercial es solo informativo: precio × cantidad.
--
-- Lo que NO hace: no cambia ninguna fila existente (las regalías siguen
-- inmutables), ni la venta, el ISV, los cobros, el crédito, el inventario o
-- sus movimientos, ni los permisos. El costo sigue solo para el
-- administrador. No concede la columna nueva a la API: se lee por el reporte.
-- Idempotente.

-- ─────────────────────────────────────────────────────────
-- EL PRECIO DE CADA REGALÍA
-- ─────────────────────────────────────────────────────────
alter table public.regalias_venta
  add column if not exists precio_unitario numeric(12,2)
  constraint regalias_precio_no_negativo check (precio_unitario is null or precio_unitario >= 0);

revoke all (precio_unitario) on public.regalias_venta from public, anon, authenticated;

/*
  Copia el precio general del producto al guardar la regalía, dentro de la
  misma transacción que la registra. Lo que traiga la fila se reemplaza: el
  precio lo decide la base, no quien llama. Solo al insertar: una regalía
  entregada no se modifica (regalias_venta_no_cambia).
*/
create or replace function public.precio_de_la_regalia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select p.precio into new.precio_unitario
    from public.productos p
   where p.id = new.producto_id;

  return new;
end $$;

revoke execute on function public.precio_de_la_regalia() from public, anon, authenticated;

drop trigger if exists regalias_venta_precio on public.regalias_venta;
create trigger regalias_venta_precio before insert on public.regalias_venta
  for each row execute function public.precio_de_la_regalia();

-- ─────────────────────────────────────────────────────────
-- EL REPORTE
-- ─────────────────────────────────────────────────────────
/*
  El mismo reporte de la 0054, con dos columnas más al final: el precio de
  venta guardado y el valor comercial (precio × cantidad). Las dos son nulas
  si la regalía no tiene precio guardado, y las ve todo el que ve el reporte.
  El costo sigue saliendo nulo para quien no es administrador.

  Cambiar las columnas que devuelve obliga a borrarla y crearla de nuevo, sin
  CASCADE: nada depende de ella. La versión publicada sigue funcionando,
  porque lee las columnas por nombre e ignora las nuevas.
*/
drop function if exists public.reporte_de_regalias(date, date, uuid);

create function public.reporte_de_regalias(
  p_desde     date default null,
  p_hasta     date default null,
  p_ubicacion uuid default null
)
returns table (
  regalia_id      uuid,
  fecha           timestamptz,
  venta_id        uuid,
  numero_factura  text,
  estado_factura  text,
  cliente_id      uuid,
  cliente         text,
  producto_id     uuid,
  producto        text,
  codigo          text,
  cantidad        integer,
  ubicacion_id    uuid,
  ubicacion       text,
  usuario         text,
  motivo          text,
  detalle_motivo  text,
  costo_unitario  numeric,
  costo_total     numeric,
  precio_unitario numeric,
  valor_comercial numeric
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
           case when v_admin then round(r.costo_unitario * r.cantidad, 2) end,
           r.precio_unitario,
           round(r.precio_unitario * r.cantidad, 2)
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

-- ─────────────────────────────────────────────────────────
-- COMPROBACIÓN DE PERMISOS
-- ─────────────────────────────────────────────────────────
/*
  Si algo quedara con más acceso del previsto, la migración entera se
  deshace: el reporte solo para usuarios con sesión, el disparador para
  nadie, y la columna nueva sin lectura directa desde la API.
*/
do $$
begin
  if has_function_privilege('anon', 'public.reporte_de_regalias(date, date, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.reporte_de_regalias(date, date, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.precio_de_la_regalia()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.precio_de_la_regalia()', 'EXECUTE')
     or has_column_privilege('anon', 'public.regalias_venta', 'precio_unitario', 'SELECT')
     or has_column_privilege('authenticated', 'public.regalias_venta', 'precio_unitario', 'SELECT')
     or has_column_privilege('authenticated', 'public.regalias_venta', 'costo_unitario', 'SELECT') then
    raise exception 'Los permisos de la 0055 no quedaron como se esperaba: no se aplicó nada.';
  end if;
end $$;
