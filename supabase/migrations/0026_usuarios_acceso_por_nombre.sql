-- Usuarios: alta por el administrador, acceso por nombre de usuario, bloqueo
-- por intentos, desbloqueo y cambio obligatorio de contraseña (USR-1).
--
-- Hasta aquí un empleado no tenía cómo entrar: la pantalla solo creaba una
-- fila en `usuarios` y esperaba que la persona se registrara sola con ese
-- correo, y un disparador la vinculaba por coincidencia de correo, sin
-- exigir que estuviera confirmado.
--
-- Ahora la identidad la crea la Edge Function `acceso`, con privilegios que
-- solo existen en el servidor, y la vincula por su id. Esta migración es la
-- mitad que vive en la base: las columnas, el contador de intentos, las
-- funciones que la Edge Function llama con service_role, el desbloqueo que
-- el administrador llama desde la aplicación, y el bloqueo de toda
-- operación mientras no se cambie la contraseña temporal.
--
-- Lo que NO hace: no toca ningún dato. El administrador actual queda sin
-- nombre de usuario y sigue entrando con su correo.

-- ─────────────────────────────────────────────────────────
-- COLUMNAS
-- ─────────────────────────────────────────────────────────
/*
  El nombre de usuario es único en todo LUNACELL: al iniciar sesión no hay
  empresa todavía. Solo minúsculas, para que «Ana» y «ana» no sean dos.
*/
alter table public.usuarios add column if not exists nombre_usuario text;
alter table public.usuarios add column if not exists debe_cambiar_contrasena boolean not null default false;

alter table public.usuarios drop constraint if exists usuarios_nombre_usuario_formato;
alter table public.usuarios add constraint usuarios_nombre_usuario_formato
  check (nombre_usuario ~ '^[a-z0-9._-]{3,30}$');

create unique index if not exists usuarios_nombre_usuario_unico on public.usuarios (nombre_usuario);

-- ─────────────────────────────────────────────────────────
-- SIN CAMBIAR LA CONTRASEÑA TEMPORAL NO SE OPERA
-- ─────────────────────────────────────────────────────────
/*
  Toda la RLS y todas las funciones operativas dependen de estas cinco
  funciones. Con `debe_cambiar_contrasena` activo devuelven lo mismo que
  para alguien sin empresa: no se ve ni se escribe nada, aunque la pantalla
  se manipule. La propia fila sigue legible por `usuarios_select`, que es lo
  que el frontend usa para pedir el cambio.

  Mismo cuerpo y misma configuración que antes; solo se agrega la condición.
*/
create or replace function public.empresa_del_usuario()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select empresa_id
    from usuarios
   where auth_id = auth.uid()
     and activo
     and not debe_cambiar_contrasena
   limit 1
$$;

create or replace function public.ubicacion_del_usuario()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ubicacion_id
    from usuarios
   where auth_id = auth.uid()
     and activo
     and not debe_cambiar_contrasena
   limit 1
$$;

create or replace function public.usuario_es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rol = 'admin' from usuarios
      where auth_id = auth.uid() and activo and not debe_cambiar_contrasena
      limit 1),
    false
  )
$$;

