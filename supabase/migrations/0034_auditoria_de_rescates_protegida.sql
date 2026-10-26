-- La auditoría de rescates no se escribe, cambia ni vacía desde fuera (SEC-5).
--
-- La 0027 dejó auditoria_rescates como un registro que solo se inserta, y
-- le quitó todo a anon y authenticated. Pero quedaron dos puertas:
--
-- - service_role, la clave del servidor, conserva el INSERT, UPDATE, DELETE
--   y TRUNCATE que Supabase concede por omisión sobre toda tabla nueva, y
--   pasa por encima de RLS. Con ella se puede insertar un intento de rescate
--   que nunca ocurrió, a nombre de cualquier administrador. El UPDATE y el
--   DELETE los detiene el disparador de la 0027; el INSERT, no.
-- - TRUNCATE no dispara los disparadores de fila: quien lo tenga vacía la
--   tabla entera de una vez, y la 0027 no lo vigila.
--
-- La secuencia de la columna id también quedó con lo que Supabase concede
-- por omisión (USAGE, SELECT y UPDATE para anon, authenticated y
-- service_role). Nadie la necesita: el único que inserta es
-- rescatar_venta_sin_conexion(), SECURITY DEFINER del dueño.
--
-- La corrección es la misma que la 0033 ya trae para anulaciones_venta:
-- a service_role se le deja solo leer, como a la aplicación, y TRUNCATE se
-- detiene con un disparador por sentencia que reutiliza la función de la
-- 0027.
--
-- Quién sigue escribiendo: rescatar_venta_sin_conexion(), que corre como el
-- dueño de la tabla. La aplicación no usa service_role en ningún lado.
--
-- Lo que NO hace: no toca ninguna fila de la auditoría ni ningún otro dato,
-- no cambia la política de lectura (solo el administrador de la empresa),
-- ni la función de rescate, ni la de conciliación. Idempotente.

drop trigger if exists auditoria_rescates_sin_vaciar on public.auditoria_rescates;
create trigger auditoria_rescates_sin_vaciar
  before truncate on public.auditoria_rescates
  for each statement execute function public.auditoria_rescates_inmutable();

revoke all on public.auditoria_rescates from public, anon, authenticated, service_role;
grant select on public.auditoria_rescates to authenticated, service_role;

revoke all on sequence public.auditoria_rescates_id_seq from public, anon, authenticated, service_role;
