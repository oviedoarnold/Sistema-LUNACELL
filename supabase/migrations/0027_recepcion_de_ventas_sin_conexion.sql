-- Recepción de ventas hechas sin conexión (OFF-1.1).
--
-- El vendedor cobra y entrega aunque no tenga internet; el teléfono guarda
-- la venta y la envía sola cuando vuelve la señal. Esta migración es la
-- mitad que vive en la base: recibir esa venta y aplicarla con la misma
-- lógica del POS, o —si ya no se puede aplicar— guardarla para que un
-- administrador la concilie. Una venta cobrada nunca se pierde ni se borra.
--
-- Lo que NO hace:
-- - no modifica registrar_venta_ubicacion(): la llama tal como está;
-- - no toca ningún dato: las ventas existentes quedan con origen en_linea;
-- - no activa nada: todas las ubicaciones nacen sin vender sin conexión.

-- ─────────────────────────────────────────────────────────
-- QUÉ UBICACIONES PUEDEN VENDER SIN CONEXIÓN
-- ─────────────────────────────────────────────────────────
/*
  Una marca por ubicación, apagada por omisión. La restricción impide en la
  base misma que una ubicación fiscal venda sin conexión: un número fiscal
  no se puede emitir sin el servidor, y su procedimiento de contingencia no
  está definido.
*/
alter table public.ubicaciones
  add column if not exists vende_sin_conexion boolean not null default false;

alter table public.ubicaciones drop constraint if exists ubicaciones_sin_conexion_no_fiscal;
alter table public.ubicaciones add constraint ubicaciones_sin_conexion_no_fiscal
  check (not (vende_sin_conexion and emite_fiscal));

/*
  Solo un administrador la enciende o la apaga. Mismo criterio que
  ubicaciones_fiscal_solo_admin() (0023): vigila a la aplicación
  (`authenticated`/`anon`), no al dueño ni a las funciones SECURITY DEFINER.
*/
create or replace function public.ubicaciones_sin_conexion_solo_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.usuario_es_admin() then
    return new;
  end if;

  if (tg_op = 'INSERT' and new.vende_sin_conexion)
     or (tg_op = 'UPDATE' and new.vende_sin_conexion is distinct from old.vende_sin_conexion) then
    raise exception 'Solo un administrador decide si una ubicación vende sin conexión'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists ubicaciones_sin_conexion_solo_admin on public.ubicaciones;
create trigger ubicaciones_sin_conexion_solo_admin
  before insert or update on public.ubicaciones
  for each row execute function public.ubicaciones_sin_conexion_solo_admin();

revoke execute on function public.ubicaciones_sin_conexion_solo_admin() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- TRAZABILIDAD EN LAS VENTAS
-- ─────────────────────────────────────────────────────────
/*
  En una venta sin conexión `fecha` es la hora real de la venta (validada,
  y corregida si el reloj del teléfono estaba desfasado). Se conservan
  además la hora que declaró el teléfono, la de su reloj al enviar y la de
  llegada al servidor. Los movimientos de inventario conservan la hora en
  que se registraron: el libro no se reescribe.

  La huella resume el contenido original: un reenvío con la misma clave y
  otra huella no es un reintento sino otra venta, y se rechaza.
*/
alter table public.ventas add column if not exists origen text not null default 'en_linea';
alter table public.ventas drop constraint if exists ventas_origen_valido;
alter table public.ventas add constraint ventas_origen_valido
  check (origen in ('en_linea', 'sin_conexion', 'conciliacion'));

alter table public.ventas add column if not exists dispositivo text;
alter table public.ventas add column if not exists numero_provisional text;
alter table public.ventas add column if not exists registrada_en timestamptz;
alter table public.ventas add column if not exists recibida_en timestamptz;
alter table public.ventas add column if not exists reloj_dispositivo timestamptz;
alter table public.ventas add column if not exists reloj_corregido boolean not null default false;
alter table public.ventas add column if not exists huella_origen text;

