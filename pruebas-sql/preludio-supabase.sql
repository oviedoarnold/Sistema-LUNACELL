-- Lo que Supabase pone y un PostgreSQL recién instalado no tiene.
--
-- Las migraciones del proyecto se aplican aquí SIN TOCARLAS: es su valor,
-- porque lo que se prueba es el archivo que se va a correr en producción y
-- no una copia adaptada que podría separarse de él sin que nadie lo note.
--
-- Para eso hace falta que existan antes las piezas que Supabase da por
-- hechas. Son tres: el esquema auth con su tabla de cuentas y auth.uid(),
-- los roles a los que apuntan las políticas, y la parte de storage que
-- tocan las imágenes de producto.

-- ── ROLES ────────────────────────────────────────────────
-- Los mismos nombres que usa Supabase. Las políticas del proyecto dicen
-- "to authenticated", y revocar EXECUTE a anon exige que anon exista.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- ── AUTH ─────────────────────────────────────────────────

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

/*
  auth.uid() en Supabase lee el "sub" del JWT, que PostgREST deja en un
  ajuste de la sesión. Esta es la misma lectura, de modo que una prueba
  puede hacerse pasar por un usuario con set_config('request.jwt.claims',…)
  exactamente igual que lo hace la aplicación real.
*/
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- ── STORAGE ──────────────────────────────────────────────
/*
  Lo que las políticas de imágenes de producto necesitan para probarse
  como en producción, copiado de ella (consultado en solo lectura):

  - las columnas que escribe el servicio de Storage y el índice único sobre
    el que hace su upsert;
  - storage.foldername() tal cual: devuelve las carpetas SIN el nombre del
    archivo;
  - el disparador que impide borrar filas fuera del servicio;
  - los privilegios: en producción anon y authenticated tienen todo sobre
    estas tablas y lo único que los frena es la RLS. Sin ellos, cualquier
    prueba fallaría por falta de privilegio y no por la política, y no
    probaría nada.

  El dueño aquí es postgres y no supabase_storage_admin; da igual, porque
  las pruebas corren como authenticated o anon, donde la RLS sí aplica.
*/

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id            uuid primary key default gen_random_uuid(),
  bucket_id     text references storage.buckets (id),
  name          text,
  owner         uuid,
  owner_id      text,
  metadata      jsonb,
  user_metadata jsonb,
  version       text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  archived_at   timestamptz
);

create unique index if not exists idx_objects_current_version
  on storage.objects (bucket_id, name collate "C")
  where archived_at is null;

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.protect_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using errcode = '42501';
  end if;
  return null;
end
$$;

drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete
  before delete on storage.objects
  for each statement execute function storage.protect_delete();

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- ── PERMISOS DE ESQUEMA ──────────────────────────────────
-- Supabase los da por defecto sobre public; sin ellos, un rol autenticado
-- no podría ni mirar las tablas y toda prueba de RLS daría un falso
-- "no ve nada" que no prueba nada.

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
