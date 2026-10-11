-- La tienda no vende sin conexión hasta una autorización explícita (OFF-1.4).
--
-- Lunacell Store se habilita al final, después de la revisión fiscal. Hasta
-- hoy solo lo impedía el procedimiento: la base prohíbe vender sin conexión
-- a una ubicación fiscal (0027), pero la tienda todavía no está marcada como
-- fiscal, y emite_fiscal no se toca hasta esa revisión.
--
-- La protección no depende del nombre de la ubicación:
-- 1. solo los camiones y las bodegas pueden tener vende_sin_conexion;
-- 2. la aplicación —ni siquiera un administrador— no puede sacar a una
--    ubicación del tipo «tienda», que sería la forma de esquivar la regla 1.
--
-- Habilitar la tienda exigirá una migración nueva, revisada y aplicada con
-- el procedimiento de migraciones: esa es la autorización explícita.
--
-- Lo que NO hace: no cambia ningún dato. Hoy ninguna ubicación vende sin
-- conexión, así que la restricción se valida sin tocar filas. No modifica
-- 0027–0029.

alter table public.ubicaciones
  drop constraint if exists ubicaciones_sin_conexion_solo_camion_o_bodega;

alter table public.ubicaciones
  add constraint ubicaciones_sin_conexion_solo_camion_o_bodega
  check (not vende_sin_conexion or tipo in ('camion', 'bodega'));

/*
  Mismo criterio que ubicaciones_sin_conexion_solo_admin() (0027): vigila a
  la aplicación (authenticated/anon), no al dueño de la base, que es quien
  aplica las migraciones.
*/
create or replace function public.ubicaciones_tienda_conserva_su_tipo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if old.tipo = 'tienda' and new.tipo is distinct from old.tipo then
    raise exception 'El tipo de una tienda solo se cambia con una migración autorizada: así no puede habilitarse para vender sin conexión'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists ubicaciones_tienda_conserva_su_tipo on public.ubicaciones;
create trigger ubicaciones_tienda_conserva_su_tipo
  before update of tipo on public.ubicaciones
  for each row execute function public.ubicaciones_tienda_conserva_su_tipo();

revoke execute on function public.ubicaciones_tienda_conserva_su_tipo() from public, anon, authenticated;
