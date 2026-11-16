-- Pedidos interubicación, etapa A: una ubicación entrega y otra factura.
--
-- Un cliente de Camión 01 compra y se lleva los productos en Bodega:
-- - Bodega entrega: descuenta SU inventario y recibe el dinero, si lo hay.
-- - El pedido llega a Camión 01 como aviso. No le entra mercadería ni
--   necesita existencias de esos productos.
-- - Camión 01 revisa y factura con su numeración y los datos guardados en el
--   pedido: no vuelve a descontar ni a cobrar.
--
-- Qué queda en la base:
-- - pedidos_ubicacion y pedido_detalle: el pedido, con precios, ISV, medios,
--   porcentaje y cargos congelados al entregar.
-- - cobros_por_medio.pedido_id: lo cobrado en origen pertenece al pedido,
--   con la ubicación que recibió el dinero, el usuario, la tasa y el cargo.
-- - movimientos_inventario: tipo nuevo 'entrega_pedido', ligado al pedido.
-- - ventas.pedido_id y pagos.pedido_id: la factura y la prima, ligadas para
--   siempre a su pedido.
-- - eventos_de_pedido: quién hizo qué y cuándo. La etapa C anotará aquí el
--   rechazo, la resolución y las cancelaciones.
-- - pedido_lecturas: qué avisos leyó cada usuario. Leer no cambia el pedido.
-- - Dos privilegios nuevos: 'orders-resolve' y 'orders-cancel'. Se asignan
--   desde Usuarios y privilegios. En esta etapa no habilitan ninguna acción:
--   las funciones de la etapa C los exigirán con
--   usuario_puede_resolver_pedido() y usuario_puede_autorizar_cancelacion().
--
-- Lo que NO hace: no toca ninguna fila existente ni ninguna función que ya
-- exista; las ventas, los abonos, la anulación, la venta sin conexión y los
-- reportes siguen igual. Una factura de pedido no se puede anular todavía:
-- anular_venta() la rechaza porque su mercadería no salió de la ubicación de
-- la factura (AV007), o porque tiene la prima como abono (AV005).
--
-- Errores propios: PI001 datos no válidos; PI002 ubicación de origen;
-- PI003 ubicación destino; PI004 cliente; PI005 clave usada para otro pedido;
-- PI006 producto; PI007 existencia insuficiente; PI008 el pedido no se puede
-- facturar; PI009 ISV obligatorio; PI010 prima no válida. Además LM001,
-- LM002 y LM007 de los medios de pago, LN001 del precio negociado y 42501.
--
-- Idempotente.

-- ─────────────────────────────────────────────────────────
-- LOS PRIVILEGIOS
-- ─────────────────────────────────────────────────────────
/*
  Igual que en la 0037: la restricción se busca por lo que dice y no por su
  nombre. Nadie los recibe aquí; el administrador los tiene por
  usuario_tiene_permiso(), como todos.
*/
do $$
declare
  v_restriccion text;
begin
  for v_restriccion in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.permisos_usuario'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%seccion%'
  loop
    execute format('alter table public.permisos_usuario drop constraint %I', v_restriccion);
  end loop;
end $$;

alter table public.permisos_usuario
  add constraint permisos_usuario_seccion_check
  check (seccion in (
    'dashboard', 'pos', 'quotes', 'products',
    'clients', 'suppliers', 'sales-history', 'settings',
    'locations',
    'inventory-own', 'inventory-all',
    'sales-void',
    'products-read',
    'orders-resolve', 'orders-cancel'
  ));

-- ─────────────────────────────────────────────────────────
-- EL PEDIDO
-- ─────────────────────────────────────────────────────────
create table if not exists public.pedidos_ubicacion (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references public.empresas (id),
  numero               text not null,
  correlativo          bigint not null check (correlativo > 0),

  -- Quién entrega físicamente y quién factura.
  origen_id            uuid not null,
  destino_id           uuid not null,

  cliente_id           uuid not null,
  nombre_cliente       text not null,
  rtn_comprador        text not null default '',

  forma_pago           text not null check (forma_pago in ('contado', 'credito')),
  fecha_vencimiento    date,

  -- Congelados al entregar: la factura los copia tal cual.
  tasa_isv             numeric(5,2) not null check (tasa_isv between 0 and 100),
  subtotal             numeric(12,2) not null check (subtotal >= 0),
  isv                  numeric(12,2) not null check (isv >= 0),
  total                numeric(12,2) not null check (total > 0),

  -- Lo recibido en origen: todo al contado, la prima a crédito.
  cobrado              numeric(12,2) not null default 0 check (cobrado >= 0),
  cargo_por_medio      numeric(12,2) not null default 0 check (cargo_por_medio >= 0),
  tasa_cargo           numeric(5,2) check (tasa_cargo between 0 and 100),

  estado               text not null default 'pendiente'
                       check (estado in ('pendiente', 'facturado', 'por_resolver', 'cancelado')),
  nota                 text not null default '',

  entregado_por        uuid not null references public.usuarios (id),
  entregado_por_nombre text not null,
  entregado_en         timestamptz not null default now(),

  venta_id             uuid unique references public.ventas (id),
  facturado_por        uuid references public.usuarios (id),
  facturado_por_nombre text,
  facturado_en         timestamptz,

  clave_idempotencia   text not null check (btrim(clave_idempotencia) <> ''),
  huella               text not null,

  constraint pedidos_origen_de_la_empresa
    foreign key (origen_id, empresa_id) references public.ubicaciones (id, empresa_id),
  constraint pedidos_destino_de_la_empresa
    foreign key (destino_id, empresa_id) references public.ubicaciones (id, empresa_id),
  constraint pedidos_cliente_de_la_empresa
    foreign key (cliente_id, empresa_id) references public.clientes (id, empresa_id),
  constraint pedidos_origen_distinto_destino check (origen_id <> destino_id),
  constraint pedidos_numero_unico unique (empresa_id, numero),
  constraint pedidos_correlativo_unico unique (empresa_id, correlativo),
  constraint pedidos_clave_unica unique (empresa_id, clave_idempotencia),
  constraint pedidos_importes_coherentes check (total = subtotal + isv),
  constraint pedidos_cobro_segun_forma check (
    (forma_pago = 'contado' and cobrado = total)
    or (forma_pago = 'credito' and cobrado < total)
  ),
  constraint pedidos_vencimiento_solo_a_credito check (forma_pago = 'credito' or fecha_vencimiento is null),
  constraint pedidos_facturado_con_su_factura check ((estado = 'facturado') = (venta_id is not null)),
  constraint pedidos_facturacion_completa check (
    (venta_id is null) = (facturado_en is null)
    and (venta_id is null) = (facturado_por_nombre is null)
  )
);

create unique index if not exists pedidos_id_empresa on public.pedidos_ubicacion (id, empresa_id);
create index if not exists idx_pedidos_destino on public.pedidos_ubicacion (empresa_id, destino_id, estado);
create index if not exists idx_pedidos_origen on public.pedidos_ubicacion (empresa_id, origen_id, estado);
create index if not exists idx_pedidos_cliente on public.pedidos_ubicacion (cliente_id);

