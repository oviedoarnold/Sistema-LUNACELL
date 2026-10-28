-- La auditoría de rescates y las ventas por conciliar no se escriben,
-- cambian ni vacían desde fuera (SEC-5).
--
-- La 0027 dejó auditoria_rescates como un registro que solo se inserta, y
-- ventas_por_conciliar como una cola que solo cambia al resolverse. A las
-- dos les quitó todo a anon y authenticated. Pero quedaron dos puertas:
--
-- - service_role, la clave del servidor, conserva el INSERT, UPDATE, DELETE
--   y TRUNCATE que Supabase concede por omisión sobre toda tabla nueva, y
--   pasa por encima de RLS. Con ella se puede:
--   - insertar un intento de rescate que nunca ocurrió, a nombre de
--     cualquier administrador;
--   - insertar una venta por conciliar inventada;
--   - resolver una venta pendiente con un UPDATE directo, sin pasar por
--     conciliar_venta() ni por el administrador.
--   Los disparadores de la 0027 detienen el DELETE y los cambios a los
--   datos, pero no el INSERT ni esa primera resolución.
-- - TRUNCATE no dispara los disparadores de fila: quien lo tenga vacía la
--   tabla entera de una vez, y la 0027 no lo vigila.
--
-- La secuencia de la columna id de auditoria_rescates también quedó con lo
-- que Supabase concede por omisión (USAGE, SELECT y UPDATE para anon,
-- authenticated y service_role). Nadie la necesita.
--
-- La corrección es la misma que la 0033 ya trae para anulaciones_venta:
-- a service_role se le deja solo leer, como a la aplicación, y TRUNCATE se
-- detiene con un disparador por sentencia.
--
-- Quién sigue escribiendo, todas SECURITY DEFINER del dueño de las tablas,
-- que no dependen de estos privilegios:
-- - auditoria_rescates: rescatar_venta_sin_conexion();
-- - ventas_por_conciliar: guardar_venta_por_conciliar() (desde la
--   sincronización y el rescate) y conciliar_venta().
-- La aplicación solo lee las dos tablas y no usa service_role en ningún lado.
--
-- Lo que NO hace: no toca ninguna fila ni ningún otro dato, no cambia las
-- políticas de lectura, ni las funciones de sincronización, rescate o
-- conciliación, ni los disparadores de la 0027. Idempotente.

-- ─────────────────────────────────────────────────────────
-- AUDITORÍA DE RESCATES
-- ─────────────────────────────────────────────────────────
drop trigger if exists auditoria_rescates_sin_vaciar on public.auditoria_rescates;
create trigger auditoria_rescates_sin_vaciar
  before truncate on public.auditoria_rescates
  for each statement execute function public.auditoria_rescates_inmutable();

revoke all on public.auditoria_rescates from public, anon, authenticated, service_role;
grant select on public.auditoria_rescates to authenticated, service_role;

revoke all on sequence public.auditoria_rescates_id_seq from public, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────
-- VENTAS POR CONCILIAR
-- ─────────────────────────────────────────────────────────
/*
  Una función propia y no ventas_por_conciliar_inmutable(): esa mira
  old.estado, y un disparador por sentencia no tiene fila vieja.
*/
create or replace function public.ventas_por_conciliar_sin_vaciar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Las ventas por conciliar no se vacían: se aplican o se anulan con su motivo'
    using errcode = '42501';
end $$;

revoke execute on function public.ventas_por_conciliar_sin_vaciar() from public, anon, authenticated;

drop trigger if exists ventas_por_conciliar_sin_vaciar on public.ventas_por_conciliar;
create trigger ventas_por_conciliar_sin_vaciar
  before truncate on public.ventas_por_conciliar
  for each statement execute function public.ventas_por_conciliar_sin_vaciar();

revoke all on public.ventas_por_conciliar from public, anon, authenticated, service_role;
grant select on public.ventas_por_conciliar to authenticated, service_role;
