-- El costo de los productos solo lo ven los administradores.
--
-- Regla del cliente: el costo de adquisición, el margen, la utilidad y lo
-- que permita deducirlos son confidenciales. Solo los consulta un
-- administrador; no el contador, ni los vendedores, ni quien lleva el
-- inventario o la bodega.
--
-- Hasta aquí el costo vivía en productos.costo y lo leía cualquier usuario
-- activo de la empresa:
-- - la política productos_lectura deja ver todas las filas de la empresa,
--   con todas sus columnas;
-- - la vista productos_con_stock lo incluye, y la aplicación la pide con
--   `select *` para el POS, las cotizaciones, el inventario y la copia sin
--   conexión. El costo viajaba al navegador de cada vendedor aunque la
--   pantalla no lo mostrara.
--
-- Ninguna otra columna, vista, función ni la Edge Function `acceso`
-- devuelve el costo, ni calcula margen o utilidad a partir de él: se
-- revisó migración por migración. detalle_venta y detalle_cotizacion
-- guardan el precio de venta, no el costo.
--
-- La corrección:
-- 1. productos_con_stock deja de traer el costo.
-- 2. `authenticated` pierde la lectura de la columna costo. Las demás se
--    conceden una por una. Sin el privilegio, PostgREST no puede
--    devolverla, ni filtrar ni ordenar por ella: un `costo=gt.100` también
--    se rechaza, así que no se puede adivinar por tanteo.
-- 3. El administrador lee los costos por costos_de_productos(), que
--    comprueba el rol en la base.
-- 4. Un disparador impide que alguien que no es administrador cambie el
--    costo, aunque tenga el permiso `products`.
--
-- Lo que NO hace: no toca ninguna fila ni ningún costo guardado, ni las
-- políticas de filas, ni las funciones de venta, inventario o traslados.
-- Idempotente.

-- ─────────────────────────────────────────────────────────
-- LA VISTA DEL CATÁLOGO, SIN COSTO
-- ─────────────────────────────────────────────────────────
/*
  Se borra y se crea: una vista no puede perder una columna con
  `create or replace`. Nada depende de ella en la base.

  Tiene que ir antes de quitar el privilegio: una vista `security_invoker`
  lee con los privilegios de quien consulta, y si siguiera nombrando
  p.costo fallaría para todos los que no lo pueden leer.
*/
drop view if exists public.productos_con_stock;

create view public.productos_con_stock
with (security_invoker = on)
as
  select
    p.id,
    p.empresa_id,
    p.proveedor_id,
    p.codigo,
    p.nombre,
    p.categoria,
    p.precio,
    p.stock_minimo,
    p.imagen_url,
    p.activo,
    p.creado_en,
    coalesce(sum(m.cantidad), 0)::integer as stock
  from public.productos p
  left join public.movimientos_inventario m on m.producto_id = p.id
  group by p.id;

grant select on public.productos_con_stock to authenticated;
revoke all on public.productos_con_stock from anon;

-- ─────────────────────────────────────────────────────────
-- LECTURA DE PRODUCTOS: TODO MENOS EL COSTO
-- ─────────────────────────────────────────────────────────
/*
  Por qué privilegios de columna y no una política: RLS decide qué filas
  se ven, no qué columnas. Y el administrador y el vendedor entran con el
  mismo rol de la base, `authenticated`, así que la columna se le quita a
  los dos. El administrador la lee por la función de abajo.

  Si se agrega una columna a productos, hay que concederla aquí también.
  Una prueba (pruebas-sql/costos-confidenciales.test.mjs) falla si alguna
  columna que no sea el costo queda sin conceder.

  anon no lee productos: no tiene política, así que tampoco veía filas.
*/
revoke select on public.productos from anon, authenticated;

grant select (
  id, empresa_id, proveedor_id, codigo, nombre, categoria,
  precio, stock_minimo, imagen_url, activo, creado_en
) on public.productos to authenticated;

-- ─────────────────────────────────────────────────────────
-- EL COSTO, SOLO PARA EL ADMINISTRADOR
-- ─────────────────────────────────────────────────────────
/*
  Devuelve el costo de los productos de la empresa de quien llama. Si no
  es administrador, la respuesta es un error de permiso y no una lista
  vacía: la pantalla tiene que saber que no se lo dieron.

  SECURITY DEFINER para leer la columna que `authenticated` ya no ve. Es
  seguro porque comprueba el rol antes de leer y deriva la empresa del
  usuario; nunca la recibe como parámetro.
*/
create or replace function public.costos_de_productos()
returns table (producto_id uuid, costo numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.usuario_es_admin() then
    raise exception 'Solo un administrador puede consultar los costos'
      using errcode = '42501';
  end if;

  return query
    select p.id, p.costo
      from public.productos p
     where p.empresa_id = public.empresa_del_usuario();
end $$;

revoke execute on function public.costos_de_productos() from public, anon;
grant execute on function public.costos_de_productos() to authenticated;

-- ─────────────────────────────────────────────────────────
-- EL COSTO, SOLO LO CAMBIA EL ADMINISTRADOR
-- ─────────────────────────────────────────────────────────
/*
  Quien lleva el inventario puede tener el permiso `products` para crear
  productos y corregir su precio, pero no conoce el costo y no lo decide.

  El valor que manda alguien que no es administrador se descarta, sin
  error: al crear, el costo queda en 0 hasta que lo fije el administrador;
  al cambiar, se conserva el que había. No se rechaza porque un teléfono
  con la versión anterior de la aplicación guardada todavía manda la
  columna con lo que leyó, y rechazarlo le impediría corregir un precio o
  un nombre. Descartarlo no le dice nada del costo.

  Mismo criterio que ubicaciones_fiscal_solo_admin() (0023) sobre a quién
  vigila: al rol efectivo de la base. El dueño de la base y service_role
  quedan fuera.
*/
create or replace function public.productos_costo_solo_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if public.usuario_es_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.costo := 0;
  else
    new.costo := old.costo;
  end if;

  return new;
end $$;

drop trigger if exists productos_costo_solo_admin on public.productos;

create trigger productos_costo_solo_admin
  before insert or update on public.productos
  for each row
  execute function public.productos_costo_solo_admin();

revoke execute on function public.productos_costo_solo_admin() from public, anon, authenticated;