/*
  Cada renglón guarda los tres precios que había al entregar: el general, el
  especial del cliente si lo tenía, y el negociado si lo hubo. El precio
  cobrado es `precio`. Ningún costo.
*/
create table if not exists public.pedido_detalle (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references public.empresas (id),
  pedido_id            uuid not null references public.pedidos_ubicacion (id),
  producto_id          uuid not null,
  nombre               text not null,
  codigo               text not null default '',
  cantidad             integer not null check (cantidad > 0),
  precio               numeric(12,2) not null check (precio >= 0),
  subtotal             numeric(12,2) not null check (subtotal >= 0),
  precio_general       numeric(12,2) not null check (precio_general >= 0),
  precio_especial      numeric(12,2) check (precio_especial > 0),
  precio_referencia    numeric(12,2),
  negociado_por        uuid references public.usuarios (id),
  negociado_por_nombre text,
  negociado_en         timestamptz,
  motivo_negociacion   text check (
    motivo_negociacion is null or motivo_negociacion in ('mayoreo', 'cliente_frecuente', 'promocion', 'otro')
  ),

  constraint pedido_detalle_del_pedido foreign key (pedido_id, empresa_id)
    references public.pedidos_ubicacion (id, empresa_id),
  constraint pedido_detalle_producto_de_la_empresa foreign key (producto_id, empresa_id)
    references public.productos (id, empresa_id),
  constraint pedido_detalle_un_renglon_por_producto unique (pedido_id, producto_id),
  constraint pedido_detalle_subtotal check (subtotal = round(precio * cantidad, 2)),
  constraint pedido_detalle_negociacion_completa check ((precio_referencia is null) = (negociado_en is null))
);

create index if not exists idx_pedido_detalle_pedido on public.pedido_detalle (pedido_id);

/*
  La historia del pedido. Solo se agrega. En esta etapa se anotan la entrega
  y la factura; los demás tipos son de la etapa C, que guardará en `detalle`
  lo que decida cada caso (productos devueltos, dónde, reembolso...).
*/
create table if not exists public.eventos_de_pedido (
  id                bigint generated always as identity primary key,
  empresa_id        uuid not null references public.empresas (id),
  pedido_id         uuid not null,
  tipo              text not null check (tipo in (
                      'entregado', 'facturado',
                      'rechazado', 'reenviado', 'facturar_en_origen',
                      'cancelacion_solicitada', 'cancelacion_autorizada', 'cancelacion_rechazada'
                    )),
  usuario_id        uuid not null references public.usuarios (id),
  usuario_nombre    text not null,
  ubicacion_usuario uuid,
  motivo            text not null default '',
  detalle           jsonb not null default '{}'::jsonb,
  creado_en         timestamptz not null default now(),

  constraint eventos_del_pedido foreign key (pedido_id, empresa_id)
    references public.pedidos_ubicacion (id, empresa_id)
);

create index if not exists idx_eventos_de_pedido on public.eventos_de_pedido (pedido_id, creado_en);

-- Qué avisos leyó cada usuario. No es estado comercial.
create table if not exists public.pedido_lecturas (
  pedido_id  uuid not null references public.pedidos_ubicacion (id),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  leido_en   timestamptz not null default now(),
  primary key (pedido_id, usuario_id)
);

-- ─────────────────────────────────────────────────────────
-- LO QUE SE LIGA AL PEDIDO
-- ─────────────────────────────────────────────────────────
/*
  Un cobro pertenece a una venta, a un abono o, desde aquí, a un pedido. La
  restricción nueva acepta exactamente las mismas filas que la anterior más
  las de pedido, así que todas las existentes la cumplen.
*/
alter table public.cobros_por_medio
  add column if not exists pedido_id uuid references public.pedidos_ubicacion (id);

alter table public.cobros_por_medio drop constraint if exists cobros_por_medio_de_venta_o_de_pago;
alter table public.cobros_por_medio drop constraint if exists cobros_por_medio_de_un_solo_documento;
alter table public.cobros_por_medio add constraint cobros_por_medio_de_un_solo_documento
  check (num_nonnulls(venta_id, pago_id, pedido_id) = 1);

create index if not exists idx_cobros_por_medio_pedido on public.cobros_por_medio (pedido_id) where pedido_id is not null;

alter table public.movimientos_inventario
  add column if not exists pedido_id uuid references public.pedidos_ubicacion (id);

do $$
declare
  v_restriccion text;
begin
  for v_restriccion in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.movimientos_inventario'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%traslado_entrada%'
  loop
    execute format('alter table public.movimientos_inventario drop constraint %I', v_restriccion);
  end loop;
end $$;

alter table public.movimientos_inventario
  add constraint movimientos_inventario_tipo_check
  check (tipo in (
    'entrada', 'salida', 'ajuste', 'devolucion',
    'traslado_salida', 'traslado_entrada',
    'anulacion_venta',
    'entrega_pedido'
  ));

alter table public.movimientos_inventario drop constraint if exists movimientos_entrega_de_un_pedido;
alter table public.movimientos_inventario add constraint movimientos_entrega_de_un_pedido
  check (tipo <> 'entrega_pedido' or (pedido_id is not null and cantidad < 0 and venta_id is null));

create index if not exists idx_movimientos_pedido on public.movimientos_inventario (pedido_id) where pedido_id is not null;

alter table public.ventas
  add column if not exists pedido_id uuid unique references public.pedidos_ubicacion (id);

alter table public.pagos
  add column if not exists pedido_id uuid unique references public.pedidos_ubicacion (id);

-- ─────────────────────────────────────────────────────────
-- SOLO SE ESCRIBE DESDE LAS FUNCIONES
-- ─────────────────────────────────────────────────────────
revoke all on public.pedidos_ubicacion, public.pedido_detalle, public.eventos_de_pedido, public.pedido_lecturas
  from public, anon, authenticated;
grant select on public.pedidos_ubicacion, public.pedido_detalle, public.eventos_de_pedido, public.pedido_lecturas
  to authenticated;
grant all on public.pedidos_ubicacion, public.pedido_detalle, public.eventos_de_pedido, public.pedido_lecturas
  to service_role;

-- El renglón y la historia no cambian nunca.
create or replace function public.registro_de_pedido_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El registro de un pedido no se modifica ni se borra'
    using errcode = '42501';
end $$;

revoke execute on function public.registro_de_pedido_inmutable() from public, anon, authenticated;

