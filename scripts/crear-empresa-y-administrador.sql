-- Deja lista una base nueva de LUNACELL: la empresa y su administrador.
-- NO es una migración.
--
-- Se corre una sola vez, después de las migraciones de estructura y antes
-- del primer inicio de sesión. Vive entre los scripts porque no es un paso
-- del esquema: es el arranque de una instalación concreta, y depende de un
-- dato que solo conoce quien la instala —el correo del administrador—.
--
-- ─────────────────────────────────────────────────────────
-- ANTES DE CORRERLO
-- ─────────────────────────────────────────────────────────
-- Escribe tu correo en CORREO_ADMIN, unas líneas más abajo. Tiene que ser
-- exactamente el mismo con el que vas a entrar al sistema.
--
-- El orden con la cuenta de Supabase Auth no importa:
--
--   · Si todavía no la creaste, este script deja la invitación esperando.
--     Al crearla, el disparador al_crear_cuenta_vincular la enlaza sola.
--
--   · Si ya la creaste, este script la encuentra en auth.users y la enlaza
--     aquí mismo. Hace falta porque ese disparador ya pasó: se dispara al
--     crear la cuenta, y en ese momento no había ninguna invitación que
--     enlazar.
--
-- Es idempotente: correrlo dos veces no duplica la empresa ni el usuario.
--
-- ─────────────────────────────────────────────────────────
-- LO QUE NO HACE
-- ─────────────────────────────────────────────────────────
-- No carga datos fiscales. Sin CAI, el sistema numera las facturas con su
-- correlativo interno (FAC-00001), que no pretende ser un documento
-- fiscal. Inventar un CAI aquí produciría facturas con apariencia de
-- autorizadas que el SAR no emitió. El CAI real se carga desde
-- Configuración cuando LUNACELL lo tenga.
--
-- No reparte permisos por sección. Un administrador entra a todas sin
-- necesitar filas en permisos_usuario: usuario_es_admin() le abre la
-- puerta en la base, y hasPermission hace lo propio en la pantalla. Los
-- permisos se reparten a los vendedores, desde Configuración.

do $$
declare
  -- ── EDITA ESTAS DOS LÍNEAS ──────────────────────────────
  CORREO_ADMIN  text := 'escribe-aqui-tu-correo@ejemplo.com';
  NOMBRE_ADMIN  text := 'Administrador';
  -- ────────────────────────────────────────────────────────

  v_empresa   uuid;
  v_auth      uuid;
  v_usuario   uuid;
  v_empresas  int;
begin
  if CORREO_ADMIN = 'escribe-aqui-tu-correo@ejemplo.com' then
    raise exception 'Edita CORREO_ADMIN con tu correo real antes de correr este script.';
  end if;

  if position('@' in CORREO_ADMIN) = 0 then
    raise exception 'CORREO_ADMIN no parece un correo: %', CORREO_ADMIN;
  end if;

  -- EMPRESA ────────────────────────────────────────────────
  -- No se inventa un identificador ni se crea una segunda: si ya hay una,
  -- se usa esa. Con varias, el script no adivina cuál es LUNACELL.
  select count(*) into v_empresas from empresas;

  if v_empresas > 1 then
    raise exception 'Hay % empresas en esta base. Este script solo arranca una instalación nueva.', v_empresas;
  end if;

  if v_empresas = 1 then
    select id into v_empresa from empresas;
    raise notice 'La empresa ya existía; se reutiliza (%).', v_empresa;
  else
    insert into empresas (nombre, moneda, tasa_isv, es_demo)
    values ('LUNACELL', 'L', 15, false)
    returning id into v_empresa;

    raise notice 'Empresa LUNACELL creada (%).', v_empresa;
  end if;

  -- ADMINISTRADOR ──────────────────────────────────────────
  -- Si la cuenta de Auth ya existe, se enlaza ahora; si no, queda null y
  -- el disparador la enlaza cuando se cree.
  select id into v_auth
  from auth.users
  where lower(email) = lower(CORREO_ADMIN)
  limit 1;

  insert into usuarios (empresa_id, email, nombre, rol, activo, auth_id, entro_en)
  values (
    v_empresa,
    lower(CORREO_ADMIN),
    NOMBRE_ADMIN,
    'admin',
    true,
    v_auth,
    case when v_auth is null then null else now() end
  )
  on conflict (empresa_id, email) do update
    set rol     = 'admin',
        activo  = true,
        -- No se pisa un enlace que ya funcionaba.
        auth_id = coalesce(usuarios.auth_id, excluded.auth_id)
  returning id into v_usuario;

  if v_auth is null then
    raise notice 'Administrador invitado (%). Falta crear la cuenta en Authentication con ese mismo correo.', CORREO_ADMIN;
  else
    raise notice 'Administrador listo y enlazado con su cuenta de Authentication (%).', CORREO_ADMIN;
  end if;

  raise notice 'Empresa: %  ·  Usuario: %', v_empresa, v_usuario;
end $$;

-- ─────────────────────────────────────────────────────────
-- COMPROBACIÓN
-- ─────────────────────────────────────────────────────────
-- auth_id no puede quedar en null, o la aplicación no reconoce la sesión y
-- responde que la cuenta no está asignada a ninguna empresa.

select
  e.nombre                        as empresa,
  u.email,
  u.rol,
  u.activo,
  (u.auth_id is not null)         as enlazado_con_authentication
from usuarios u
join empresas e on e.id = u.empresa_id;
