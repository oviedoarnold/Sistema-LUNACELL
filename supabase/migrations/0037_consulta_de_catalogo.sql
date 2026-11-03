-- Consultar el catálogo, sin administrarlo: la sección `products-read`.
--
-- `products` abre la pantalla de Inventario y también las escrituras de
-- productos (0023, 0024). Con ella no se puede dar a alguien solo la
-- consulta, y al contador se le niega a propósito (0036).
--
-- Lo único que cambia es la lista de secciones que acepta permisos_usuario.
-- `products-read` no aparece en ninguna política: la lectura de productos
-- sigue siendo la de siempre y sigue sin incluir el costo (0035), y el
-- contador sigue sin poder escribir (0036). No concede nada en la base; es
-- la marca con la que la pantalla sabe que puede abrirle el catálogo.
--
-- Lo que NO hace: no toca ninguna fila, ni le da la sección a nadie.
-- Idempotente.

-- ─────────────────────────────────────────────────────────
-- LA SECCIÓN NUEVA
-- ─────────────────────────────────────────────────────────
/*
  Igual que en la 0033: la restricción se busca por lo que dice y no por su
  nombre. Las filas que ya existen se revisan al crearla y todas la cumplen.
*/
do $$
declare
  v_restriccion text;
begin
  for v_restriccion in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.permisos_usuario'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%seccion%'
  loop
    execute format('alter table public.permisos_usuario drop constraint %I', v_restriccion);
  end loop;
end $$;

alter table public.permisos_usuario
  add constraint permisos_usuario_seccion_check
  check (seccion in (
    'dashboard', 'pos', 'quotes', 'products',
    'clients', 'suppliers', 'sales-history', 'settings',
    'locations',
    'inventory-own', 'inventory-all',
    'sales-void',
    'products-read'
  ));
