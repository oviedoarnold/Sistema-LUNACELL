-- Lo que Supabase pone y un PostgreSQL recién instalado no tiene.
--
-- Las migraciones del proyecto se aplican aquí SIN TOCARLAS: es su valor,
-- porque lo que se prueba es el archivo que se va a correr en producción y
-- no una copia adaptada que podría separarse de él sin que nadie lo note.
--
-- Para eso hace falta que existan antes las piezas que Supabase da por
-- hechas. Son tres: el esquema auth con su tabla de cuentas y auth.uid(),
-- los roles a los que apuntan las políticas, y un mínimo de storage para
-- que la migración de imágenes de producto pueda correr entera.

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
  Solo lo que la migración 0007 nombra. No se prueba almacenamiento aquí;
  esto existe para que 0007 se aplique sin modificarla y el esquema quede
  igual al de producción en todo lo demás.
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
  id       uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name     text,
  owner    uuid
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
$$;

grant usage on schema storage to anon, authenticated, service_role;

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