-- ─────────────────────────────────────────────────────────
-- VENTAS POR CONCILIAR
-- ─────────────────────────────────────────────────────────
/*
  Una venta que llegó y no se pudo aplicar: precio distinto, existencia
  insuficiente, vendedor desactivado, ubicación cambiada… Ya se cobró y se
  entregó, así que se guarda tal cual —con lo que de verdad se cobró— y un
  administrador decide: aplicarla o anularla con su motivo.

  Es un registro, no un borrador: no se borra nunca y sus datos no cambian.
  Solo se escribe su resolución, una vez.
*/
create table if not exists public.ventas_por_conciliar (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas (id),
  clave_idempotencia  text not null,
  huella              text not null,

  usuario_id          uuid references public.usuarios (id),
  usuario_auth        uuid not null,
  ubicacion_id        uuid not null,
  dispositivo         text not null,
  numero_provisional  text not null,

  registrada_en       timestamptz not null,
  reloj_dispositivo   timestamptz,
  recibida_en         timestamptz not null default now(),
  fecha               timestamptz not null,
  reloj_corregido     boolean not null default false,

  forma_pago          text not null check (forma_pago in ('contado', 'credito')),
  cliente_id          uuid,
  nombre_cliente      text not null default '',
  rtn_comprador       text not null default '',
  fecha_vencimiento   date,
  nota                text not null default '',
  renglones           jsonb not null,
  tasa_isv            numeric(5,2) not null,
  total_cobrado       numeric(12,2) not null,

  motivo              text not null check (motivo in (
                        'usuario-inactivo', 'sin-permiso', 'ubicacion-cambiada',
                        'ubicacion-no-habilitada', 'fecha-fuera-de-rango', 'precio-distinto',
                        'existencia-insuficiente', 'producto-invalido', 'cliente-invalido',
                        'rescate', 'otro-negocio')),
  codigo              text,
  detalle             text not null default '',
  recibida_por        text not null check (recibida_por in ('vendedor', 'rescate')),
  rescatada_por       uuid references public.usuarios (id),

  estado              text not null default 'pendiente' check (estado in ('pendiente', 'aplicada', 'anulada')),
  resuelta_en         timestamptz,
  resuelta_por        uuid references public.usuarios (id),
  resolucion_accion   text check (resolucion_accion in ('aplicar', 'aplicar_con_ajuste', 'anular')),
  resolucion_motivo   text,
  venta_id            uuid references public.ventas (id),
  ajuste_movimientos  jsonb not null default '[]'::jsonb,

  constraint ventas_por_conciliar_ubicacion_de_la_empresa
    foreign key (ubicacion_id, empresa_id) references public.ubicaciones (id, empresa_id)
);

create unique index if not exists ventas_por_conciliar_clave
  on public.ventas_por_conciliar (empresa_id, clave_idempotencia);

create index if not exists ventas_por_conciliar_pendientes
  on public.ventas_por_conciliar (empresa_id, estado, recibida_en);

/*
  Lo que no se puede tocar, ni desde una función SECURITY DEFINER: borrar
  la fila, cambiar los datos de la venta o reabrir una ya resuelta. Lo
  único que se escribe es la resolución, una sola vez.
*/
create or replace function public.ventas_por_conciliar_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las ventas por conciliar no se borran: se aplican o se anulan con su motivo'
      using errcode = '42501';
  end if;

  if old.estado <> 'pendiente' then
    raise exception 'Una venta ya conciliada no se puede volver a conciliar'
      using errcode = '42501';
  end if;

  if (new.id, new.empresa_id, new.clave_idempotencia, new.huella, new.usuario_id, new.usuario_auth,
      new.ubicacion_id, new.dispositivo, new.numero_provisional, new.registrada_en,
      new.reloj_dispositivo, new.recibida_en, new.fecha, new.reloj_corregido, new.forma_pago,
      new.cliente_id, new.nombre_cliente, new.rtn_comprador, new.fecha_vencimiento, new.nota,
      new.renglones, new.tasa_isv, new.total_cobrado, new.motivo, new.codigo, new.detalle,
      new.recibida_por, new.rescatada_por)
     is distinct from
     (old.id, old.empresa_id, old.clave_idempotencia, old.huella, old.usuario_id, old.usuario_auth,
      old.ubicacion_id, old.dispositivo, old.numero_provisional, old.registrada_en,
      old.reloj_dispositivo, old.recibida_en, old.fecha, old.reloj_corregido, old.forma_pago,
      old.cliente_id, old.nombre_cliente, old.rtn_comprador, old.fecha_vencimiento, old.nota,
      old.renglones, old.tasa_isv, old.total_cobrado, old.motivo, old.codigo, old.detalle,
      old.recibida_por, old.rescatada_por) then
    raise exception 'Los datos de una venta por conciliar no se pueden modificar'
      using errcode = '42501';
  end if;

  if new.estado not in ('aplicada', 'anulada') or new.resuelta_por is null
     or new.resolucion_accion is null or btrim(coalesce(new.resolucion_motivo, '')) = '' then
    raise exception 'Una conciliación necesita su resultado, quién la hizo y el motivo'
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists ventas_por_conciliar_inmutable on public.ventas_por_conciliar;
create trigger ventas_por_conciliar_inmutable
  before update or delete on public.ventas_por_conciliar
  for each row execute function public.ventas_por_conciliar_inmutable();

