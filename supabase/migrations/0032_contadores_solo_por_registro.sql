-- La aplicación no escribe los contadores de la empresa (A-1b).
--
-- Desde la 0031 nadie puede pedirle a siguiente_correlativo() un número de
-- factura o interno sin registrar un documento. Pero quedaba otra puerta:
-- `authenticated` tiene UPDATE sobre toda la tabla `empresas`, incluidas las
-- columnas proximo_correlativo_*, y la política empresas_update deja
-- escribir al administrador. Un administrador podía adelantar el contador
-- con un UPDATE directo por la API y dejar un hueco en el rango autorizado
-- del CAI, sin pasar por ninguna función. La aplicación no lo hace: solo los
-- lee.
--
-- Revocar el privilegio solo sobre esas columnas no alcanza: PostgreSQL
-- concede el UPDATE de toda la tabla, y uno por columna no lo resta. Por eso
-- un disparador, con el mismo criterio que los de 0027 y 0030: vigila a la
-- aplicación (authenticated/anon), no al dueño de la base.
--
-- Quién sigue moviendo los contadores:
-- - registrar_venta_ubicacion(), conciliar_venta() y
--   siguiente_correlativo_de_cotizacion(), SECURITY DEFINER del dueño: el
--   UPDATE que hacen corre como ese dueño;
-- - el dueño de la base (SQL Editor, migraciones), que es quien pone el
--   contador fiscal al inicio de un rango autorizado nuevo.
--
-- El disparador solo se activa si la escritura nombra un contador y lo
-- cambia: guardar los datos de la empresa (nombre, CAI, rango...) sigue
-- igual, y reenviar el mismo valor no cuenta como cambio.
--
-- Lo que NO hace: no cambia ningún contador ni ningún dato, ni la firma de
-- ninguna función. Idempotente.

create or replace function public.empresas_contadores_solo_por_registro()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.proximo_correlativo_factura is distinct from old.proximo_correlativo_factura
     or new.proximo_correlativo_interno is distinct from old.proximo_correlativo_interno
     or new.proximo_correlativo_cotizacion is distinct from old.proximo_correlativo_cotizacion then
    raise exception 'Los contadores de documentos solo los mueve el registro de un documento'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists empresas_contadores_solo_por_registro on public.empresas;
create trigger empresas_contadores_solo_por_registro
  before update of proximo_correlativo_factura, proximo_correlativo_interno, proximo_correlativo_cotizacion
  on public.empresas
  for each row execute function public.empresas_contadores_solo_por_registro();

revoke execute on function public.empresas_contadores_solo_por_registro() from public, anon, authenticated;