create or replace function public.usuario_tiene_permiso(p_seccion text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select usuario_es_admin()
      or exists (
           select 1
             from permisos_usuario p
             join usuarios u on u.id = p.usuario_id
                             and u.empresa_id = p.empresa_id
            where u.auth_id = auth.uid()
              and u.activo
              and not u.debe_cambiar_contrasena
              and p.seccion = p_seccion
         )
$$;

create or replace function public.usuario_actual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.activo
     and not u.debe_cambiar_contrasena
   limit 1
$$;

-- ─────────────────────────────────────────────────────────
-- BLOQUEOS Y AUDITORÍA
-- ─────────────────────────────────────────────────────────
/*
  El contador de intentos fallidos es distinto de la desactivación (un
  administrador decide) y del cambio obligatorio (falta elegir contraseña).
  Solo lo escriben las funciones de abajo; el administrador de la empresa
  lo puede leer para ver quién está bloqueado y hasta cuándo.
*/
create table if not exists public.bloqueos_de_acceso (
  usuario_id      uuid primary key references public.usuarios (id) on delete cascade,
  intentos        integer not null default 0 check (intentos >= 0),
  bloqueado_hasta timestamptz,
  actualizado_en  timestamptz not null default now()
);

create table if not exists public.auditoria_accesos (
  id               bigint generated always as identity primary key,
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  usuario_id       uuid not null references public.usuarios (id) on delete cascade,
  administrador_id uuid references public.usuarios (id) on delete set null,
  accion           text not null check (accion in ('creacion', 'restablecimiento', 'desbloqueo')),
  creado_en        timestamptz not null default now()
);

alter table public.bloqueos_de_acceso enable row level security;
alter table public.auditoria_accesos enable row level security;

revoke all on public.bloqueos_de_acceso, public.auditoria_accesos from public, anon, authenticated;
grant select on public.bloqueos_de_acceso, public.auditoria_accesos to authenticated;
grant all on public.bloqueos_de_acceso, public.auditoria_accesos to service_role;

drop policy if exists bloqueos_lectura_admin on public.bloqueos_de_acceso;
create policy bloqueos_lectura_admin on public.bloqueos_de_acceso
  for select
  to authenticated
  using (
    (select public.usuario_es_admin())
    and exists (
      select 1 from public.usuarios u
       where u.id = bloqueos_de_acceso.usuario_id
         and u.empresa_id = public.empresa_del_usuario()
    )
  );

drop policy if exists auditoria_lectura_admin on public.auditoria_accesos;
create policy auditoria_lectura_admin on public.auditoria_accesos
  for select
  to authenticated
  using ((select public.usuario_es_admin()) and empresa_id = public.empresa_del_usuario());

-- ─────────────────────────────────────────────────────────
-- INTENTOS DE ACCESO (solo la Edge Function, con service_role)
-- ─────────────────────────────────────────────────────────
/*
  Se llama ANTES de comprobar la contraseña y cuenta el intento bajo
  candado sobre la fila del usuario: dos intentos simultáneos se forman en
  fila, así que nadie pasa del límite. El quinto intento todavía se
  evalúa; si falla, el usuario queda bloqueado 15 minutos, y si acierta,
  acceso_registrar_exito() lo limpia.

  Para un usuario inexistente, inactivo o bloqueado responde lo mismo y sin
  correo: la Edge Function contesta igual en los tres casos.
*/
create or replace function public.acceso_reservar_intento(p_identificador text)
returns table (usuario_id uuid, email text, permitido boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ident   text := lower(btrim(coalesce(p_identificador, '')));
  v_usuario uuid;
  v_correo  text;
  v_previo  record;
  v_cuenta  integer;
begin
  select u.id, a.email
    into v_usuario, v_correo
    from public.usuarios u
    join auth.users a on a.id = u.auth_id
   where u.activo
     and case when position('@' in v_ident) > 0
              then lower(a.email) = v_ident
              else u.nombre_usuario = v_ident
         end
   limit 1;

  if v_usuario is null then
    return query select null::uuid, null::text, false;
    return;
  end if;

  insert into public.bloqueos_de_acceso (usuario_id) values (v_usuario)
  on conflict do nothing;

  select b.intentos, b.bloqueado_hasta
    into v_previo
    from public.bloqueos_de_acceso b
   where b.usuario_id = v_usuario
     for update;

  if v_previo.bloqueado_hasta is not null and v_previo.bloqueado_hasta > now() then
    return query select null::uuid, null::text, false;
    return;
  end if;

  -- Un bloqueo vencido empieza la cuenta de nuevo.
  v_cuenta := case when v_previo.bloqueado_hasta is not null then 1 else v_previo.intentos + 1 end;

  update public.bloqueos_de_acceso b
     set intentos = v_cuenta,
         bloqueado_hasta = case when v_cuenta >= 5 then now() + interval '15 minutes' end,
         actualizado_en = now()
   where b.usuario_id = v_usuario;

  return query select v_usuario, v_correo, true;
end
$$;

create or replace function public.acceso_registrar_exito(p_usuario uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.bloqueos_de_acceso
     set intentos = 0, bloqueado_hasta = null, actualizado_en = now()
   where usuario_id = p_usuario;

  update public.usuarios
     set entro_en = coalesce(entro_en, now())
   where id = p_usuario;
$$;

-- La Edge Function la llama solo después de que Supabase Auth guardó la nueva.
create or replace function public.acceso_contrasena_cambiada(p_auth_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usuarios
     set debe_cambiar_contrasena = false
   where auth_id = p_auth_id;
$$;

-- ─────────────────────────────────────────────────────────
-- ACCIONES DEL ADMINISTRADOR
-- ─────────────────────────────────────────────────────────
/*
  El administrador que pide la acción, comprobado en la base: activo, con
  rol admin y sin cambio de contraseña pendiente. Lo usan las funciones que
  siguen; nadie la llama de fuera.
*/
create or replace function public.acceso_administrador(p_auth_id uuid)
returns public.usuarios
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin public.usuarios;
begin
  select u.* into v_admin
    from public.usuarios u
   where u.auth_id = p_auth_id
     and u.activo
     and u.rol = 'admin'
     and not u.debe_cambiar_contrasena;

  if v_admin.id is null then
    raise exception 'Solo un administrador activo puede hacer esto.' using errcode = '42501';
  end if;

  return v_admin;
end
$$;

/*
  Valida un alta antes de crear la identidad en Supabase Auth, para no
  crearla si después no se podría registrar. Devuelve la empresa.
*/
create or replace function public.validar_alta_empleado(
  p_admin_auth uuid,
  p_usuario    text,
  p_email      text,
  p_ubicacion  uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin   public.usuarios := public.acceso_administrador(p_admin_auth);
  v_usuario text := lower(btrim(coalesce(p_usuario, '')));
  v_correo  text := lower(btrim(coalesce(p_email, '')));
begin
  if v_usuario !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'El nombre de usuario debe tener de 3 a 30 caracteres: minúsculas, números, punto, guion o guion bajo.'
      using errcode = '23514';
  end if;

  if exists (select 1 from public.usuarios u where u.nombre_usuario = v_usuario) then
    raise exception 'Ese nombre de usuario ya está en uso.' using errcode = '23505';
  end if;

  if position('@' in v_correo) = 0 then
    raise exception 'Escribe un correo válido.' using errcode = '23514';
  end if;

  if exists (select 1 from public.usuarios u where u.empresa_id = v_admin.empresa_id and lower(u.email) = v_correo) then
    raise exception 'Ese correo ya pertenece a un usuario de la empresa.' using errcode = '23505';
  end if;

  if p_ubicacion is not null and not exists (
    select 1 from public.ubicaciones l
     where l.id = p_ubicacion and l.empresa_id = v_admin.empresa_id and l.activa
  ) then
    raise exception 'La ubicación no existe en tu empresa o no está activa.' using errcode = '23514';
  end if;

  return v_admin.empresa_id;
end
$$;

/*
  Registra al empleado cuya identidad acaba de crear la Edge Function: la
  fila, sus permisos y la auditoría, en una sola transacción. Si algo falla
  no queda nada, y la Edge Function borra la identidad que creó.
*/
create or replace function public.registrar_empleado(
  p_admin_auth uuid,
  p_auth_id    uuid,
  p_nombre     text,
  p_usuario    text,
  p_email      text,
  p_rol        text,
  p_secciones  text[],
  p_ubicacion  uuid,
  p_activo     boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := public.validar_alta_empleado(p_admin_auth, p_usuario, p_email, p_ubicacion);
  v_admin   public.usuarios := public.acceso_administrador(p_admin_auth);
  v_id      uuid;
begin
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre es obligatorio.' using errcode = '23514';
  end if;

  insert into public.usuarios (
    empresa_id, auth_id, email, nombre, nombre_usuario, rol, activo, ubicacion_id, debe_cambiar_contrasena
  )
  values (
    v_empresa, p_auth_id, lower(btrim(p_email)), btrim(p_nombre), lower(btrim(p_usuario)),
    p_rol, coalesce(p_activo, true), p_ubicacion, true
  )
  returning id into v_id;

  insert into public.permisos_usuario (usuario_id, empresa_id, seccion)
  select v_id, v_empresa, s
    from (select distinct unnest(coalesce(p_secciones, '{}')) as s) x;

  insert into public.auditoria_accesos (empresa_id, usuario_id, administrador_id, accion)
  values (v_empresa, v_id, v_admin.id, 'creacion');

  return v_id;
end
$$;

/*
  Antes de que la Edge Function ponga la contraseña temporal nueva: valida,
  exige el cambio y, si se pide, desbloquea. Va primero a propósito: si
  después Supabase Auth fallara, el empleado conserva su contraseña y solo
  se le pide cambiarla, que es seguro.
*/
create or replace function public.preparar_restablecimiento(
  p_admin_auth  uuid,
  p_usuario     uuid,
  p_desbloquear boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin    public.usuarios := public.acceso_administrador(p_admin_auth);
  v_empleado public.usuarios;
begin
  select u.* into v_empleado
    from public.usuarios u
   where u.id = p_usuario and u.empresa_id = v_admin.empresa_id;

  if v_empleado.id is null then
    raise exception 'Ese usuario no existe en tu empresa.' using errcode = '42501';
  end if;

  if v_empleado.id = v_admin.id then
    raise exception 'Tu propia contraseña se cambia desde «Cambiar contraseña».' using errcode = '42501';
  end if;

  if v_empleado.auth_id is null then
    raise exception 'Ese usuario no tiene una cuenta de acceso.' using errcode = '23514';
  end if;

  update public.usuarios set debe_cambiar_contrasena = true where id = v_empleado.id;

  if p_desbloquear then
    update public.bloqueos_de_acceso
       set intentos = 0, bloqueado_hasta = null, actualizado_en = now()
     where usuario_id = v_empleado.id;
  end if;

  insert into public.auditoria_accesos (empresa_id, usuario_id, administrador_id, accion)
  values (v_admin.empresa_id, v_empleado.id, v_admin.id, 'restablecimiento');

  return v_empleado.auth_id;
end
$$;

/*
  Desbloqueo inmediato. Lo llama el administrador desde la aplicación: la
  función comprueba quién es con su sesión. Limpia solo el contador; no
  cambia la contraseña ni reactiva a nadie.
*/
create or replace function public.desbloquear_usuario(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin    public.usuarios := public.acceso_administrador(auth.uid());
  v_empleado uuid;
begin
  select u.id into v_empleado
    from public.usuarios u
   where u.id = p_usuario and u.empresa_id = v_admin.empresa_id;

  if v_empleado is null or v_empleado = v_admin.id then
    raise exception 'No puedes desbloquear a ese usuario.' using errcode = '42501';
  end if;

  update public.bloqueos_de_acceso
     set intentos = 0, bloqueado_hasta = null, actualizado_en = now()
   where usuario_id = v_empleado;

  insert into public.auditoria_accesos (empresa_id, usuario_id, administrador_id, accion)
  values (v_admin.empresa_id, v_empleado, v_admin.id, 'desbloqueo');
end
$$;

/*
  Reemplaza los permisos de un usuario de una vez: si una sección no es
  válida, no se pierde ninguna de las que tenía. Corre con los permisos de
  quien llama, así que la RLS deja hacerlo solo al administrador.
*/
create or replace function public.guardar_permisos_usuario(p_usuario uuid, p_secciones text[])
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.permisos_usuario where usuario_id = p_usuario;

  insert into public.permisos_usuario (usuario_id, empresa_id, seccion)
  select p_usuario, public.empresa_del_usuario(), s
    from (select distinct unnest(coalesce(p_secciones, '{}')) as s) x;
$$;

revoke execute on function
  public.acceso_reservar_intento(text),
  public.acceso_registrar_exito(uuid),
  public.acceso_contrasena_cambiada(uuid),
  public.acceso_administrador(uuid),
  public.validar_alta_empleado(uuid, text, text, uuid),
  public.registrar_empleado(uuid, uuid, text, text, text, text, text[], uuid, boolean),
  public.preparar_restablecimiento(uuid, uuid, boolean),
  public.desbloquear_usuario(uuid),
  public.guardar_permisos_usuario(uuid, text[])
from public, anon, authenticated;

grant execute on function
  public.acceso_reservar_intento(text),
  public.acceso_registrar_exito(uuid),
  public.acceso_contrasena_cambiada(uuid),
  public.validar_alta_empleado(uuid, text, text, uuid),
  public.registrar_empleado(uuid, uuid, text, text, text, text, text[], uuid, boolean),
  public.preparar_restablecimiento(uuid, uuid, boolean)
to service_role;

grant execute on function
  public.desbloquear_usuario(uuid),
  public.guardar_permisos_usuario(uuid, text[])
to authenticated;

-- ─────────────────────────────────────────────────────────
-- LA EMPRESA NO SE QUEDA SIN ADMINISTRADOR
-- ─────────────────────────────────────────────────────────
/*
  Antes de desactivar, quitar el rol o borrar al último administrador
  activo de una empresa. El candado sobre los administradores evita que dos
  se den de baja mutuamente al mismo tiempo.
*/
create or replace function public.proteger_ultimo_administrador()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.rol <> 'admin' or not old.activo then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.rol = 'admin' and new.activo then
    return new;
  end if;

  perform 1 from public.usuarios u
   where u.empresa_id = old.empresa_id and u.rol = 'admin' and u.activo
     for update;

  if not exists (
    select 1 from public.usuarios u
     where u.empresa_id = old.empresa_id and u.rol = 'admin' and u.activo and u.id <> old.id
  ) then
    raise exception 'La empresa no puede quedarse sin un administrador activo.';
  end if;

  return coalesce(new, old);
end
$$;

drop trigger if exists usuarios_ultimo_administrador on public.usuarios;
create trigger usuarios_ultimo_administrador
  before update of rol, activo or delete on public.usuarios
  for each row execute function public.proteger_ultimo_administrador();

-- ─────────────────────────────────────────────────────────
-- CAMINOS QUE SE CIERRAN
-- ─────────────────────────────────────────────────────────
/*
  La vinculación por coincidencia de correo deja de existir: la identidad la
  crea el administrador y se vincula por su id. El disparador sobre
  auth.users no se puede borrar desde aquí (su dueño es Supabase Auth), así
  que la función queda sin efecto.
*/
create or replace function public.vincular_usuario_invitado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end
$$;

revoke execute on function public.vincular_usuario_invitado() from public, anon, authenticated;

/*
  Los usuarios no se borran: se desactivan, y su historial conserva al
  autor. Desde la aplicación tampoco se crean (lo hace la Edge Function) ni
  se tocan su identidad, su nombre de usuario o la exigencia de cambio.
*/
revoke insert, update, delete on public.usuarios from authenticated, anon;
grant update (nombre, rol, activo, ubicacion_id) on public.usuarios to authenticated;

revoke insert, update, delete on public.permisos_usuario from anon;
