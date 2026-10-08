-- Nombres de usuarios de la propia empresa, sin abrir la tabla usuarios.
--
-- El historial de traslados muestra quién hizo cada uno. Para resolverlo
-- leía la tabla usuarios, y su política —con razón— solo deja a un
-- vendedor ver su propia fila: el autor de un compañero quedaba como "—".
-- Abrir esa política no es la salida: cada fila trae correo, auth_id,
-- rol, estado, ubicación y fechas de invitación, y una política no puede
-- recortar columnas.
--
-- nombres_de_usuarios() entrega solo id y nombre, solo de los ids que se
-- le piden y solo de la empresa de quien llama. Sirve para cualquier
-- historial que guarde usuario_id (ventas, cotizaciones, pagos), no solo
-- para traslados.
--
-- Lo que NO hace: no cambia las políticas de usuarios, no escribe nada y
-- no toca ninguna otra función.

/*
  Por qué SECURITY DEFINER: la política de usuarios impide justamente
  leer las filas ajenas, y los permisos por columna no distinguen al
  vendedor del administrador —los dos son `authenticated`—. La función
  corre como su dueño y hace ella misma el recorte: empresa de quien
  llama, ids pedidos, dos columnas.

  Por qué plpgsql y no sql: una lista desmedida tiene que ser un error
  claro (22023), y una función sql no puede lanzarlo.

  - search_path vacío y todo calificado: nadie puede colar un objeto con
    el mismo nombre en otro esquema.
  - public.empresa_del_usuario() es nula si quien llama no es un usuario
    activo de alguna empresa; entonces no coincide nada y no sale nada.
  - El usuario pedido puede estar inactivo: un traslado viejo lo hizo
    alguien que ya no trabaja, y su nombre sigue siendo historia.
  - 100 ids como techo: una página del historial son 25 traslados, y
    alcanza con holgura para otros historiales.
  - Una lista nula o vacía no es un error: no hay a quién nombrar.
*/
create or replace function public.nombres_de_usuarios(p_ids uuid[])
returns table (id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_ids), 0) > 100 then
    raise exception 'Se pidieron % usuarios; el máximo es 100', cardinality(p_ids)
      using errcode = '22023';
  end if;

  return query
    select u.id, u.nombre
      from public.usuarios u
     where u.id = any (p_ids)
       and u.empresa_id = public.empresa_del_usuario();
end $$;

-- ─────────────────────────────────────────────────────────
-- QUIÉN PUEDE EJECUTARLA
-- ─────────────────────────────────────────────────────────
revoke execute on function public.nombres_de_usuarios(uuid[]) from public;

revoke execute on function public.nombres_de_usuarios(uuid[]) from anon;

grant execute on function public.nombres_de_usuarios(uuid[]) to authenticated, service_role;