revoke execute on function public.ventas_por_conciliar_inmutable() from public, anon, authenticated;

alter table public.ventas_por_conciliar enable row level security;

revoke all on public.ventas_por_conciliar from public, anon, authenticated;
grant select on public.ventas_por_conciliar to authenticated;

-- El administrador ve las de su empresa; el vendedor, las suyas.
drop policy if exists ventas_por_conciliar_lectura on public.ventas_por_conciliar;
create policy ventas_por_conciliar_lectura on public.ventas_por_conciliar
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and ((select public.usuario_es_admin()) or usuario_id = (select public.usuario_actual()))
  );

-- ─────────────────────────────────────────────────────────
-- AUDITORÍA DE RESCATES
-- ─────────────────────────────────────────────────────────
/*
  Cada intento de rescate, aceptado o no, queda aquí: quién, cuándo, de qué
  lote y con qué resultado. Solo se inserta; nunca se cambia ni se borra.
*/
create table if not exists public.auditoria_rescates (
  id                 bigint generated always as identity primary key,
  empresa_id         uuid not null references public.empresas (id),
  administrador_id   uuid not null references public.usuarios (id),
  lote               text,
  clave              text,
  huella             text,
  usuario_auth       uuid,
  dispositivo        text,
  resultado          text not null check (resultado in ('en_conciliacion', 'ya_en_conciliacion', 'ya_registrada', 'rechazado')),
  codigo             text,
  detalle            text not null default '',
  conciliacion_id    uuid references public.ventas_por_conciliar (id),
  venta_id           uuid references public.ventas (id),
  creado_en          timestamptz not null default now()
);

create or replace function public.auditoria_rescates_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La auditoría de rescates no se modifica ni se borra'
    using errcode = '42501';
end $$;

drop trigger if exists auditoria_rescates_inmutable on public.auditoria_rescates;
create trigger auditoria_rescates_inmutable
  before update or delete on public.auditoria_rescates
  for each row execute function public.auditoria_rescates_inmutable();

revoke execute on function public.auditoria_rescates_inmutable() from public, anon, authenticated;

alter table public.auditoria_rescates enable row level security;

revoke all on public.auditoria_rescates from public, anon, authenticated;
grant select on public.auditoria_rescates to authenticated;

drop policy if exists auditoria_rescates_lectura_admin on public.auditoria_rescates;
create policy auditoria_rescates_lectura_admin on public.auditoria_rescates
  for select
  to authenticated
  using (empresa_id = (select public.empresa_del_usuario()) and (select public.usuario_es_admin()));

-- ─────────────────────────────────────────────────────────
-- PIEZAS INTERNAS (nadie de la aplicación las llama directo)
-- ─────────────────────────────────────────────────────────
/*
  La venta viaja dentro de la base como un solo jsonb con las claves de los
  parámetros de las RPC. Así validarla, resumirla y guardarla se escribe una
  vez para la sincronización y para el rescate.
*/

