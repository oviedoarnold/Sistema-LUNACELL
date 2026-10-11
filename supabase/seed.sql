-- ═══════════════════════════════════════════════════════════════════════
-- SEMILLA DEL ENTORNO LOCAL DE PRUEBAS — NUNCA EJECUTAR EN PRODUCCIÓN
-- ═══════════════════════════════════════════════════════════════════════
--
-- La carga `npx supabase db reset` en el Supabase LOCAL (Docker), después
-- de aplicar las migraciones. Todo es ficticio: empresa, ubicaciones,
-- productos, clientes y usuarios. Ningún dato sale de producción y la
-- empresa de prueba NO tiene CAI.
--
-- Se niega a correr si la base parece producción: si ya existen usuarios
-- de Auth o las ubicaciones reales de LUNACELL. No es idempotente a
-- propósito: para empezar de cero se usa `db reset`, que borra todo lo
-- local y vuelve a sembrar.
--
-- Usuarios (contraseña de todos: Pruebas-Local-2026):
--   admin.pruebas     administrador
--   camion01.pruebas  vendedor de «Camión 01 Pruebas» (teléfono 1)
--   camion01b.pruebas vendedor de «Camión 01 Pruebas» (teléfono 2)
--   camion02.pruebas  vendedor de «Camión 02 Pruebas»
--
-- Solo «Camión 01 Pruebas» vende sin conexión. La tienda de prueba no.

do $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'seed.sql: la base ya tiene usuarios de Auth. Esta semilla es solo para el entorno local recién reiniciado (npx supabase db reset).';
  end if;

  if exists (
    select 1 from public.ubicaciones
     where nombre in ('Lunacell Store', 'Lunacell Bodega', 'Camión 01', 'Camión 02')
  ) then
    raise exception 'seed.sql: esta base tiene las ubicaciones de producción. No se siembra.';
  end if;
end $$;

-- ── empresa ficticia, sin CAI ────────────────────────────────────────────
insert into public.empresas (id, nombre, direccion, telefono, moneda, tasa_isv, rtn, cai)
values (
  'e0000000-0000-4000-8000-000000000001',
  'LUNACELL PRUEBAS (ficticia)', 'Dirección de prueba', '0000-0000', 'L', 15, '', ''
);

-- ── ubicaciones ──────────────────────────────────────────────────────────
insert into public.ubicaciones (id, empresa_id, nombre, tipo) values
  ('10000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Camión 01 Pruebas', 'camion'),
  ('10000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'Camión 02 Pruebas', 'camion'),
  ('10000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'Bodega Pruebas', 'bodega'),
  ('10000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'Tienda Pruebas', 'tienda');

-- Solo aquí, en local: el camión de prueba vende sin conexión.
update public.ubicaciones
   set vende_sin_conexion = true
 where id = '10000000-0000-4000-8000-000000000001';

-- ── usuarios de Auth (correo confirmado, contraseña conocida) ───────────
create temporary table semilla_usuarios (
  id uuid, usuario uuid, correo text, nombre text, nombre_usuario text, rol text, ubicacion uuid
);

insert into semilla_usuarios values
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'admin.pruebas@lunacell.local',
   'Administrador de pruebas', 'admin.pruebas', 'admin', null),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'camion01.pruebas@lunacell.local',
   'Vendedor Camión 01 (teléfono 1)', 'camion01.pruebas', 'vendedor', '10000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'camion01b.pruebas@lunacell.local',
   'Vendedor Camión 01 (teléfono 2)', 'camion01b.pruebas', 'vendedor', '10000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000004', 'camion02.pruebas@lunacell.local',
   'Vendedor Camión 02', 'camion02.pruebas', 'vendedor', '10000000-0000-4000-8000-000000000002');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', correo,
       extensions.crypt('Pruebas-Local-2026', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
       '', '', '', ''
  from semilla_usuarios;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
       jsonb_build_object('sub', id::text, 'email', correo, 'email_verified', true),
       'email', now(), now(), now()
  from semilla_usuarios;

insert into public.usuarios (
  id, empresa_id, auth_id, email, nombre, nombre_usuario, rol, activo, ubicacion_id,
  debe_cambiar_contrasena, entro_en
)
select usuario, 'e0000000-0000-4000-8000-000000000001', id, correo, nombre, nombre_usuario, rol, true, ubicacion,
       false, now()
  from semilla_usuarios;

-- Los vendedores: lo mismo que un vendedor nuevo (SELLER_PERMISSIONS).
insert into public.permisos_usuario (usuario_id, empresa_id, seccion)
select s.usuario, 'e0000000-0000-4000-8000-000000000001', p.seccion
  from semilla_usuarios s
 cross join (values ('dashboard'), ('pos'), ('quotes'), ('clients'), ('sales-history'), ('inventory-own')) as p (seccion)
 where s.rol = 'vendedor';

-- ── catálogo, clientes y existencias ────────────────────────────────────
insert into public.productos (id, empresa_id, codigo, nombre, categoria, precio, costo, stock_minimo) values
  ('20000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'PR-001', 'Cargador USB-C (prueba)', 'Accesorios', 150, 80, 2),
  ('20000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'PR-002', 'Cable Lightning (prueba)', 'Accesorios', 120, 60, 2),
  ('20000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'PR-003', 'Audífonos (prueba)', 'Audio', 350, 200, 1),
  ('20000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'PR-004', 'Protector de pantalla (prueba)', 'Accesorios', 80, 30, 5);

insert into public.clientes (id, empresa_id, nombre, rtn, telefono, direccion, email) values
  ('30000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Cliente Crédito Prueba', '00000000000000', '0000-0001', 'Dirección ficticia 1', ''),
  ('30000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'Cliente Contado Prueba', '', '0000-0002', 'Dirección ficticia 2', '');

-- Camión 01: los audífonos tienen UNA unidad, para probar la última unidad entre dos teléfonos.
create temporary table semilla_existencias (ubicacion uuid, producto uuid, cantidad integer);

insert into semilla_existencias values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 10),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 5),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 1),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 20),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 10),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 50),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 10);

insert into public.inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
select 'e0000000-0000-4000-8000-000000000001', ubicacion, producto, cantidad
  from semilla_existencias;

-- El libro de movimientos con la entrada inicial, para que el catálogo cuadre.
insert into public.movimientos_inventario (empresa_id, producto_id, usuario_id, ubicacion_id, tipo, cantidad, motivo)
select 'e0000000-0000-4000-8000-000000000001', producto, 'b0000000-0000-4000-8000-000000000001', ubicacion,
       'entrada', cantidad, 'Existencia inicial de prueba'
  from semilla_existencias;

drop table semilla_existencias;
drop table semilla_usuarios;
