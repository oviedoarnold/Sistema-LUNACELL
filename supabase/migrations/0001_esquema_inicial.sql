-- Sistema Ferretería — esquema inicial multi-empresa
-- Ejecutar completo en el editor SQL de Supabase.
--
-- Cada tabla lleva empresa_id desde el inicio: agregarlo después, con
-- clientes en producción, obligaría a migrar todos los datos y reescribir
-- cada política.

-- ─────────────────────────────────────────────────────────
-- EMPRESAS
-- ─────────────────────────────────────────────────────────

create table if not exists empresas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  direccion     text not null default '',
  telefono      text not null default '',
  moneda        text not null default 'L',
  tasa_isv      numeric(5,2) not null default 15 check (tasa_isv between 0 and 100),

  -- Datos fiscales del SAR. Confirmar el formato con un contador antes de
  -- facturar formalmente.
  rtn                   text not null default '',
  cai                   text not null default '',
  establecimiento       text not null default '000',
  punto_emision         text not null default '001',
  tipo_documento        text not null default '01',
  rango_desde           bigint,
  rango_hasta           bigint,
  fecha_limite_emision  date,

  -- Correlativos por empresa: dos ferreterías no comparten numeración.
  proximo_correlativo_factura     bigint not null default 1,
  proximo_correlativo_cotizacion  bigint not null default 1,

  es_demo       boolean not null default false,
  creada_en     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- USUARIOS
-- ─────────────────────────────────────────────────────────
-- Con Google no se crean usuarios con contraseña: el administrador invita
-- por correo y el empleado queda vinculado al entrar por primera vez.

create table if not exists usuarios (
  id           uuid primary key default gen_random_uuid(),
  auth_id      uuid unique references auth.users (id) on delete set null,
  empresa_id   uuid not null references empresas (id) on delete cascade,
  email        text not null,
  nombre       text not null,
  rol          text not null default 'vendedor' check (rol in ('admin', 'vendedor')),
  activo       boolean not null default true,
  invitado_en  timestamptz not null default now(),
  entro_en     timestamptz,

  unique (empresa_id, email)
);

create index if not exists idx_usuarios_empresa on usuarios (empresa_id);
create index if not exists idx_usuarios_email on usuarios (lower(email));

create table if not exists permisos_usuario (
  usuario_id  uuid not null references usuarios (id) on delete cascade,
  empresa_id  uuid not null references empresas (id) on delete cascade,
  seccion     text not null check (seccion in (
                'dashboard', 'pos', 'quotes', 'products',
                'clients', 'suppliers', 'sales-history', 'settings')),
  primary key (usuario_id, seccion)
);

create index if not exists idx_permisos_empresa on permisos_usuario (empresa_id);

-- Vincula la cuenta de Google (o de correo) con la invitación que ya
-- existe para ese correo. Sin invitación previa el usuario no entra a
-- ninguna empresa.
create or replace function vincular_usuario_invitado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update usuarios
     set auth_id = new.id,
         entro_en = coalesce(entro_en, now())
   where auth_id is null
     and lower(email) = lower(new.email);

  return new;
end;
$$;

drop trigger if exists al_crear_cuenta_vincular on auth.users;

create trigger al_crear_cuenta_vincular
  after insert on auth.users
  for each row execute function vincular_usuario_invitado();

-- ─────────────────────────────────────────────────────────
-- CATÁLOGOS
-- ─────────────────────────────────────────────────────────

create table if not exists proveedores (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas (id) on delete cascade,
  nombre      text not null,
  contacto    text not null default '',
  telefono    text not null default '',
  email       text not null default '',
  notas       text not null default '',
  creado_en   timestamptz not null default now()
);

create index if not exists idx_proveedores_empresa on proveedores (empresa_id);

create table if not exists clientes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas (id) on delete cascade,
  nombre      text not null,
  rtn         text not null default '',
  telefono    text not null default '',
  direccion   text not null default '',
  email       text not null default '',
  creado_en   timestamptz not null default now()
);

create index if not exists idx_clientes_empresa on clientes (empresa_id);
create index if not exists idx_clientes_nombre on clientes (empresa_id, lower(nombre));