/*
  El pedido solo avanza de pendiente a facturado, y al hacerlo solo se llenan
  la factura y quién facturó. Nada de lo entregado se reescribe. La etapa C
  ampliará las transiciones cuando existan el rechazo y la cancelación.
*/
create or replace function public.pedido_solo_avanza()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_facturacion text[] := array['estado', 'venta_id', 'facturado_por', 'facturado_por_nombre', 'facturado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un pedido no se borra' using errcode = '42501';
  end if;

  if not (old.estado = 'pendiente' and new.estado = 'facturado' and new.venta_id is not null) then
    raise exception 'Un pedido pendiente solo puede pasar a facturado' using errcode = '42501';
  end if;

  if (to_jsonb(new) - v_facturacion) <> (to_jsonb(old) - v_facturacion) then
    raise exception 'Los datos de un pedido entregado no se modifican' using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function public.pedido_solo_avanza() from public, anon, authenticated;

drop trigger if exists pedidos_solo_avanzan on public.pedidos_ubicacion;
create trigger pedidos_solo_avanzan
  before update or delete on public.pedidos_ubicacion
  for each row execute function public.pedido_solo_avanza();

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['pedido_detalle', 'eventos_de_pedido']
  loop
    execute format('drop trigger if exists %1$s_inmutable on public.%1$I', v_tabla);
    execute format(
      'create trigger %1$s_inmutable before update or delete on public.%1$I
         for each row execute function public.registro_de_pedido_inmutable()',
      v_tabla
    );
  end loop;

  foreach v_tabla in array array['pedidos_ubicacion', 'pedido_detalle', 'eventos_de_pedido']
  loop
    execute format('drop trigger if exists %1$s_sin_vaciar on public.%1$I', v_tabla);
    execute format(
      'create trigger %1$s_sin_vaciar before truncate on public.%1$I
         for each statement execute function public.registro_de_pedido_inmutable()',
      v_tabla
    );
  end loop;

  -- El contador no escribe en ninguna tabla (0036).
  foreach v_tabla in array array['pedidos_ubicacion', 'pedido_detalle', 'eventos_de_pedido', 'pedido_lecturas']
  loop
    execute format('drop trigger if exists impedir_escritura_del_contador on public.%I', v_tabla);
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
-- QUIÉN VE UN PEDIDO
-- ─────────────────────────────────────────────────────────
/*
  La misma regla que las ventas (0036): el administrador ve los de su
  empresa; el vendedor, los que salen de su ubicación o llegan a ella; el
  contador con historial, todos, sin escribir nada.
*/
create or replace function public.pedido_visible(p_empresa uuid, p_origen uuid, p_destino uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_empresa = public.empresa_del_usuario()
    and (
      public.usuario_es_admin()
      or public.ubicacion_del_usuario() in (p_origen, p_destino)
      or (public.usuario_es_contador() and public.usuario_tiene_permiso('sales-history'))
    ),
    false
  )
$$;

revoke execute on function public.pedido_visible(uuid, uuid, uuid) from public, anon;
grant execute on function public.pedido_visible(uuid, uuid, uuid) to authenticated;

alter table public.pedidos_ubicacion enable row level security;
alter table public.pedido_detalle enable row level security;
alter table public.eventos_de_pedido enable row level security;
alter table public.pedido_lecturas enable row level security;

drop policy if exists pedidos_lectura on public.pedidos_ubicacion;
create policy pedidos_lectura on public.pedidos_ubicacion
  for select
  to authenticated
  using (public.pedido_visible(empresa_id, origen_id, destino_id));

-- El renglón y la historia se ven si se ve su pedido.
drop policy if exists pedido_detalle_lectura on public.pedido_detalle;
create policy pedido_detalle_lectura on public.pedido_detalle
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and exists (select 1 from public.pedidos_ubicacion p where p.id = pedido_detalle.pedido_id)
  );

drop policy if exists eventos_de_pedido_lectura on public.eventos_de_pedido;
create policy eventos_de_pedido_lectura on public.eventos_de_pedido
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and exists (select 1 from public.pedidos_ubicacion p where p.id = eventos_de_pedido.pedido_id)
  );

drop policy if exists pedido_lecturas_propias on public.pedido_lecturas;
create policy pedido_lecturas_propias on public.pedido_lecturas
  for select
  to authenticated
  using (usuario_id = (select public.usuario_actual()));

-- ─────────────────────────────────────────────────────────
-- LOS DOS PRIVILEGIOS, VALIDADOS EN EL SERVIDOR
-- ─────────────────────────────────────────────────────────
/*
  Las funciones de la etapa C preguntarán aquí antes de resolver o cancelar.
  Hace falta el privilegio y que el pedido sea de una ubicación del usuario
  (origen o destino); el administrador, de cualquiera de su empresa. El
  contador nunca, aunque alguien le marque el privilegio por SQL.
*/
create or replace function public.usuario_opera_pedido(p_pedido uuid, p_privilegio text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select not public.usuario_es_contador()
       and public.usuario_tiene_permiso(p_privilegio)
       and (public.usuario_es_admin() or public.ubicacion_del_usuario() in (p.origen_id, p.destino_id))
      from public.pedidos_ubicacion p
     where p.id = p_pedido
       and p.empresa_id = public.empresa_del_usuario()
  ), false)
$$;