-- Qué tiene de mal formado; null si nada. Nunca lanza.
create or replace function public.venta_sin_conexion_invalida(p_venta jsonb, p_empresa uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_renglon  jsonb;
  v_cantidad numeric;
  v_precio   numeric;
  v_tasa     numeric;
  v_subtotal numeric := 0;
begin
  begin
    if coalesce(p_venta->>'clave', '') !~ '^off-[A-Za-z0-9-]{8,150}$' then
      return 'La clave de la venta no es válida';
    end if;

    if coalesce(p_venta->>'dispositivo', '') !~ '^[A-Za-z0-9-]{4,64}$' then
      return 'El identificador del dispositivo no es válido';
    end if;

    if btrim(coalesce(p_venta->>'numero_provisional', '')) = ''
       or length(p_venta->>'numero_provisional') > 60 then
      return 'El número provisional no es válido';
    end if;

    if (p_venta->>'usuario_auth') is null
       or (p_venta->>'registrada_en')::timestamptz is null
       or (p_venta->>'reloj_dispositivo')::timestamptz is null then
      return 'Faltan el vendedor o las fechas de la venta';
    end if;

    if coalesce(p_venta->>'forma_pago', '') not in ('contado', 'credito') then
      return 'La forma de pago no es válida';
    end if;

    if p_venta->>'forma_pago' = 'credito' and (p_venta->>'cliente_id') is null then
      return 'Una venta a crédito necesita un cliente';
    end if;

    perform (p_venta->>'cliente_id')::uuid, (p_venta->>'fecha_vencimiento')::date;

    if (p_venta->>'ubicacion_id') is null or not exists (
      select 1 from public.ubicaciones u
       where u.id = (p_venta->>'ubicacion_id')::uuid and u.empresa_id = p_empresa
    ) then
      return 'La ubicación no pertenece a la empresa';
    end if;

    v_tasa := (p_venta->>'tasa_isv')::numeric;

    if v_tasa is null or v_tasa < 0 or v_tasa > 100 then
      return 'La tasa de impuesto no es válida';
    end if;

    if jsonb_typeof(p_venta->'renglones') is distinct from 'array'
       or jsonb_array_length(p_venta->'renglones') not between 1 and 200 then
      return 'La venta no tiene renglones';
    end if;

    for v_renglon in select * from jsonb_array_elements(p_venta->'renglones') loop
      v_cantidad := (v_renglon->>'cantidad')::numeric;
      v_precio   := (v_renglon->>'precio_unitario')::numeric;

      if jsonb_typeof(v_renglon) <> 'object' or (v_renglon->>'producto_id')::uuid is null
         or v_cantidad is null or v_cantidad <> trunc(v_cantidad) or v_cantidad not between 1 and 100000
         or v_precio is null or v_precio < 0 or v_precio <> round(v_precio, 2) then
        return 'Un renglón de la venta no es válido';
      end if;

      v_subtotal := v_subtotal + round(v_precio * v_cantidad, 2);
    end loop;

    -- Mismo cálculo que el POS y que registrar_venta_ubicacion().
    if (p_venta->>'total_cobrado')::numeric is distinct from v_subtotal + round(v_subtotal * v_tasa / 100, 2) then
      return 'El total cobrado no coincide con sus renglones';
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format
      or datetime_field_overflow or invalid_parameter_value then
      return 'El contenido de la venta no es válido';
  end;

  return null;
end $$;

/*
  La huella del contenido original: todo lo que el vendedor registró, en un
  orden fijo. Los renglones se ordenan para que el mismo contenido dé la
  misma huella aunque el teléfono los mande en otro orden.
*/
create or replace function public.huella_venta_sin_conexion(p_venta jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  select md5(concat_ws(chr(31),
    p_venta->>'usuario_auth',
    p_venta->>'ubicacion_id',
    coalesce(p_venta->>'dispositivo', ''),
    coalesce(p_venta->>'numero_provisional', ''),
    to_char((p_venta->>'registrada_en')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
    round((p_venta->>'tasa_isv')::numeric, 2)::text,
    (select coalesce(string_agg(
              concat_ws(chr(30),
                r->>'producto_id',
                coalesce(r->>'codigo', ''),
                coalesce(r->>'nombre', ''),
                ((r->>'cantidad')::numeric)::bigint::text,
                round((r->>'precio_unitario')::numeric, 2)::text),
              chr(29)
              order by r->>'producto_id', (r->>'cantidad')::numeric, (r->>'precio_unitario')::numeric,
                       r->>'codigo', r->>'nombre'), '')
       from jsonb_array_elements(p_venta->'renglones') r),
    round((p_venta->>'total_cobrado')::numeric, 2)::text,
    coalesce(p_venta->>'forma_pago', ''),
    coalesce(p_venta->>'cliente_id', ''),
    btrim(coalesce(p_venta->>'nombre_cliente', '')),
    btrim(coalesce(p_venta->>'rtn_comprador', '')),
    coalesce(p_venta->>'fecha_vencimiento', ''),
    btrim(coalesce(p_venta->>'nota', ''))))
$$;

/*
  ¿Ya llegó esta clave? Mira las dos tablas: una venta aplicada (también la
  que se aplicó al conciliar, que conserva la clave) o una por conciliar.
  Con la misma huella responde lo que ya hay; con otra, OF003. Null si la
  clave es nueva.
*/
create or replace function public.venta_sin_conexion_existente(p_empresa uuid, p_clave text, p_huella text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venta record;
  v_conc  record;
begin
  select v.id, v.numero_factura, v.total, v.huella_origen into v_venta
    from public.ventas v
   where v.empresa_id = p_empresa and v.clave_idempotencia = p_clave;

  if found then
    if v_venta.huella_origen is distinct from p_huella then
      return jsonb_build_object('estado', 'OF003');
    end if;

    return jsonb_build_object(
      'estado', 'ya_registrada', 'venta_id', v_venta.id,
      'numero_factura', v_venta.numero_factura, 'total', v_venta.total);
  end if;

  select c.id, c.huella, c.estado, c.motivo, c.venta_id into v_conc
    from public.ventas_por_conciliar c
   where c.empresa_id = p_empresa and c.clave_idempotencia = p_clave;

  if found then
    if v_conc.huella is distinct from p_huella then
      return jsonb_build_object('estado', 'OF003');
    end if;

    return jsonb_build_object(
      'estado', 'ya_en_conciliacion', 'conciliacion_id', v_conc.id,
      'conciliacion_estado', v_conc.estado, 'motivo', v_conc.motivo, 'venta_id', v_conc.venta_id);
  end if;

  return null;
end $$;

-- Guarda la venta tal como llegó, para conciliarla. Devuelve su id.
create or replace function public.guardar_venta_por_conciliar(
  p_venta         jsonb,
  p_empresa       uuid,
  p_usuario       uuid,
  p_huella        text,
  p_fecha         timestamptz,
  p_corregido     boolean,
  p_motivo        text,
  p_codigo        text,
  p_detalle       text,
  p_recibida_por  text,
  p_rescatada_por uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.ventas_por_conciliar (
    empresa_id, clave_idempotencia, huella, usuario_id, usuario_auth, ubicacion_id,
    dispositivo, numero_provisional, registrada_en, reloj_dispositivo, fecha, reloj_corregido,
    forma_pago, cliente_id, nombre_cliente, rtn_comprador, fecha_vencimiento, nota,
    renglones, tasa_isv, total_cobrado, motivo, codigo, detalle, recibida_por, rescatada_por
  )
  values (
    p_empresa, p_venta->>'clave', p_huella, p_usuario, (p_venta->>'usuario_auth')::uuid,
    (p_venta->>'ubicacion_id')::uuid, p_venta->>'dispositivo', p_venta->>'numero_provisional',
    (p_venta->>'registrada_en')::timestamptz, (p_venta->>'reloj_dispositivo')::timestamptz,
    p_fecha, p_corregido, p_venta->>'forma_pago', (p_venta->>'cliente_id')::uuid,
    btrim(coalesce(p_venta->>'nombre_cliente', '')), btrim(coalesce(p_venta->>'rtn_comprador', '')),
    (p_venta->>'fecha_vencimiento')::date, coalesce(p_venta->>'nota', ''),
    p_venta->'renglones', (p_venta->>'tasa_isv')::numeric, (p_venta->>'total_cobrado')::numeric,
    p_motivo, p_codigo, coalesce(p_detalle, ''), p_recibida_por, p_rescatada_por
  )
  returning id
$$;

revoke execute on function
  public.venta_sin_conexion_invalida(jsonb, uuid),
  public.huella_venta_sin_conexion(jsonb),
  public.venta_sin_conexion_existente(uuid, text, text),
  public.guardar_venta_por_conciliar(jsonb, uuid, uuid, text, timestamptz, boolean, text, text, text, text, uuid)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- SINCRONIZAR (la llama el teléfono del vendedor)
-- ─────────────────────────────────────────────────────────
/*
  Responde siempre con éxito cuando el servidor se queda con la venta:
  registrada, ya_registrada, en_conciliacion o ya_en_conciliacion. En los
  cuatro casos el teléfono puede dejar de reenviarla.

  Solo lanza cuando el teléfono debe conservarla y esperar:
  - 42501: sin sesión, o una identidad que no es de ninguna empresa;
  - OF002: la venta es de otro usuario (la sincroniza quien la hizo);
  - OF001: el contenido está mal formado;
  - OF003: la clave ya se usó para otro contenido.
  Cualquier otro error (bloqueo, red, fallo interno) se propaga y el
  teléfono reintenta: nunca se disfraza de conciliación.
*/
create or replace function public.sincronizar_venta_sin_conexion(
  p_clave_idempotencia text,
  p_usuario_auth       uuid,
  p_ubicacion_id       uuid,
  p_dispositivo        text,
  p_numero_provisional text,
  p_registrada_en      timestamptz,
  p_reloj_dispositivo  timestamptz,
  p_tasa_isv           numeric,
  p_renglones          jsonb,
  p_total_cobrado      numeric,
  p_forma_pago         text,
  p_cliente_id         uuid default null,
  p_nombre_cliente     text default null,
  p_rtn_comprador      text default '',
  p_fecha_vencimiento  date default null,
  p_nota               text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth      uuid := auth.uid();
  v_usuario   usuarios;
  v_venta     jsonb;
  v_invalida  text;
  v_huella    text;
  v_previa    jsonb;
  v_ubic      record;
  v_desfase   interval;
  v_fecha     timestamptz;
  v_corregido boolean := false;
  v_motivo    text;
  v_codigo    text;
  v_detalle   text;
  v_items     jsonb;
  v_resultado jsonb;
  v_id        uuid;
begin
  if v_auth is null then
    raise exception 'Inicia sesión para sincronizar ventas' using errcode = '42501';
  end if;

  if p_usuario_auth is distinct from v_auth then
    raise exception 'Esta venta es de otro usuario: la sincroniza quien la hizo' using errcode = 'OF002';
  end if;

  -- Sin filtrar por activo: un vendedor desactivado no pierde sus ventas.
  select * into v_usuario from usuarios where auth_id = v_auth limit 1;

  if v_usuario.id is null then
    raise exception 'Tu cuenta no pertenece a ninguna empresa' using errcode = '42501';
  end if;

  v_venta := jsonb_build_object(
    'clave', p_clave_idempotencia, 'usuario_auth', p_usuario_auth, 'ubicacion_id', p_ubicacion_id,
    'dispositivo', p_dispositivo, 'numero_provisional', p_numero_provisional,
    'registrada_en', p_registrada_en, 'reloj_dispositivo', p_reloj_dispositivo,
    'tasa_isv', p_tasa_isv, 'renglones', p_renglones, 'total_cobrado', p_total_cobrado,
    'forma_pago', p_forma_pago, 'cliente_id', p_cliente_id, 'nombre_cliente', p_nombre_cliente,
    'rtn_comprador', p_rtn_comprador, 'fecha_vencimiento', p_fecha_vencimiento, 'nota', p_nota);

  v_invalida := venta_sin_conexion_invalida(v_venta, v_usuario.empresa_id);

  if v_invalida is not null then
    raise exception '%', v_invalida using errcode = 'OF001';
  end if;

  v_huella := huella_venta_sin_conexion(v_venta);

  /*
    Un envío por clave a la vez. Sin esto, dos envíos simultáneos de la
    misma venta podrían dejar una aplicada y otra en conciliación.
  */
  perform pg_advisory_xact_lock(hashtextextended(v_usuario.empresa_id::text || ':' || p_clave_idempotencia, 0));

  v_previa := venta_sin_conexion_existente(v_usuario.empresa_id, p_clave_idempotencia, v_huella);

  if v_previa is not null then
    if v_previa->>'estado' = 'OF003' then
      raise exception 'La clave % ya se usó para una venta distinta', p_clave_idempotencia
        using errcode = 'OF003';
    end if;

    return v_previa;
  end if;

  /*
    El reloj del teléfono: si al enviar difería más de 10 minutos del
    servidor, se supone que difería igual al vender y se corrige la fecha.
    La hora declarada se guarda sin tocar.
  */
  v_desfase := now() - p_reloj_dispositivo;

  if abs(extract(epoch from v_desfase)) > 600 then
    v_fecha := p_registrada_en + v_desfase;
    v_corregido := true;
  else
    v_fecha := p_registrada_en;
  end if;

  select vende_sin_conexion, activa, vende into v_ubic from ubicaciones where id = p_ubicacion_id;

  v_motivo := case
    when not v_usuario.activo or v_usuario.debe_cambiar_contrasena then 'usuario-inactivo'
    when not usuario_tiene_permiso('pos') then 'sin-permiso'
    when v_usuario.ubicacion_id is distinct from p_ubicacion_id then 'ubicacion-cambiada'
    when not (v_ubic.vende_sin_conexion and v_ubic.activa and v_ubic.vende) then 'ubicacion-no-habilitada'
    when p_registrada_en > p_reloj_dispositivo + interval '1 minute'
      or v_fecha > now() + interval '10 minutes'
      or v_fecha < now() - interval '7 days' then 'fecha-fuera-de-rango'
    when p_cliente_id is not null and not exists (
      select 1 from clientes c where c.id = p_cliente_id and c.empresa_id = v_usuario.empresa_id
    ) then 'cliente-invalido'
    when exists (
      select 1 from jsonb_array_elements(p_renglones) r
       where not exists (
         select 1 from productos p
          where p.id = (r->>'producto_id')::uuid and p.empresa_id = v_usuario.empresa_id and p.activo)
    ) then 'producto-invalido'
    when round(p_tasa_isv, 2) is distinct from (select coalesce(e.tasa_isv, 15) from empresas e where e.id = v_usuario.empresa_id)
      or exists (
        select 1 from jsonb_array_elements(p_renglones) r
          join productos p on p.id = (r->>'producto_id')::uuid
         where p.precio <> (r->>'precio_unitario')::numeric
      ) then 'precio-distinto'
  end;

  if v_motivo is null then
    /*
      La venta, con la misma lógica que el POS en línea y la misma clave.
      Si la rechaza por una regla de negocio, todo lo que hizo —venta,
      renglones, existencia, movimiento y número— se deshace con la
      subtransacción, y la venta pasa a conciliación.
    */
    begin
      select jsonb_agg(jsonb_build_object('producto_id', r->'producto_id', 'cantidad', (r->>'cantidad')::int))
        into v_items
        from jsonb_array_elements(p_renglones) r;

      v_resultado := registrar_venta_ubicacion(
        v_items, p_forma_pago, p_cliente_id, p_nombre_cliente, p_rtn_comprador,
        p_fecha_vencimiento, p_nota, p_clave_idempotencia);

      if (v_resultado->>'total')::numeric is distinct from round(p_total_cobrado, 2) then
        raise exception 'El total registrado (%) no coincide con el cobrado (%)', v_resultado->>'total', p_total_cobrado
          using errcode = 'OF009';
      end if;

      update ventas
         set fecha              = v_fecha,
             origen             = 'sin_conexion',
             dispositivo        = p_dispositivo,
             numero_provisional = p_numero_provisional,
             registrada_en      = p_registrada_en,
             recibida_en        = now(),
             reloj_dispositivo  = p_reloj_dispositivo,
             reloj_corregido    = v_corregido,
             huella_origen      = v_huella
       where id = (v_resultado->>'venta_id')::uuid;

      return jsonb_build_object(
        'estado', 'registrada', 'venta_id', v_resultado->'venta_id',
        'numero_factura', v_resultado->'numero_factura', 'total', v_resultado->'total');
    exception
      when sqlstate 'LV001' or sqlstate 'LV002' or sqlstate 'LV008' then
        v_motivo := 'ubicacion-no-habilitada'; v_codigo := sqlstate; v_detalle := sqlerrm;
      when sqlstate 'LV004' then
        v_motivo := 'cliente-invalido'; v_codigo := sqlstate; v_detalle := sqlerrm;
      when sqlstate 'LV006' then
        v_motivo := 'producto-invalido'; v_codigo := sqlstate; v_detalle := sqlerrm;
      when sqlstate 'LV007' then
        v_motivo := 'existencia-insuficiente'; v_codigo := sqlstate; v_detalle := sqlerrm;
      when sqlstate 'OF009' then
        v_motivo := 'precio-distinto'; v_codigo := sqlstate; v_detalle := sqlerrm;
      when sqlstate 'LV003' or sqlstate 'LV005' or sqlstate '42501' then
        v_motivo := 'otro-negocio'; v_codigo := sqlstate; v_detalle := sqlerrm;
    end;
  end if;

  v_detalle := coalesce(v_detalle, case v_motivo
    when 'usuario-inactivo' then 'El vendedor está desactivado o tiene un cambio de contraseña pendiente'
    when 'sin-permiso' then 'El vendedor ya no tiene permiso para facturar'
    when 'ubicacion-cambiada' then 'El vendedor ya no está asignado a la ubicación de la venta'
    when 'ubicacion-no-habilitada' then 'La ubicación no está habilitada para vender sin conexión'
    when 'fecha-fuera-de-rango' then 'La fecha de la venta está fuera del rango aceptado'
    when 'cliente-invalido' then 'El cliente de la venta no existe en la empresa'
    when 'producto-invalido' then 'Uno de los productos no existe o está inactivo'
    when 'precio-distinto' then 'El precio o el impuesto cambiaron desde la venta'
  end);

  v_id := guardar_venta_por_conciliar(
    v_venta, v_usuario.empresa_id, v_usuario.id, v_huella, v_fecha, v_corregido,
    v_motivo, v_codigo, v_detalle, 'vendedor', null);

  return jsonb_build_object(
    'estado', 'en_conciliacion', 'conciliacion_id', v_id, 'motivo', v_motivo, 'detalle', v_detalle);
end $$;

-- ─────────────────────────────────────────────────────────
-- RESCATAR (la llama un administrador, en emergencia)
-- ─────────────────────────────────────────────────────────
/*
  Para subir las ventas de un teléfono cuya sesión ya no sirve. Nunca crea
  una venta: solo filas de conciliación marcadas como rescate, que después
  se aplican o se anulan con su motivo.

  Cada intento queda en auditoria_rescates. Por eso, salvo que quien llama
  no sea administrador, no lanza: responde `rechazado` con el código, y el
  rechazo queda escrito.

  La fecha no se corrige por el reloj: el archivo pudo viajar días antes de
  subirse, así que el desfase no diría nada.
*/
create or replace function public.rescatar_venta_sin_conexion(
  p_clave_idempotencia text,
  p_usuario_auth       uuid,
  p_ubicacion_id       uuid,
  p_dispositivo        text,
  p_numero_provisional text,
  p_registrada_en      timestamptz,
  p_reloj_dispositivo  timestamptz,
  p_tasa_isv           numeric,
  p_renglones          jsonb,
  p_total_cobrado      numeric,
  p_forma_pago         text,
  p_cliente_id         uuid default null,
  p_nombre_cliente     text default null,
  p_rtn_comprador      text default '',
  p_fecha_vencimiento  date default null,
  p_nota               text default '',
  p_lote               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin     usuarios := acceso_administrador(auth.uid());
  v_vendedor  uuid;
  v_venta     jsonb;
  v_invalida  text;
  v_huella    text;
  v_previa    jsonb;
  v_respuesta jsonb;
  v_id        uuid;
begin
  v_venta := jsonb_build_object(
    'clave', p_clave_idempotencia, 'usuario_auth', p_usuario_auth, 'ubicacion_id', p_ubicacion_id,
    'dispositivo', p_dispositivo, 'numero_provisional', p_numero_provisional,
    'registrada_en', p_registrada_en, 'reloj_dispositivo', p_reloj_dispositivo,
    'tasa_isv', p_tasa_isv, 'renglones', p_renglones, 'total_cobrado', p_total_cobrado,
    'forma_pago', p_forma_pago, 'cliente_id', p_cliente_id, 'nombre_cliente', p_nombre_cliente,
    'rtn_comprador', p_rtn_comprador, 'fecha_vencimiento', p_fecha_vencimiento, 'nota', p_nota);

  select u.id into v_vendedor from usuarios u
   where u.auth_id = p_usuario_auth and u.empresa_id = v_admin.empresa_id;

  if v_vendedor is null then
    v_respuesta := jsonb_build_object('estado', 'rechazado', 'codigo', '42501',
      'detalle', 'El vendedor no pertenece a tu empresa');
  else
    v_invalida := venta_sin_conexion_invalida(v_venta, v_admin.empresa_id);

    if v_invalida is not null then
      v_respuesta := jsonb_build_object('estado', 'rechazado', 'codigo', 'OF001', 'detalle', v_invalida);
    else
      v_huella := huella_venta_sin_conexion(v_venta);

      perform pg_advisory_xact_lock(hashtextextended(v_admin.empresa_id::text || ':' || p_clave_idempotencia, 0));

      v_previa := venta_sin_conexion_existente(v_admin.empresa_id, p_clave_idempotencia, v_huella);

      if v_previa->>'estado' = 'OF003' then
        v_respuesta := jsonb_build_object('estado', 'rechazado', 'codigo', 'OF003',
          'detalle', 'La clave ya se usó para una venta distinta');
      elsif v_previa is not null then
        v_respuesta := v_previa;
      else
        v_id := guardar_venta_por_conciliar(
          v_venta, v_admin.empresa_id, v_vendedor, v_huella, p_registrada_en, false,
          'rescate', null, 'Subida por un administrador desde el teléfono del vendedor',
          'rescate', v_admin.id);

        v_respuesta := jsonb_build_object('estado', 'en_conciliacion', 'conciliacion_id', v_id, 'motivo', 'rescate');
      end if;
    end if;
  end if;

  insert into auditoria_rescates (
    empresa_id, administrador_id, lote, clave, huella, usuario_auth, dispositivo,
    resultado, codigo, detalle, conciliacion_id, venta_id
  ) values (
    v_admin.empresa_id, v_admin.id, nullif(btrim(coalesce(p_lote, '')), ''), p_clave_idempotencia,
    v_huella, p_usuario_auth, p_dispositivo, v_respuesta->>'estado', v_respuesta->>'codigo',
    coalesce(v_respuesta->>'detalle', ''), (v_respuesta->>'conciliacion_id')::uuid,
    (v_respuesta->>'venta_id')::uuid
  );

  return v_respuesta;
end $$;

revoke execute on function
  public.sincronizar_venta_sin_conexion(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, uuid, text, text, date, text),
  public.rescatar_venta_sin_conexion(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, uuid, text, text, date, text, text)
from public, anon;

grant execute on function
  public.sincronizar_venta_sin_conexion(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, uuid, text, text, date, text),
  public.rescatar_venta_sin_conexion(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, uuid, text, text, date, text, text)
to authenticated;