create table if not exists productos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas (id) on delete cascade,
  proveedor_id  uuid references proveedores (id) on delete set null,
  codigo        text not null default '',
  nombre        text not null,
  categoria     text not null default '',
  -- numeric y no float: el dinero no admite error de redondeo acumulado.
  precio        numeric(12,2) not null default 0 check (precio >= 0),
  costo         numeric(12,2) not null default 0 check (costo >= 0),
  stock_minimo  integer not null default 5 check (stock_minimo >= 0),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now(),

  unique (empresa_id, codigo)
);

create index if not exists idx_productos_empresa on productos (empresa_id);

-- ─────────────────────────────────────────────────────────
-- VENTAS
-- ─────────────────────────────────────────────────────────

create table if not exists ventas (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas (id) on delete cascade,
  cliente_id        uuid references clientes (id) on delete set null,
  usuario_id        uuid references usuarios (id) on delete set null,

  numero_factura    text not null,
  correlativo       bigint not null,
  fecha             timestamptz not null default now(),

  nombre_cliente    text not null default 'Consumidor Final',
  rtn_comprador     text not null default '',

  subtotal          numeric(12,2) not null default 0,
  isv               numeric(12,2) not null default 0,
  tasa_isv          numeric(5,2) not null default 15,
  total             numeric(12,2) not null default 0,

  forma_pago        text not null check (forma_pago in ('contado', 'credito')),
  fecha_vencimiento date,
  estado            text not null default 'pendiente'
                      check (estado in ('pendiente', 'pagada', 'anulada')),

  -- Copia y no referencia: renovar el CAI no debe alterar facturas ya
  -- emitidas.
  cai_emision                   text not null default '',
  rango_desde_emision           bigint,
  rango_hasta_emision           bigint,
  fecha_limite_emision_emision  date,

  nota              text not null default '',

  unique (empresa_id, numero_factura),
  constraint credito_exige_cliente
    check (forma_pago = 'contado' or cliente_id is not null)
);

create index if not exists idx_ventas_empresa_fecha on ventas (empresa_id, fecha desc);
create index if not exists idx_ventas_pendientes on ventas (empresa_id, estado)
  where estado = 'pendiente';

create table if not exists detalle_venta (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas (id) on delete cascade,
  venta_id     uuid not null references ventas (id) on delete cascade,
  producto_id  uuid references productos (id) on delete set null,

  nombre       text not null,
  codigo       text not null default '',
  cantidad     integer not null check (cantidad > 0),
  precio       numeric(12,2) not null check (precio >= 0),
  subtotal     numeric(12,2) not null
);

create index if not exists idx_detalle_venta on detalle_venta (venta_id);

create table if not exists abonos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas (id) on delete cascade,
  venta_id     uuid not null references ventas (id) on delete cascade,
  usuario_id   uuid references usuarios (id) on delete set null,
  monto        numeric(12,2) not null check (monto > 0),
  fecha        timestamptz not null default now(),
  nota         text not null default ''
);

create index if not exists idx_abonos_venta on abonos (venta_id);

-- ─────────────────────────────────────────────────────────
-- COTIZACIONES
-- ─────────────────────────────────────────────────────────

create table if not exists cotizaciones (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas (id) on delete cascade,
  cliente_id      uuid references clientes (id) on delete set null,
  usuario_id      uuid references usuarios (id) on delete set null,

  numero          text not null,
  correlativo     bigint not null,
  fecha           timestamptz not null default now(),
  valida_hasta    date,

  nombre_cliente  text not null default 'Cliente General',
  rtn_cliente     text not null default '',

  incluye_isv     boolean not null default true,
  subtotal        numeric(12,2) not null default 0,
  isv             numeric(12,2) not null default 0,
  tasa_isv        numeric(5,2) not null default 15,
  total           numeric(12,2) not null default 0,

  notas           text not null default '',
  venta_id        uuid references ventas (id) on delete set null,

  unique (empresa_id, numero)
);

create index if not exists idx_cotizaciones_empresa on cotizaciones (empresa_id, fecha desc);

create table if not exists detalle_cotizacion (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas (id) on delete cascade,
  cotizacion_id   uuid not null references cotizaciones (id) on delete cascade,
  producto_id     uuid references productos (id) on delete set null,

  nombre          text not null,
  codigo          text not null default '',
  cantidad        integer not null check (cantidad > 0),
  precio          numeric(12,2) not null check (precio >= 0),
  subtotal        numeric(12,2) not null
);

