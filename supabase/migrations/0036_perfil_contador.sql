-- Perfil de contador: consulta, sin escribir nada.
--
-- Hasta aquí había dos roles, admin y vendedor, y los permisos por sección
-- (permisos_usuario) abren la lectura y la escritura a la vez: quien tiene
-- `sales-history` ve el historial y también registra cobros. Con eso no se
-- puede dar a alguien solo la consulta.
--
-- El contador:
-- - es un rol propio, `contador`. No es administrador: usuario_es_admin()
--   le responde que no, así que no ve costos (0035), ni usuarios, ni
--   auditorías;
-- - ve lo que el administrador le habilite por sección, como cualquier
--   empleado. Con `sales-history` ve las ventas y los cobros de todas las
--   ubicaciones, no solo de una: no opera desde ninguna;
-- - no escribe en ninguna tabla, por ningún camino. Un disparador por
--   sentencia en cada tabla de `public` lo detiene antes de que cambie una
--   fila, venga la escritura directa por la API o desde una función
--   SECURITY DEFINER (venta, cobro, anulación, traslado, conciliación…).
--   Las funciones corren como su dueño, pero auth.uid() sigue siendo el de
--   quien llama: por eso el disparador mira auth.uid() y no current_user.
--   Las imágenes de producto viven en Storage, donde no se le pone un
--   disparador: ahí se le cierran las políticas de escritura.
--
-- Lo que NO hace: no crea usuarios ni cambia el rol de nadie, no toca
-- ninguna fila, ni la lectura de los demás roles. El inicio de sesión, el
-- cambio de contraseña y el alta de empleados los hace la función
-- `acceso` con la clave del servidor, sin auth.uid(): el disparador no los
-- alcanza. Idempotente.

-- ─────────────────────────────────────────────────────────
-- EL ROL
-- ─────────────────────────────────────────────────────────
alter table public.usuarios drop constraint if exists usuarios_rol_check;
alter table public.usuarios add constraint usuarios_rol_check
  check (rol in ('admin', 'vendedor', 'contador'));

/*
  Del mismo molde que usuario_es_admin() (0026): solo cuenta un usuario
  activo que ya eligió su contraseña.
*/
create or replace function public.usuario_es_contador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rol = 'contador' from usuarios
      where auth_id = auth.uid() and activo and not debe_cambiar_contrasena
      limit 1),
    false
  )
$$;

revoke execute on function public.usuario_es_contador() from public, anon;
grant execute on function public.usuario_es_contador() to authenticated;

-- ─────────────────────────────────────────────────────────
-- NO ESCRIBE: UN DISPARADOR EN CADA TABLA
-- ─────────────────────────────────────────────────────────
/*
  A diferencia de usuario_es_contador(), aquí no importa si está activo o
  si debe cambiar la contraseña: una cuenta de contador no escribe en
  ningún estado.

  Por sentencia y no por fila: se pregunta una vez, y también detiene la
  sentencia que no habría cambiado ninguna fila.

  SECURITY DEFINER para leer usuarios sin depender de lo que la política
  de usuarios le deje ver a quien llama.
*/
create or replace function public.impedir_escritura_del_contador()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.usuarios u
     where u.auth_id = auth.uid()
       and u.rol = 'contador'
  ) then
    raise exception 'El perfil de contador es de solo consulta'
      using errcode = '42501';
  end if;

  return null;
end $$;

revoke execute on function public.impedir_escritura_del_contador() from public, anon, authenticated;

/*
  Todas las tablas de `public` que existen hoy. Una tabla nueva tiene que
  traer el suyo: una prueba (pruebas-sql/perfil-contador.test.mjs) falla
  si alguna queda sin él.
*/
do $$
declare
  v_tabla text;
begin
  for v_tabla in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format(
      'drop trigger if exists impedir_escritura_del_contador on public.%I',
      v_tabla
    );
    execute format(
      'create trigger impedir_escritura_del_contador
         before insert or update or delete or truncate on public.%I
         for each statement
         execute function public.impedir_escritura_del_contador()',
      v_tabla
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────
-- LEE TODAS LAS UBICACIONES
-- ─────────────────────────────────────────────────────────
/*
  Las mismas políticas de la 0029, con una vía más: el contador con
  `sales-history` ve las ventas y los pagos de todas las ubicaciones. El
  detalle, los abonos y las anulaciones se ven si se ve su venta, así que
  lo siguen sin cambios.

  El inventario y los traslados no necesitan nada: `inventory-all` ya
  abre todas las ubicaciones (0015, 0020), y se le concede o no como a
  cualquiera.
*/
drop policy if exists ventas_lectura on public.ventas;
create policy ventas_lectura on public.ventas
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and (
      (select public.usuario_es_admin())
      or ubicacion_id = (select public.ubicacion_del_usuario())
      or ((select public.usuario_es_contador()) and (select public.usuario_tiene_permiso('sales-history')))
    )
  );

drop policy if exists pagos_lectura on public.pagos;
create policy pagos_lectura on public.pagos
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and (
      (select public.usuario_es_admin())
      or ubicacion_id = (select public.ubicacion_del_usuario())
      or ((select public.usuario_es_contador()) and (select public.usuario_tiene_permiso('sales-history')))
    )
  );

-- ─────────────────────────────────────────────────────────
-- IMÁGENES DE PRODUCTO: SIN ESCRITURA
-- ─────────────────────────────────────────────────────────
/*
  Las mismas tres políticas de la 0024, con el contador fuera. La lectura
  no cambia.
*/
drop policy if exists imagenes_de_producto_escritura on storage.objects;
create policy imagenes_de_producto_escritura on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
    and not (select public.usuario_es_contador())
  );

drop policy if exists imagenes_de_producto_reemplazo on storage.objects;
create policy imagenes_de_producto_reemplazo on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
    and not (select public.usuario_es_contador())
  )
  with check (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
    and not (select public.usuario_es_contador())
  );

drop policy if exists imagenes_de_producto_borrado on storage.objects;
create policy imagenes_de_producto_borrado on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
    and not (select public.usuario_es_contador())
  );