create or replace function public.usuario_puede_resolver_pedido(p_pedido uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.usuario_opera_pedido(p_pedido, 'orders-resolve')
$$;

create or replace function public.usuario_puede_autorizar_cancelacion(p_pedido uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.usuario_opera_pedido(p_pedido, 'orders-cancel')
$$;

revoke execute on function
  public.usuario_opera_pedido(uuid, text),
  public.usuario_puede_resolver_pedido(uuid),
  public.usuario_puede_autorizar_cancelacion(uuid)
from public, anon;

revoke execute on function public.usuario_opera_pedido(uuid, text) from authenticated;

grant execute on function
  public.usuario_puede_resolver_pedido(uuid),
  public.usuario_puede_autorizar_cancelacion(uuid)
to authenticated;

-- ─────────────────────────────────────────────────────────
-- EL RESUMEN QUE DEVUELVEN LAS FUNCIONES
-- ─────────────────────────────────────────────────────────
create or replace function public.resumen_de_pedido(p_pedido uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pedido_id',      p.id,
    'numero',         p.numero,
    'estado',         p.estado,
    'origen_id',      p.origen_id,
    'origen',         o.nombre,
    'destino_id',     p.destino_id,
    'destino',        d.nombre,
    'cliente_id',     p.cliente_id,
    'nombre_cliente', p.nombre_cliente,
    'forma_pago',     p.forma_pago,
    'subtotal',       p.subtotal,
    'isv',            p.isv,
    'tasa_isv',       p.tasa_isv,
    'total',          p.total,
    'cobrado',        p.cobrado,
    'saldo',          p.total - p.cobrado,
    'cargo',          p.cargo_por_medio,
    'entregado_en',   p.entregado_en,
    'venta_id',       p.venta_id,
    'numero_factura', v.numero_factura,
    'facturado_en',   p.facturado_en
  )
    from public.pedidos_ubicacion p
    join public.ubicaciones o on o.id = p.origen_id
    join public.ubicaciones d on d.id = p.destino_id
    left join public.ventas v on v.id = p.venta_id
   where p.id = p_pedido
$$;

revoke execute on function public.resumen_de_pedido(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- ENTREGAR EN ORIGEN Y ENVIAR EL PEDIDO
-- ─────────────────────────────────────────────────────────
/*
  En una transacción: valida, descuenta de la ubicación del usuario, guarda
  el pedido con sus precios y cobros, y deja el aviso para el destino. Si
  algo falla no queda nada.

  No recibe origen, importes ni empresa: el origen es la ubicación del
  usuario y los precios salen de la base, como en la venta del POS. El
  precio negociado sigue las reglas de la 0043.

  `p_cobros`: al contado, los medios que suman el total; a crédito, la prima
  si la hay (menos que el total), o nada. Cargos y tasas se validan con la
  tasa vigente (LM007), igual que en el POS.

  La clave es obligatoria. Un reintento con la misma clave y el mismo pedido
  devuelve el pedido ya entregado sin descontar otra vez; con otro pedido,
  PI005. Dos intentos simultáneos con la misma clave se ponen en fila.
*/
create or replace function public.entregar_pedido(
  p_destino            uuid,
  p_cliente_id         uuid,
  p_items              jsonb,
  p_forma_pago         text,
  p_cobros             jsonb default '[]'::jsonb,
  p_con_isv            boolean default true,
  p_fecha_vencimiento  date default null,
  p_rtn_comprador      text default null,
  p_nota               text default '',
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario     usuarios;
  v_empresa     uuid;
  v_origen      ubicaciones;
  v_destino     ubicaciones;
  v_cliente     clientes;
  v_emp         empresas;
  v_forma       text := coalesce(p_forma_pago, '');
  v_credito     boolean;
  v_con_isv     boolean := coalesce(p_con_isv, true);
  v_cobros      jsonb := coalesce(p_cobros, '[]'::jsonb);
  v_hay_cobros  boolean;
  v_invalidos   text;
  v_pedido      pedidos_ubicacion;
  v_items       jsonb;
  v_huella      text;
  v_item        record;
  v_prod        record;
  v_disponible  integer;
  v_especial    numeric;
  v_referencia  numeric;
  v_negociado   numeric;
  v_precio      numeric;
  v_motivo      text;
  v_lineas      jsonb := '[]'::jsonb;
  v_linea       jsonb;
  v_subtotal    numeric(12,2) := 0;
  v_tasa        numeric(5,2);
  v_isv         numeric(12,2);
  v_total       numeric(12,2);
  v_cobrado     numeric(12,2) := 0;
  v_con_tasa    jsonb := '[]'::jsonb;
  v_cargo       numeric(12,2) := 0;
  v_tasa_cargo  numeric(5,2);
  v_correlativo bigint;
  v_numero      text;
  v_id          uuid := gen_random_uuid();
  v_ahora       timestamptz := now();
begin
  -- ── quién entrega ──
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid()
     and u.activo
     and not u.debe_cambiar_contrasena
   limit 1
     for share;

  if v_usuario.id is null then
    raise exception 'Inicia sesión con un usuario activo para entregar pedidos'
      using errcode = '42501';
  end if;

  if v_usuario.rol = 'contador' or not usuario_tiene_permiso('pos') then
    raise exception 'No tienes permiso para entregar pedidos'
      using errcode = '42501';
  end if;

  v_empresa := v_usuario.empresa_id;

  if p_clave_idempotencia is null or btrim(p_clave_idempotencia) = '' then
    raise exception 'Falta la clave del pedido' using errcode = 'PI001';
  end if;

  -- Dos intentos con la misma clave: el segundo espera y encuentra el primero.
  perform pg_advisory_xact_lock(hashtextextended('pedido|' || v_empresa::text || '|' || p_clave_idempotencia, 0));

  -- ── la intención, en una forma comparable ──
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 200 then
    raise exception 'El pedido no tiene productos' using errcode = 'PI001';
  end if;

  if v_forma not in ('contado', 'credito') then
    raise exception 'Forma de pago desconocida: %', v_forma using errcode = 'PI001';
  end if;

  v_credito := v_forma = 'credito';

  if jsonb_typeof(v_cobros) is distinct from 'array' then
    raise exception 'Los medios de pago no son válidos' using errcode = 'LM001';
  end if;

  v_hay_cobros := jsonb_array_length(v_cobros) > 0;

  begin
    if exists (
      select 1
        from jsonb_array_elements(p_items) e
       where jsonb_typeof(e) <> 'object'
          or (e->>'producto_id') is null
          or (e->>'cantidad') is null
          or (e->>'cantidad')::integer <= 0
    ) then
      raise exception 'Un producto del pedido no es válido' using errcode = 'PI001';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(p_items) e
       group by (e->>'producto_id')::uuid
      having count(*) > 1 and count(e->>'precio_negociado') > 0
    ) then
      raise exception 'Un producto con precio negociado no puede ir en dos renglones' using errcode = 'LN001';
    end if;

    select jsonb_agg(
             jsonb_build_object(
               'producto_id', x.pid,
               'cantidad', x.qty,
               'precio_negociado', x.neg,
               'motivo', x.mot
             )
             order by x.pid
           )
      into v_items
      from (
        select (e->>'producto_id')::uuid as pid,
               sum((e->>'cantidad')::integer) as qty,
               max((e->>'precio_negociado')::numeric) as neg,
               max(nullif(btrim(coalesce(e->>'motivo_negociacion', '')), '')) as mot
          from jsonb_array_elements(p_items) e
         group by 1
      ) x;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Un producto del pedido no es válido' using errcode = 'PI001';
  end;

  v_huella := concat_ws('|',
    p_destino::text,
    p_cliente_id::text,
    v_forma,
    v_con_isv::text,
    coalesce(case when v_credito then p_fecha_vencimiento end::text, '-'),
    (select string_agg(
              (i->>'producto_id') || 'x' || (i->>'cantidad') || '@' || coalesce(i->>'precio_negociado', '-')
                || '/' || coalesce(i->>'motivo', '-'),
              ',' order by i->>'producto_id')
       from jsonb_array_elements(v_items) i),
    case when v_hay_cobros then cobros_normalizados(v_cobros)::text else '[]' end
  );

  -- ── ¿ya se entregó este mismo pedido? ──
  select p.* into v_pedido
    from pedidos_ubicacion p
   where p.empresa_id = v_empresa
     and p.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_pedido.huella <> v_huella then
      raise exception 'La clave % ya se usó para otro pedido', p_clave_idempotencia
        using errcode = 'PI005';
    end if;

    return resumen_de_pedido(v_pedido.id) || jsonb_build_object('repetido', true);
  end if;

  -- ── de dónde sale ──
  if v_usuario.ubicacion_id is null then
    raise exception 'No tienes una ubicación asignada: el pedido sale de la ubicación donde trabajas'
      using errcode = 'PI002';
  end if;

  select * into v_origen from ubicaciones where id = v_usuario.ubicacion_id and empresa_id = v_empresa;

  if not v_origen.activa then
    raise exception 'La ubicación «%» está desactivada y no puede entregar pedidos', v_origen.nombre
      using errcode = 'PI002';
  end if;

  -- ── a dónde va ──
  select * into v_destino from ubicaciones where id = p_destino and empresa_id = v_empresa;

  if v_destino.id is null then
    raise exception 'La ubicación destino no existe en tu empresa' using errcode = 'PI003';
  end if;

  if v_destino.id = v_origen.id then
    raise exception 'El pedido se envía a otra ubicación. Para vender aquí, genera la factura normal'
      using errcode = 'PI003';
  end if;

  if not v_destino.activa then
    raise exception 'La ubicación «%» está desactivada y no puede recibir pedidos', v_destino.nombre
      using errcode = 'PI003';
  end if;

  if not v_destino.vende then
    raise exception 'La ubicación «%» no factura: elige otra ubicación destino', v_destino.nombre
      using errcode = 'PI003';
  end if;

  -- ── a quién ──
  select * into v_cliente from clientes where id = p_cliente_id and empresa_id = v_empresa;

  if v_cliente.id is null then
    raise exception 'Selecciona un cliente registrado de tu empresa' using errcode = 'PI004';
  end if;

  -- ── el ISV ──
  select * into v_emp from empresas where id = v_empresa;

  if v_destino.emite_fiscal and not v_con_isv and coalesce(v_emp.tasa_isv, 15) > 0 then
    raise exception 'La ubicación «%» emite facturas fiscales: el pedido lleva ISV', v_destino.nombre
      using errcode = 'PI009';
  end if;

  v_tasa := case when v_con_isv then coalesce(v_emp.tasa_isv, 15) else 0 end;

  -- ── la existencia de origen, bajo candado y en orden de producto ──
  for v_item in
    select (i->>'producto_id')::uuid as producto_id,
           (i->>'cantidad')::integer as cantidad,
           (i->>'precio_negociado')::numeric as negociado,
           i->>'motivo' as motivo
      from jsonb_array_elements(v_items) i
     order by i->>'producto_id'
  loop
    select p.id, p.nombre, p.codigo, p.precio into v_prod
      from productos p
     where p.id = v_item.producto_id
       and p.empresa_id = v_empresa
       and p.activo;

    if not found then
      raise exception 'Uno de los productos no existe o está inactivo' using errcode = 'PI006';
    end if;

    select i.cantidad into v_disponible
      from inventario_ubicacion i
     where i.ubicacion_id = v_origen.id
       and i.producto_id = v_item.producto_id
       for update;

    if v_disponible is null or v_disponible < v_item.cantidad then
      raise exception 'No hay suficiente «%» en %: hay %, se piden %',
        v_prod.nombre, v_origen.nombre, coalesce(v_disponible, 0), v_item.cantidad
        using errcode = 'PI007';
    end if;

    select e.precio into v_especial
      from precios_por_cliente e
     where e.empresa_id = v_empresa
       and e.cliente_id = v_cliente.id
       and e.producto_id = v_item.producto_id;

    v_referencia := coalesce(v_especial, v_prod.precio);
    v_negociado  := v_item.negociado;
    v_motivo     := v_item.motivo;
    v_precio     := v_referencia;

    -- Las reglas de la 0043: mayor que cero, dos decimales, motivo si baja.
    if v_negociado is not null then
      if v_negociado <= 0 or v_negociado <> round(v_negociado, 2) or v_negociado >= 10000000000 then
        raise exception 'El precio negociado debe ser mayor que cero y tener hasta dos decimales'
          using errcode = 'LN001';
      end if;

      if v_motivo is not null and v_motivo not in ('mayoreo', 'cliente_frecuente', 'promocion', 'otro') then
        raise exception 'El motivo de la negociación no es válido' using errcode = 'LN001';
      end if;

      if v_negociado = v_referencia then
        v_negociado := null;
      elsif v_negociado < v_referencia and v_motivo is null then
        raise exception 'Bajar el precio necesita un motivo' using errcode = 'LN001';
      else
        v_precio := v_negociado;
      end if;
    end if;

    v_lineas := v_lineas || jsonb_build_object(
      'producto_id', v_item.producto_id,
      'nombre', v_prod.nombre,
      'codigo', coalesce(v_prod.codigo, ''),
      'cantidad', v_item.cantidad,
      'precio', v_precio,
      'general', v_prod.precio,
      'especial', v_especial,
      'referencia', case when v_negociado is not null then v_referencia end,
      'motivo', case when v_negociado is not null then v_motivo end
    );

    v_subtotal := v_subtotal + round(v_precio * v_item.cantidad, 2);
  end loop;

  v_isv   := round(v_subtotal * v_tasa / 100, 2);
  v_total := v_subtotal + v_isv;

  if v_total <= 0 then
    raise exception 'El total del pedido debe ser mayor que cero' using errcode = 'PI001';
  end if;

  -- ── lo que se cobra en origen ──
  if not v_credito or v_hay_cobros then
    v_invalidos := medios_de_cobro_invalidos(v_cobros);

    if v_invalidos is not null then
      raise exception '%', v_invalidos using errcode = 'LM001';
    end if;

    v_cobrado := round(suma_de_cobros(v_cobros), 2);
  end if;

  if not v_credito and v_cobrado <> v_total then
    raise exception 'Los medios de pago suman %, y el total del pedido es %',
      to_char(v_cobrado, 'FM999999990.00'), to_char(v_total, 'FM999999990.00')
      using errcode = 'LM002';
  end if;

  if v_credito and v_cobrado >= v_total then
    raise exception 'La prima debe ser menor que el total del pedido. Si paga todo, envíalo al contado'
      using errcode = 'PI010';
  end if;

  if v_hay_cobros then
    v_invalidos := cargo_de_cobros_distinto(v_cobros, v_empresa);

    if v_invalidos is not null then
      raise exception '%', v_invalidos using errcode = 'LM007';
    end if;

    v_con_tasa := cobros_con_tasa(v_cobros, v_empresa);

    select coalesce(sum((c->>'cargo')::numeric), 0),
           case
             when count(*) filter (where c->>'medio' in ('tarjeta', 'enlace')) > 0
              and count(distinct (c->>'tasa')::numeric) filter (where c->>'medio' in ('tarjeta', 'enlace')) = 1
              and count(c->>'tasa') filter (where c->>'medio' in ('tarjeta', 'enlace'))
                  = count(*) filter (where c->>'medio' in ('tarjeta', 'enlace'))
             then min((c->>'tasa')::numeric) filter (where c->>'medio' in ('tarjeta', 'enlace'))
           end
      into v_cargo, v_tasa_cargo
      from jsonb_array_elements(v_con_tasa) c;
  end if;

  -- ── el número del pedido ──
  perform pg_advisory_xact_lock(hashtextextended('pedido-correlativo|' || v_empresa::text, 0));

  select coalesce(max(p.correlativo), 0) + 1 into v_correlativo
    from pedidos_ubicacion p
   where p.empresa_id = v_empresa;

  v_numero := 'PED-' || lpad(v_correlativo::text, 6, '0');

  -- ── el pedido ──
  insert into pedidos_ubicacion (
    id, empresa_id, numero, correlativo,
    origen_id, destino_id,
    cliente_id, nombre_cliente, rtn_comprador,
    forma_pago, fecha_vencimiento,
    tasa_isv, subtotal, isv, total,
    cobrado, cargo_por_medio, tasa_cargo,
    nota,
    entregado_por, entregado_por_nombre, entregado_en,
    clave_idempotencia, huella
  ) values (
    v_id, v_empresa, v_numero, v_correlativo,
    v_origen.id, v_destino.id,
    v_cliente.id, v_cliente.nombre,
    coalesce(nullif(btrim(coalesce(p_rtn_comprador, '')), ''), v_cliente.rtn, ''),
    v_forma, case when v_credito then p_fecha_vencimiento end,
    v_tasa, v_subtotal, v_isv, v_total,
    v_cobrado, v_cargo, v_tasa_cargo,
    left(btrim(coalesce(p_nota, '')), 500),
    v_usuario.id, v_usuario.nombre, v_ahora,
    p_clave_idempotencia, v_huella
  );

  -- ── renglones, descuento en origen y Kardex ──
  for v_linea in select l from jsonb_array_elements(v_lineas) l loop
    insert into pedido_detalle (
      empresa_id, pedido_id, producto_id, nombre, codigo,
      cantidad, precio, subtotal,
      precio_general, precio_especial,
      precio_referencia, negociado_por, negociado_por_nombre, negociado_en, motivo_negociacion
    ) values (
      v_empresa, v_id, (v_linea->>'producto_id')::uuid, v_linea->>'nombre', v_linea->>'codigo',
      (v_linea->>'cantidad')::integer, (v_linea->>'precio')::numeric,
      round((v_linea->>'precio')::numeric * (v_linea->>'cantidad')::integer, 2),
      (v_linea->>'general')::numeric, (v_linea->>'especial')::numeric,
      (v_linea->>'referencia')::numeric,
      case when v_linea->>'referencia' is not null then v_usuario.id end,
      case when v_linea->>'referencia' is not null then v_usuario.nombre end,
      case when v_linea->>'referencia' is not null then v_ahora end,
      v_linea->>'motivo'
    );

    update inventario_ubicacion
       set cantidad = cantidad - (v_linea->>'cantidad')::integer,
           actualizado_en = v_ahora
     where ubicacion_id = v_origen.id
       and producto_id = (v_linea->>'producto_id')::uuid;

    insert into movimientos_inventario (
      empresa_id, producto_id, usuario_id, pedido_id,
      ubicacion_id, tipo, cantidad, motivo, fecha
    ) values (
      v_empresa, (v_linea->>'producto_id')::uuid, v_usuario.id, v_id,
      v_origen.id, 'entrega_pedido', -(v_linea->>'cantidad')::integer,
      'Entrega del pedido ' || v_numero || ', se factura en ' || v_destino.nombre,
      v_ahora
    );
  end loop;

  -- ── el dinero, en la ubicación que lo recibió ──
  insert into cobros_por_medio (
    empresa_id, pedido_id, medio, monto, cargo, tasa_cargo, referencia, ubicacion_id, usuario_id, fecha
  )
  select v_empresa, v_id, c->>'medio', (c->>'monto')::numeric, (c->>'cargo')::numeric,
         (c->>'tasa')::numeric, c->>'referencia', v_origen.id, v_usuario.id, v_ahora
    from jsonb_array_elements(v_con_tasa) c;

  insert into eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, detalle)
  values (
    v_empresa, v_id, 'entregado', v_usuario.id, v_usuario.nombre, v_origen.id,
    jsonb_build_object('forma_pago', v_forma, 'total', v_total, 'cobrado', v_cobrado, 'destino_id', v_destino.id)
  );

  return resumen_de_pedido(v_id) || jsonb_build_object('repetido', false);
end $$;

revoke execute on function
  public.entregar_pedido(uuid, uuid, jsonb, text, jsonb, boolean, date, text, text, text)
from public, anon;

grant execute on function
  public.entregar_pedido(uuid, uuid, jsonb, text, jsonb, boolean, date, text, text, text)
to authenticated;

-- ─────────────────────────────────────────────────────────
-- FACTURAR EN DESTINO
-- ─────────────────────────────────────────────────────────
/*
  Una sola factura por pedido, con la numeración de la empresa y la ubicación
  destino. El pedido se bloquea: si dos dispositivos facturan a la vez, el
  segundo espera y recibe la factura que hizo el primero, marcada
  `ya_facturado`.

  No toca inventario ni registra dinero:
  - al contado, la factura nace pagada y lleva el cargo cobrado en origen;
  - a crédito, la deuda nace aquí, una sola vez. La prima, si la hubo, se
    aplica como abono de ESTA factura (no se reparte entre otras del
    cliente), con la fecha, la ubicación y el usuario de origen. Sus medios
    siguen siendo los del pedido: no se copian.
*/
create or replace function public.facturar_pedido(p_pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario     usuarios;
  v_empresa     uuid;
  v_pedido      pedidos_ubicacion;
  v_destino     ubicaciones;
  v_origen      ubicaciones;
  v_emp         empresas;
  v_fiscal      boolean;
  v_correlativo bigint;
  v_numero      text;
  v_credito     boolean;
  v_venta_id    uuid;
  v_pago_id     uuid;
  v_ahora       timestamptz := now();
begin
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid()
     and u.activo
     and not u.debe_cambiar_contrasena
   limit 1
     for share;

  if v_usuario.id is null then
    raise exception 'Inicia sesión con un usuario activo para facturar pedidos'
      using errcode = '42501';
  end if;

  if v_usuario.rol = 'contador' or not usuario_tiene_permiso('pos') then
    raise exception 'No tienes permiso para facturar pedidos'
      using errcode = '42501';
  end if;

  v_empresa := v_usuario.empresa_id;

  select p.* into v_pedido
    from pedidos_ubicacion p
   where p.id = p_pedido
     and p.empresa_id = v_empresa
     for update;

  if v_pedido.id is null then
    raise exception 'El pedido no existe en tu empresa' using errcode = 'PI008';
  end if;

  if v_usuario.rol <> 'admin' and v_usuario.ubicacion_id is distinct from v_pedido.destino_id then
    raise exception 'Solo la ubicación destino puede facturar este pedido'
      using errcode = '42501';
  end if;

  if v_pedido.estado = 'facturado' then
    return resumen_de_pedido(v_pedido.id) || jsonb_build_object('ya_facturado', true);
  end if;

  if v_pedido.estado <> 'pendiente' then
    raise exception 'El pedido % está %: no se puede facturar', v_pedido.numero, replace(v_pedido.estado, '_', ' ')
      using errcode = 'PI008';
  end if;

  select * into v_destino from ubicaciones where id = v_pedido.destino_id;
  select * into v_origen from ubicaciones where id = v_pedido.origen_id;

  if not v_destino.activa or not v_destino.vende then
    raise exception 'La ubicación «%» ya no puede facturar: el pedido sigue pendiente', v_destino.nombre
      using errcode = 'PI003';
  end if;

  select * into v_emp from empresas where id = v_empresa;

  -- La misma decisión que la venta del POS (0017).
  v_fiscal := v_destino.emite_fiscal
          and coalesce(btrim(coalesce(v_emp.cai, '')), '') <> ''
          and coalesce(v_emp.rango_hasta, 0) > 0
          and v_emp.fecha_limite_emision is not null;

  if v_fiscal and v_pedido.tasa_isv = 0 and coalesce(v_emp.tasa_isv, 15) > 0 then
    raise exception 'La ubicación «%» emite facturas fiscales y el pedido se armó sin ISV', v_destino.nombre
      using errcode = 'PI009';
  end if;

  if v_fiscal then
    v_correlativo := siguiente_correlativo('factura');
    v_numero := numero_de_factura(
      v_correlativo, v_emp.cai, v_emp.rango_hasta, v_emp.fecha_limite_emision,
      v_emp.establecimiento, v_emp.punto_emision, v_emp.tipo_documento
    );
  else
    v_correlativo := siguiente_correlativo('interno');
    v_numero      := numero_interno(v_correlativo);
  end if;

  v_credito := v_pedido.forma_pago = 'credito';

  insert into ventas (
    empresa_id, cliente_id, usuario_id, ubicacion_id,
    numero_factura, correlativo, es_fiscal, fecha,
    nombre_cliente, rtn_comprador,
    subtotal, isv, tasa_isv, total,
    forma_pago, fecha_vencimiento, estado,
    cai_emision, rango_desde_emision, rango_hasta_emision, fecha_limite_emision_emision,
    nota, cargo_por_medio, tasa_cargo, pedido_id
  ) values (
    v_empresa, v_pedido.cliente_id, v_usuario.id, v_pedido.destino_id,
    v_numero, v_correlativo, v_fiscal, v_ahora,
    v_pedido.nombre_cliente, v_pedido.rtn_comprador,
    v_pedido.subtotal, v_pedido.isv, v_pedido.tasa_isv, v_pedido.total,
    v_pedido.forma_pago, v_pedido.fecha_vencimiento,
    case when v_credito then 'pendiente' else 'pagada' end,
    case when v_fiscal then coalesce(v_emp.cai, '') else '' end,
    case when v_fiscal then v_emp.rango_desde end,
    case when v_fiscal then v_emp.rango_hasta end,
    case when v_fiscal then v_emp.fecha_limite_emision end,
    'Pedido ' || v_pedido.numero || ', entregado en ' || v_origen.nombre,
    case when v_credito then 0 else v_pedido.cargo_por_medio end,
    case when v_credito then null else v_pedido.tasa_cargo end,
    v_pedido.id
  )
  returning id into v_venta_id;

  insert into detalle_venta (
    empresa_id, venta_id, producto_id, nombre, codigo, cantidad, precio, subtotal,
    precio_referencia, negociado_por, negociado_por_nombre, negociado_en, motivo_negociacion
  )
  select v_empresa, v_venta_id, d.producto_id, d.nombre, d.codigo, d.cantidad, d.precio, d.subtotal,
         d.precio_referencia, d.negociado_por, d.negociado_por_nombre, d.negociado_en, d.motivo_negociacion
    from pedido_detalle d
   where d.pedido_id = v_pedido.id
   order by d.producto_id;

  -- La prima: un abono de esta factura, y de ninguna otra.
  if v_credito and v_pedido.cobrado > 0 then
    insert into pagos (
      empresa_id, cliente_id, usuario_id, ubicacion_id,
      monto, saldo_anterior, saldo_posterior, fecha,
      nota, cargo_por_medio, tasa_cargo, pedido_id
    ) values (
      v_empresa, v_pedido.cliente_id, v_pedido.entregado_por, v_pedido.origen_id,
      v_pedido.cobrado, v_pedido.total, v_pedido.total - v_pedido.cobrado, v_pedido.entregado_en,
      'Prima del pedido ' || v_pedido.numero || ', recibida en ' || v_origen.nombre,
      v_pedido.cargo_por_medio, v_pedido.tasa_cargo, v_pedido.id
    )
    returning id into v_pago_id;

    insert into abonos (
      empresa_id, venta_id, usuario_id, monto, fecha, nota, pago_id, saldo_anterior, saldo_posterior
    ) values (
      v_empresa, v_venta_id, v_pedido.entregado_por, v_pedido.cobrado, v_pedido.entregado_en,
      'Prima del pedido ' || v_pedido.numero, v_pago_id, v_pedido.total, v_pedido.total - v_pedido.cobrado
    );
  end if;

  update pedidos_ubicacion
     set estado = 'facturado',
         venta_id = v_venta_id,
         facturado_por = v_usuario.id,
         facturado_por_nombre = v_usuario.nombre,
         facturado_en = v_ahora
   where id = v_pedido.id;

  insert into eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, detalle)
  values (
    v_empresa, v_pedido.id, 'facturado', v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id,
    jsonb_build_object('venta_id', v_venta_id, 'numero_factura', v_numero, 'es_fiscal', v_fiscal)
  );

  return resumen_de_pedido(v_pedido.id) || jsonb_build_object('ya_facturado', false, 'es_fiscal', v_fiscal);
end $$;

revoke execute on function public.facturar_pedido(uuid) from public, anon;
grant execute on function public.facturar_pedido(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────
-- AVISOS Y BANDEJA
-- ─────────────────────────────────────────────────────────
/*
  Qué pedidos le tocan a quien pregunta. Recibidos: los que llegan a su
  ubicación; enviados: los que salen de ella. El administrador y el contador
  con historial ven los de toda la empresa.
*/
create or replace function public.pedidos_de_la_bandeja(p_vista text)
returns setof public.pedidos_ubicacion
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
    from public.pedidos_ubicacion p
   where public.pedido_visible(p.empresa_id, p.origen_id, p.destino_id)
     and (
       public.usuario_es_admin()
       or public.usuario_es_contador()
       or case p_vista
            when 'enviados' then p.origen_id = public.ubicacion_del_usuario()
            else p.destino_id = public.ubicacion_del_usuario()
          end
     )
$$;

revoke execute on function public.pedidos_de_la_bandeja(text) from public, anon, authenticated;

-- La campanita: cuántos pendientes llegan a mi ubicación y cuáles no he leído.
create or replace function public.avisos_de_pedidos()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.usuario_es_contador() or not public.usuario_tiene_permiso('pos') then
      jsonb_build_object('pendientes', 0, 'sin_leer', 0, 'ultimos', '[]'::jsonb)
    else (
      select jsonb_build_object(
        'pendientes', count(*),
        'sin_leer', count(*) filter (where l.pedido_id is null),
        'ultimos', coalesce((
          select jsonb_agg(x.fila order by x.entregado_en desc)
            from (
              select q.entregado_en,
                     jsonb_build_object(
                       'pedido_id', q.id,
                       'numero', q.numero,
                       'origen', o.nombre,
                       'nombre_cliente', q.nombre_cliente,
                       'total', q.total,
                       'entregado_en', q.entregado_en,
                       'leido', exists (
                         select 1 from public.pedido_lecturas r
                          where r.pedido_id = q.id and r.usuario_id = public.usuario_actual()
                       )
                     ) as fila
                from public.pedidos_de_la_bandeja('recibidos') q
                join public.ubicaciones o on o.id = q.origen_id
               where q.estado = 'pendiente'
               order by q.entregado_en desc
               limit 8
            ) x
        ), '[]'::jsonb)
      )
        from public.pedidos_de_la_bandeja('recibidos') p
        left join public.pedido_lecturas l on l.pedido_id = p.id and l.usuario_id = public.usuario_actual()
       where p.estado = 'pendiente'
    )
  end
$$;

revoke execute on function public.avisos_de_pedidos() from public, anon;
grant execute on function public.avisos_de_pedidos() to authenticated;

/*
  La bandeja «Pedidos recibidos» (o «enviados»). `p_estado`: pendiente,
  facturado, por_resolver, cancelado o todos.
*/
create or replace function public.bandeja_de_pedidos(p_vista text default 'recibidos', p_estado text default 'pendiente')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(p_vista, '') not in ('recibidos', 'enviados') then
    raise exception 'Bandeja desconocida: %', p_vista using errcode = 'PI001';
  end if;

  if coalesce(p_estado, '') not in ('pendiente', 'facturado', 'por_resolver', 'cancelado', 'todos') then
    raise exception 'Estado desconocido: %', p_estado using errcode = 'PI001';
  end if;

  return coalesce((
    select jsonb_agg(x.fila order by x.entregado_en desc)
      from (
        select p.entregado_en,
               jsonb_build_object(
                 'pedido_id', p.id,
                 'numero', p.numero,
                 'estado', p.estado,
                 'origen_id', p.origen_id,
                 'origen', o.nombre,
                 'destino_id', p.destino_id,
                 'destino', d.nombre,
                 'nombre_cliente', p.nombre_cliente,
                 'forma_pago', p.forma_pago,
                 'total', p.total,
                 'cobrado', p.cobrado,
                 'saldo', p.total - p.cobrado,
                 'entregado_en', p.entregado_en,
                 'entregado_por', p.entregado_por_nombre,
                 'facturado_en', p.facturado_en,
                 'numero_factura', v.numero_factura,
                 'leido', exists (
                   select 1 from public.pedido_lecturas r
                    where r.pedido_id = p.id and r.usuario_id = public.usuario_actual()
                 )
               ) as fila
          from public.pedidos_de_la_bandeja(p_vista) p
          join public.ubicaciones o on o.id = p.origen_id
          join public.ubicaciones d on d.id = p.destino_id
          left join public.ventas v on v.id = p.venta_id
         where p_estado = 'todos' or p.estado = p_estado
         order by p.entregado_en desc
         limit 300
      ) x
  ), '[]'::jsonb);
end $$;

revoke execute on function public.bandeja_de_pedidos(text, text) from public, anon;
grant execute on function public.bandeja_de_pedidos(text, text) to authenticated;

/*
  Todo lo que necesita quien revisa y factura: cliente, ubicaciones,
  productos con sus precios, ISV, cobros recibidos en origen, saldo, lo que
  salió del inventario de origen y la historia. Sin costos.
*/
create or replace function public.detalle_de_pedido(p_pedido uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos_ubicacion;
begin
  select p.* into v_pedido from public.pedidos_ubicacion p where p.id = p_pedido;

  if v_pedido.id is null or not public.pedido_visible(v_pedido.empresa_id, v_pedido.origen_id, v_pedido.destino_id) then
    raise exception 'El pedido no existe o no es de tus ubicaciones' using errcode = 'PI008';
  end if;

  return public.resumen_de_pedido(v_pedido.id) || jsonb_build_object(
    'rtn_comprador', v_pedido.rtn_comprador,
    'fecha_vencimiento', v_pedido.fecha_vencimiento,
    'tasa_cargo', v_pedido.tasa_cargo,
    'nota', v_pedido.nota,
    'entregado_por', v_pedido.entregado_por_nombre,
    'facturado_por', v_pedido.facturado_por_nombre,
    'destino_emite_fiscal', (select u.emite_fiscal from public.ubicaciones u where u.id = v_pedido.destino_id),
    'puede_facturar', coalesce(
      v_pedido.estado = 'pendiente'
      and not public.usuario_es_contador()
      and public.usuario_tiene_permiso('pos')
      and (public.usuario_es_admin() or public.ubicacion_del_usuario() = v_pedido.destino_id),
      false),
    'leido', exists (
      select 1 from public.pedido_lecturas r
       where r.pedido_id = v_pedido.id and r.usuario_id = public.usuario_actual()
    ),
    'productos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'producto_id', d.producto_id,
                 'codigo', d.codigo,
                 'nombre', d.nombre,
                 'cantidad', d.cantidad,
                 'precio', d.precio,
                 'subtotal', d.subtotal,
                 'precio_general', d.precio_general,
                 'precio_especial', d.precio_especial,
                 'precio_referencia', d.precio_referencia,
                 'motivo_negociacion', d.motivo_negociacion,
                 'negociado_por', d.negociado_por_nombre,
                 'entregado', coalesce((
                   select -sum(m.cantidad)
                     from public.movimientos_inventario m
                    where m.pedido_id = v_pedido.id
                      and m.producto_id = d.producto_id
                      and m.tipo = 'entrega_pedido'
                      and m.ubicacion_id = v_pedido.origen_id
                 ), 0)
               )
               order by d.nombre, d.producto_id
             )
        from public.pedido_detalle d
       where d.pedido_id = v_pedido.id
    ), '[]'::jsonb),
    'cobros', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'medio', c.medio,
                 'monto', c.monto,
                 'cargo', c.cargo,
                 'tasa', c.tasa_cargo,
                 'referencia', c.referencia,
                 'ubicacion', u.nombre,
                 'fecha', c.fecha
               )
               order by c.medio
             )
        from public.cobros_por_medio c
        left join public.ubicaciones u on u.id = c.ubicacion_id
       where c.pedido_id = v_pedido.id
    ), '[]'::jsonb),
    'eventos', coalesce((
      select jsonb_agg(
               jsonb_build_object('tipo', e.tipo, 'usuario', e.usuario_nombre, 'motivo', e.motivo, 'fecha', e.creado_en)
               order by e.creado_en, e.id
             )
        from public.eventos_de_pedido e
       where e.pedido_id = v_pedido.id
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.detalle_de_pedido(uuid) from public, anon;
grant execute on function public.detalle_de_pedido(uuid) to authenticated;

-- Leer un aviso: solo lo anota. El pedido no cambia.
create or replace function public.marcar_pedido_leido(p_pedido uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos_ubicacion;
  v_yo     uuid := public.usuario_actual();
begin
  select p.* into v_pedido from public.pedidos_ubicacion p where p.id = p_pedido;

  if v_yo is null or v_pedido.id is null
     or not public.pedido_visible(v_pedido.empresa_id, v_pedido.origen_id, v_pedido.destino_id) then
    raise exception 'El pedido no existe o no es de tus ubicaciones' using errcode = 'PI008';
  end if;

  insert into public.pedido_lecturas (pedido_id, usuario_id, empresa_id)
  values (v_pedido.id, v_yo, v_pedido.empresa_id)
  on conflict (pedido_id, usuario_id) do nothing;

  return true;
end $$;

revoke execute on function public.marcar_pedido_leido(uuid) from public, anon;
grant execute on function public.marcar_pedido_leido(uuid) to authenticated;