create index if not exists idx_detalle_cotizacion on detalle_cotizacion (cotizacion_id);

-- ─────────────────────────────────────────────────────────
-- INVENTARIO COMO LIBRO DE MOVIMIENTOS
-- ─────────────────────────────────────────────────────────
-- El stock no se guarda como número mutable: es la suma de los
-- movimientos, para que un descuadre en el conteo físico se pueda
-- rastrear hasta quién lo movió y cuándo.

create table if not exists movimientos_inventario (
  id           bigserial primary key,
  empresa_id   uuid not null references empresas (id) on delete cascade,
  producto_id  uuid not null references productos (id) on delete cascade,
  usuario_id   uuid references usuarios (id) on delete set null,
  venta_id     uuid references ventas (id) on delete set null,

  tipo         text not null check (tipo in ('entrada', 'salida', 'ajuste', 'devolucion')),
  cantidad     integer not null check (cantidad <> 0),
  motivo       text not null default '',
  fecha        timestamptz not null default now()
);

create index if not exists idx_movimientos_producto on movimientos_inventario (producto_id, fecha desc);
create index if not exists idx_movimientos_empresa on movimientos_inventario (empresa_id, fecha desc);

create or replace view stock_actual as
  select
    p.id            as producto_id,
    p.empresa_id,
    p.codigo,
    p.nombre,
    p.stock_minimo,
    coalesce(sum(m.cantidad), 0)::integer as stock
  from productos p
  left join movimientos_inventario m on m.producto_id = p.id
  group by p.id, p.empresa_id, p.codigo, p.nombre, p.stock_minimo;

-- ─────────────────────────────────────────────────────────
-- POLÍTICAS DE ACCESO
-- ─────────────────────────────────────────────────────────
-- Cada usuario solo ve las filas de su empresa. La regla se aplica en el
-- motor, no en el frontend: aunque alguien manipule el navegador, la base
-- no devuelve datos de otra empresa.

create or replace function empresa_del_usuario()
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
   limit 1
$$;

create or replace function usuario_es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rol = 'admin' from usuarios where auth_id = auth.uid() and activo limit 1),
    false
  )
$$;

alter table empresas               enable row level security;
alter table usuarios               enable row level security;
alter table permisos_usuario       enable row level security;
alter table proveedores            enable row level security;
alter table clientes               enable row level security;
alter table productos              enable row level security;
alter table ventas                 enable row level security;
alter table detalle_venta          enable row level security;
alter table abonos                 enable row level security;
alter table cotizaciones           enable row level security;
alter table detalle_cotizacion     enable row level security;
alter table movimientos_inventario enable row level security;

-- Aislamiento por empresa en todas las tablas que la referencian.
do $$
declare t text;
begin
  foreach t in array array[
    'proveedores', 'clientes', 'productos', 'ventas', 'detalle_venta',
    'abonos', 'cotizaciones', 'detalle_cotizacion', 'movimientos_inventario',
    'permisos_usuario'
  ]
  loop
    execute format($f$
      create policy %I_de_mi_empresa on %I
        for all
        to authenticated
        using (empresa_id = empresa_del_usuario())
        with check (empresa_id = empresa_del_usuario());
    $f$, t, t);
  end loop;
end $$;

-- La empresa solo la ve quien pertenece a ella; solo un admin la edita.
drop policy if exists empresas_select on empresas;
create policy empresas_select on empresas
  for select to authenticated
  using (id = empresa_del_usuario());

drop policy if exists empresas_update on empresas;
create policy empresas_update on empresas
  for update to authenticated
  using (id = empresa_del_usuario() and usuario_es_admin());

-- Un usuario se ve a sí mismo; el admin ve y administra a los de su empresa.
drop policy if exists usuarios_select on usuarios;
create policy usuarios_select on usuarios
  for select to authenticated
  using (
    auth_id = auth.uid()
    or (empresa_id = empresa_del_usuario() and usuario_es_admin())
  );

drop policy if exists usuarios_admin on usuarios;
create policy usuarios_admin on usuarios
  for all to authenticated
  using (empresa_id = empresa_del_usuario() and usuario_es_admin())
  with check (empresa_id = empresa_del_usuario() and usuario_es_admin());
