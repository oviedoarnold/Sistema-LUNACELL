-- Pedidos interubicación, etapa B: caja por ubicación y liquidaciones internas.
--
-- En un pedido, una ubicación entrega y cobra (Bodega) y otra factura (Camión 01).
-- El cobro del cliente ya está guardado una sola vez, en cobros_por_medio.pedido_id,
-- con la ubicación que recibió el dinero, el usuario, la fecha, el medio, la tasa y
-- el cargo (0045). Esta migración no lo duplica ni lo cambia: lo usa para dos cosas.
--
-- 1. La caja por ubicación. Los reportes de siempre (reporte_diario y
--    reporte_medios_de_pago) contaban el contado de la factura de un pedido como
--    cobrado por la ubicación que factura, el día que factura, y sin medio. Las
--    versiones «de caja» parten de ellos y solo corrigen lo que es de pedidos:
--    - el cobro cuenta para la ubicación que lo recibió, el día que lo recibió y
--      con su medio real, como «cobrado por cuenta de otra ubicación»;
--    - el contado de la factura de un pedido no se cuenta otra vez como cobro de
--      quien factura (sigue contando como venta suya);
--    - la prima de un crédito ya está en esos cobros: su abono no se suma de nuevo.
--    Las ventas y abonos normales quedan exactamente igual.
--
-- 2. Las liquidaciones entre ubicaciones (decisiones del propietario, 2026-11-16):
--    - lo electrónico (transferencia, tarjeta, enlace y su cargo del 1.70 %) llega
--      a la cuenta única de la empresa: no se liquida entre ubicaciones;
--    - el efectivo que cobra una ubicación para otra queda por liquidar desde el
--      cobro, aunque la factura esté pendiente;
--    - la liquidación va en dos pasos: quien entrega registra la entrega y la
--      ubicación beneficiaria confirma haberla recibido (o la rechaza).
--    Una liquidación no es venta, cobro ni abono: no toca facturas, cuentas por
--    cobrar, cajas ni inventario.
--
-- Pendiente para la etapa C: si un pedido se anula o se cancela, lo liquidado de
-- él tendrá que revertirse o ajustarse. Aquí no existe todavía esa operación.
--
-- Errores: LQ001 datos no válidos; LQ002 monto mayor que lo disponible;
-- LQ003 la clave ya se usó para otra liquidación; LQ004 la liquidación no está
-- por confirmar; 42501 sin permiso o fuera de las ubicaciones del usuario.
--
-- No toca filas ni funciones existentes. Idempotente.

-- ─────────────────────────────────────────────────────────
-- LOS PERMISOS
-- ─────────────────────────────────────────────────────────
/*
  Consultar y operar van aparte. Nadie los recibe al aplicarla; el administrador
  los tiene por usuario_tiene_permiso(), como todos.
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
    'orders-resolve', 'orders-cancel',
    'settlements-view', 'settlements-manage'
  ));

-- ─────────────────────────────────────────────────────────
-- LAS LIQUIDACIONES
-- ─────────────────────────────────────────────────────────
create table if not exists public.liquidaciones_ubicacion (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references public.empresas (id),
  numero                 text not null,
  correlativo            bigint not null check (correlativo > 0),

  -- Quién entrega el efectivo y quién lo recibe (la ubicación que factura).
  origen_id              uuid not null,
  destino_id             uuid not null,

  monto                  numeric(12,2) not null check (monto > 0),
  metodo                 text not null check (metodo in ('entrega_en_efectivo', 'deposito_a_cuenta')),
  fecha_efectiva         date not null,
  referencia             text not null default '' check (char_length(referencia) <= 120),
  observacion            text not null default '' check (char_length(observacion) <= 500),

  estado                 text not null default 'por_confirmar'
                         check (estado in ('por_confirmar', 'confirmada', 'rechazada')),

  registrada_por         uuid not null references public.usuarios (id),
  registrada_por_nombre  text not null,
  registrada_en          timestamptz not null default now(),

  resuelta_por           uuid references public.usuarios (id),
  resuelta_por_nombre    text,
  resuelta_en            timestamptz,
  motivo_rechazo         text,

  clave_idempotencia     text not null check (btrim(clave_idempotencia) <> ''),
  huella                 text not null,

  constraint liquidaciones_origen_de_la_empresa
    foreign key (origen_id, empresa_id) references public.ubicaciones (id, empresa_id),
  constraint liquidaciones_destino_de_la_empresa
    foreign key (destino_id, empresa_id) references public.ubicaciones (id, empresa_id),
  constraint liquidaciones_entre_ubicaciones_distintas check (origen_id <> destino_id),
  constraint liquidaciones_numero_unico unique (empresa_id, numero),
  constraint liquidaciones_correlativo_unico unique (empresa_id, correlativo),
  constraint liquidaciones_clave_unica unique (empresa_id, clave_idempotencia),
  constraint liquidaciones_resolucion_completa check (
    (estado = 'por_confirmar') = (resuelta_en is null)
    and (resuelta_en is null) = (resuelta_por_nombre is null)
  ),
  constraint liquidaciones_rechazo_con_motivo check (
    (estado = 'rechazada') = (motivo_rechazo is not null)
  )
);

create unique index if not exists liquidaciones_id_empresa on public.liquidaciones_ubicacion (id, empresa_id);
create index if not exists idx_liquidaciones_par on public.liquidaciones_ubicacion (empresa_id, origen_id, destino_id, estado);

/*
  De qué pedidos sale cada liquidación: el monto se reparte entre los pedidos del
  par con efectivo pendiente, del más antiguo al más reciente.
*/
create table if not exists public.liquidacion_detalle (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas (id),
  liquidacion_id  uuid not null,
  pedido_id       uuid not null,
  monto           numeric(12,2) not null check (monto > 0),

  constraint liquidacion_detalle_de_la_liquidacion foreign key (liquidacion_id, empresa_id)
    references public.liquidaciones_ubicacion (id, empresa_id),
  constraint liquidacion_detalle_del_pedido foreign key (pedido_id, empresa_id)
    references public.pedidos_ubicacion (id, empresa_id),
  constraint liquidacion_detalle_un_renglon_por_pedido unique (liquidacion_id, pedido_id)
);

create index if not exists idx_liquidacion_detalle_pedido on public.liquidacion_detalle (pedido_id);

-- ─────────────────────────────────────────────────────────
-- SOLO SE ESCRIBE DESDE LAS FUNCIONES
-- ─────────────────────────────────────────────────────────
revoke all on public.liquidaciones_ubicacion, public.liquidacion_detalle from public, anon, authenticated;
grant select on public.liquidaciones_ubicacion, public.liquidacion_detalle to authenticated;
grant all on public.liquidaciones_ubicacion, public.liquidacion_detalle to service_role;

/*
  Una liquidación solo pasa de por confirmar a confirmada o rechazada, y al
  hacerlo solo se llenan quién la resolvió, cuándo y, si la rechazó, por qué.
  Nada de lo registrado se reescribe ni se borra.
*/
create or replace function public.liquidacion_solo_se_resuelve()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_resolucion text[] := array['estado', 'resuelta_por', 'resuelta_por_nombre', 'resuelta_en', 'motivo_rechazo'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una liquidación no se borra' using errcode = '42501';
  end if;

  if not (old.estado = 'por_confirmar' and new.estado in ('confirmada', 'rechazada')) then
    raise exception 'Una liquidación por confirmar solo puede confirmarse o rechazarse' using errcode = '42501';
  end if;

  if (to_jsonb(new) - v_resolucion) <> (to_jsonb(old) - v_resolucion) then
    raise exception 'Los datos de una liquidación registrada no se modifican' using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function public.liquidacion_solo_se_resuelve() from public, anon, authenticated;

drop trigger if exists liquidaciones_solo_se_resuelven on public.liquidaciones_ubicacion;
create trigger liquidaciones_solo_se_resuelven
  before update or delete on public.liquidaciones_ubicacion
  for each row execute function public.liquidacion_solo_se_resuelve();

do $$
declare
  v_tabla text;
begin
  drop trigger if exists liquidacion_detalle_inmutable on public.liquidacion_detalle;
  create trigger liquidacion_detalle_inmutable before update or delete on public.liquidacion_detalle
    for each row execute function public.registro_de_pedido_inmutable();

  foreach v_tabla in array array['liquidaciones_ubicacion', 'liquidacion_detalle']
  loop
    execute format('drop trigger if exists %1$s_sin_vaciar on public.%1$I', v_tabla);
    execute format(
      'create trigger %1$s_sin_vaciar before truncate on public.%1$I
         for each statement execute function public.registro_de_pedido_inmutable()',
      v_tabla
    );

    -- El contador no escribe en ninguna tabla (0036).
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
-- QUIÉN VE Y QUIÉN OPERA
-- ─────────────────────────────────────────────────────────
/*
  Ve las liquidaciones de un par quien tiene permiso de consultarlas u operarlas
  y trabaja en una de las dos ubicaciones; el administrador, las de su empresa;
  el contador con permiso de consultar, todas, sin escribir nada.
*/
create or replace function public.liquidacion_visible(p_empresa uuid, p_origen uuid, p_destino uuid)
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
      or (
        (public.usuario_tiene_permiso('settlements-view') or public.usuario_tiene_permiso('settlements-manage'))
        and (public.usuario_es_contador() or public.ubicacion_del_usuario() in (p_origen, p_destino))
      )
    ),
    false
  )
$$;

/*
  Opera (registra, confirma o rechaza) quien tiene el permiso de operar y
  trabaja en la ubicación que le toca a ese paso; el administrador, en cualquiera.
  El contador nunca.
*/
create or replace function public.usuario_opera_liquidacion(p_ubicacion uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    not public.usuario_es_contador()
    and public.usuario_tiene_permiso('settlements-manage')
    and (public.usuario_es_admin() or public.ubicacion_del_usuario() = p_ubicacion),
    false
  )
$$;

revoke execute on function
  public.liquidacion_visible(uuid, uuid, uuid),
  public.usuario_opera_liquidacion(uuid)
from public, anon;

grant execute on function
  public.liquidacion_visible(uuid, uuid, uuid),
  public.usuario_opera_liquidacion(uuid)
to authenticated;

alter table public.liquidaciones_ubicacion enable row level security;
alter table public.liquidacion_detalle enable row level security;

drop policy if exists liquidaciones_lectura on public.liquidaciones_ubicacion;
create policy liquidaciones_lectura on public.liquidaciones_ubicacion
  for select
  to authenticated
  using (public.liquidacion_visible(empresa_id, origen_id, destino_id));

drop policy if exists liquidacion_detalle_lectura on public.liquidacion_detalle;
create policy liquidacion_detalle_lectura on public.liquidacion_detalle
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and exists (select 1 from public.liquidaciones_ubicacion l where l.id = liquidacion_detalle.liquidacion_id)
  );

-- ─────────────────────────────────────────────────────────
-- CUÁNTO HAY POR LIQUIDAR, POR PEDIDO
-- ─────────────────────────────────────────────────────────
/*
  Por cada pedido de la empresa: lo cobrado en efectivo por la ubicación que
  entregó (lo único que se liquida), lo electrónico (en la cuenta de la empresa),
  lo entregado por confirmar, lo confirmado y lo que falta. Pieza interna: no
  revisa permisos; la usan las funciones de abajo, que sí.
*/
create or replace function public.saldos_de_pedidos(p_empresa uuid)
returns table (
  pedido_id     uuid,
  numero        text,
  estado        text,
  origen_id     uuid,
  destino_id    uuid,
  cliente       text,
  forma_pago    text,
  entregado_en  timestamptz,
  venta_id      uuid,
  efectivo      numeric,
  electronico   numeric,
  cargo         numeric,
  por_confirmar numeric,
  liquidado     numeric,
  pendiente     numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.numero, p.estado, p.origen_id, p.destino_id, p.nombre_cliente, p.forma_pago, p.entregado_en, p.venta_id,
         c.efectivo, c.electronico, c.cargo,
         coalesce(l.por_confirmar, 0), coalesce(l.liquidado, 0),
         c.efectivo - coalesce(l.por_confirmar, 0) - coalesce(l.liquidado, 0)
    from public.pedidos_ubicacion p
    cross join lateral (
      select coalesce(sum(cm.monto) filter (where cm.medio = 'efectivo'), 0) as efectivo,
             coalesce(sum(cm.monto) filter (where cm.medio <> 'efectivo'), 0) as electronico,
             coalesce(sum(cm.cargo), 0) as cargo
        from public.cobros_por_medio cm
       where cm.pedido_id = p.id
    ) c
    left join lateral (
      select sum(d.monto) filter (where q.estado = 'por_confirmar') as por_confirmar,
             sum(d.monto) filter (where q.estado = 'confirmada') as liquidado
        from public.liquidacion_detalle d
        join public.liquidaciones_ubicacion q on q.id = d.liquidacion_id
       where d.pedido_id = p.id
    ) l on true
   where p.empresa_id = p_empresa
$$;

revoke execute on function public.saldos_de_pedidos(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- REGISTRAR LA ENTREGA
-- ─────────────────────────────────────────────────────────
/*
  Quien entrega el efectivo (la ubicación que lo cobró) registra la entrega.
  Queda por confirmar hasta que la ubicación beneficiaria la confirme.

  `p_pedido`: si se indica, la liquidación sale solo de ese pedido; si no, se
  reparte entre los pedidos del par con efectivo pendiente, del más antiguo al
  más reciente. Nunca se liquida más de lo disponible (LQ002).

  La clave es obligatoria: un reintento con la misma clave y los mismos datos
  devuelve la misma liquidación; con otros datos, LQ003. Dos registros a la vez
  del mismo par se ponen en fila, así que no pueden pasarse del saldo.
*/
create or replace function public.registrar_liquidacion(
  p_origen             uuid,
  p_destino            uuid,
  p_monto              numeric,
  p_metodo             text,
  p_fecha_efectiva     date default null,
  p_referencia         text default '',
  p_observacion        text default '',
  p_pedido             uuid default null,
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
  v_monto       numeric(12,2);
  v_fecha       date := coalesce(p_fecha_efectiva, (now() at time zone 'America/Tegucigalpa')::date);
  v_huella      text;
  v_previa      liquidaciones_ubicacion;
  v_disponible  numeric(12,2);
  v_resto       numeric(12,2);
  v_toma        numeric(12,2);
  v_saldo       record;
  v_correlativo bigint;
  v_id          uuid := gen_random_uuid();
begin
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid() and u.activo and not u.debe_cambiar_contrasena
   limit 1;

  if v_usuario.id is null or not usuario_opera_liquidacion(p_origen) then
    raise exception 'No tienes permiso para registrar liquidaciones de esta ubicación'
      using errcode = '42501';
  end if;

  v_empresa := v_usuario.empresa_id;

  if p_clave_idempotencia is null or btrim(p_clave_idempotencia) = '' then
    raise exception 'Falta la clave de la liquidación' using errcode = 'LQ001';
  end if;

  if p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) or p_monto >= 10000000000 then
    raise exception 'El monto debe ser mayor que cero y tener hasta dos decimales' using errcode = 'LQ001';
  end if;

  v_monto := p_monto;

  if coalesce(p_metodo, '') not in ('entrega_en_efectivo', 'deposito_a_cuenta') then
    raise exception 'Método de liquidación desconocido: %', p_metodo using errcode = 'LQ001';
  end if;

  if v_fecha > (now() at time zone 'America/Tegucigalpa')::date then
    raise exception 'La fecha efectiva no puede ser futura' using errcode = 'LQ001';
  end if;

  if char_length(btrim(coalesce(p_referencia, ''))) > 120 or char_length(btrim(coalesce(p_observacion, ''))) > 500 then
    raise exception 'La referencia o la observación son demasiado largas' using errcode = 'LQ001';
  end if;

  if p_origen is null or p_destino is null or p_origen = p_destino
     or (select count(*) from ubicaciones u where u.id in (p_origen, p_destino) and u.empresa_id = v_empresa) <> 2 then
    raise exception 'Las ubicaciones de la liquidación no son válidas' using errcode = 'LQ001';
  end if;

  -- Todo lo del mismo par, en fila: el saldo no se puede gastar dos veces.
  perform pg_advisory_xact_lock(hashtextextended('liquidacion|' || v_empresa::text || '|' || p_origen::text || '|' || p_destino::text, 0));

  v_huella := concat_ws('|', p_origen, p_destino, v_monto, p_metodo, v_fecha, coalesce(p_pedido::text, '-'),
                        btrim(coalesce(p_referencia, '')), btrim(coalesce(p_observacion, '')));

  select l.* into v_previa
    from liquidaciones_ubicacion l
   where l.empresa_id = v_empresa and l.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_previa.huella <> v_huella then
      raise exception 'La clave % ya se usó para otra liquidación', p_clave_idempotencia using errcode = 'LQ003';
    end if;

    return to_jsonb(v_previa) - 'huella' - 'clave_idempotencia' || jsonb_build_object('repetida', true);
  end if;

  select coalesce(sum(s.pendiente), 0) into v_disponible
    from saldos_de_pedidos(v_empresa) s
   where s.origen_id = p_origen and s.destino_id = p_destino
     and (p_pedido is null or s.pedido_id = p_pedido);

  if v_monto > v_disponible then
    raise exception 'El monto (%) supera lo pendiente por liquidar (%)',
      to_char(v_monto, 'FM999999990.00'), to_char(v_disponible, 'FM999999990.00')
      using errcode = 'LQ002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('liquidacion-correlativo|' || v_empresa::text, 0));

  select coalesce(max(l.correlativo), 0) + 1 into v_correlativo
    from liquidaciones_ubicacion l where l.empresa_id = v_empresa;

  insert into liquidaciones_ubicacion (
    id, empresa_id, numero, correlativo, origen_id, destino_id,
    monto, metodo, fecha_efectiva, referencia, observacion,
    registrada_por, registrada_por_nombre, clave_idempotencia, huella
  ) values (
    v_id, v_empresa, 'LIQ-' || lpad(v_correlativo::text, 6, '0'), v_correlativo, p_origen, p_destino,
    v_monto, p_metodo, v_fecha, btrim(coalesce(p_referencia, '')), btrim(coalesce(p_observacion, '')),
    v_usuario.id, v_usuario.nombre, p_clave_idempotencia, v_huella
  );

  -- El reparto: del pedido más antiguo al más reciente.
  v_resto := v_monto;

  for v_saldo in
    select s.pedido_id, s.pendiente
      from saldos_de_pedidos(v_empresa) s
     where s.origen_id = p_origen and s.destino_id = p_destino
       and (p_pedido is null or s.pedido_id = p_pedido)
       and s.pendiente > 0
     order by s.entregado_en, s.numero
  loop
    exit when v_resto <= 0;

    v_toma := least(v_resto, v_saldo.pendiente);

    insert into liquidacion_detalle (empresa_id, liquidacion_id, pedido_id, monto)
    values (v_empresa, v_id, v_saldo.pedido_id, v_toma);

    v_resto := v_resto - v_toma;
  end loop;

  return (select to_jsonb(l) - 'huella' - 'clave_idempotencia' from liquidaciones_ubicacion l where l.id = v_id)
         || jsonb_build_object('repetida', false);
end $$;

-- ─────────────────────────────────────────────────────────
-- CONFIRMAR O RECHAZAR LA RECEPCIÓN
-- ─────────────────────────────────────────────────────────
/*
  Lo hace la ubicación beneficiaria (o el administrador). Confirmar dos veces
  devuelve la misma confirmación; rechazar exige un motivo y devuelve el monto
  a lo pendiente por liquidar.
*/
create or replace function public.resolver_liquidacion(p_liquidacion uuid, p_confirmar boolean, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario  usuarios;
  v_liq      liquidaciones_ubicacion;
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_estado   text := case when p_confirmar then 'confirmada' else 'rechazada' end;
begin
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid() and u.activo and not u.debe_cambiar_contrasena
   limit 1;

  select l.* into v_liq
    from liquidaciones_ubicacion l
   where l.id = p_liquidacion and l.empresa_id = v_usuario.empresa_id
     for update;

  if v_usuario.id is null or v_liq.id is null or not usuario_opera_liquidacion(v_liq.destino_id) then
    raise exception 'No tienes permiso para resolver esta liquidación' using errcode = '42501';
  end if;

  if v_liq.estado = v_estado then
    return to_jsonb(v_liq) - 'huella' - 'clave_idempotencia' || jsonb_build_object('repetida', true);
  end if;

  if v_liq.estado <> 'por_confirmar' then
    raise exception 'La liquidación % ya está %', v_liq.numero, v_liq.estado using errcode = 'LQ004';
  end if;

  if not p_confirmar and char_length(v_motivo) < 5 then
    raise exception 'Escribe por qué se rechaza (al menos 5 caracteres)' using errcode = 'LQ001';
  end if;

  update liquidaciones_ubicacion
     set estado = v_estado,
         resuelta_por = v_usuario.id,
         resuelta_por_nombre = v_usuario.nombre,
         resuelta_en = now(),
         motivo_rechazo = case when p_confirmar then null else left(v_motivo, 500) end
   where id = v_liq.id
  returning * into v_liq;

  return to_jsonb(v_liq) - 'huella' - 'clave_idempotencia' || jsonb_build_object('repetida', false);
end $$;

revoke execute on function
  public.registrar_liquidacion(uuid, uuid, numeric, text, date, text, text, uuid, text),
  public.resolver_liquidacion(uuid, boolean, text)
from public, anon;

grant execute on function
  public.registrar_liquidacion(uuid, uuid, numeric, text, date, text, text, uuid, text),
  public.resolver_liquidacion(uuid, boolean, text)
to authenticated;

-- ─────────────────────────────────────────────────────────
-- LA PANTALLA DE LIQUIDACIONES
-- ─────────────────────────────────────────────────────────
/*
  Los saldos por par y por pedido, y las liquidaciones, solo de lo que el
  usuario puede ver. Sin costos ni datos del cliente más allá del nombre.
*/
create or replace function public.control_de_liquidaciones(p_origen uuid default null, p_destino uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := public.empresa_del_usuario();
begin
  if v_empresa is null
     or not (public.usuario_es_admin() or public.usuario_tiene_permiso('settlements-view') or public.usuario_tiene_permiso('settlements-manage')) then
    raise exception 'No tienes permiso para consultar liquidaciones' using errcode = '42501';
  end if;

  return (
    with
    pedidos as (
      select s.*, o.nombre as origen, d.nombre as destino, v.numero_factura,
             case
               when s.efectivo = 0 then 'sin_efectivo'
               when s.pendiente = 0 and s.por_confirmar = 0 then 'liquidado'
               when s.por_confirmar > 0 then 'por_confirmar'
               when s.liquidado > 0 then 'parcial'
               else 'pendiente'
             end as estado_liquidacion
        from public.saldos_de_pedidos(v_empresa) s
        join public.ubicaciones o on o.id = s.origen_id
        join public.ubicaciones d on d.id = s.destino_id
        left join public.ventas v on v.id = s.venta_id
       where public.liquidacion_visible(v_empresa, s.origen_id, s.destino_id)
         and (p_origen is null or s.origen_id = p_origen)
         and (p_destino is null or s.destino_id = p_destino)
         and s.efectivo + s.electronico > 0
    ),
    liquidaciones as (
      select l.*, o.nombre as origen, d.nombre as destino
        from public.liquidaciones_ubicacion l
        join public.ubicaciones o on o.id = l.origen_id
        join public.ubicaciones d on d.id = l.destino_id
       where l.empresa_id = v_empresa
         and public.liquidacion_visible(v_empresa, l.origen_id, l.destino_id)
         and (p_origen is null or l.origen_id = p_origen)
         and (p_destino is null or l.destino_id = p_destino)
    )
    select jsonb_build_object(
      'pares', coalesce((
        select jsonb_agg(x order by x.origen, x.destino)
          from (
            select origen_id, origen, destino_id, destino,
                   sum(efectivo) as efectivo, sum(electronico) as electronico, sum(cargo) as cargo,
                   sum(por_confirmar) as por_confirmar, sum(liquidado) as liquidado, sum(pendiente) as pendiente,
                   public.usuario_opera_liquidacion(origen_id) as puede_registrar
              from pedidos
             group by origen_id, origen, destino_id, destino
          ) x
      ), '[]'::jsonb),
      'pedidos', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'pedido_id', p.pedido_id, 'numero', p.numero, 'estado', p.estado,
                   'origen_id', p.origen_id, 'origen', p.origen, 'destino_id', p.destino_id, 'destino', p.destino,
                   'cliente', p.cliente, 'forma_pago', p.forma_pago, 'entregado_en', p.entregado_en,
                   'numero_factura', p.numero_factura,
                   'efectivo', p.efectivo, 'electronico', p.electronico, 'cargo', p.cargo,
                   'por_confirmar', p.por_confirmar, 'liquidado', p.liquidado, 'pendiente', p.pendiente,
                   'estado_liquidacion', p.estado_liquidacion,
                   'medios', coalesce((
                     select jsonb_agg(jsonb_build_object('medio', c.medio, 'monto', c.monto, 'cargo', c.cargo, 'fecha', c.fecha) order by c.medio)
                       from public.cobros_por_medio c where c.pedido_id = p.pedido_id
                   ), '[]'::jsonb)
                 )
                 order by p.entregado_en desc, p.numero desc
               )
          from pedidos p
      ), '[]'::jsonb),
      'liquidaciones', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', l.id, 'numero', l.numero, 'estado', l.estado,
                   'origen_id', l.origen_id, 'origen', l.origen, 'destino_id', l.destino_id, 'destino', l.destino,
                   'monto', l.monto, 'metodo', l.metodo, 'fecha_efectiva', l.fecha_efectiva,
                   'referencia', l.referencia, 'observacion', l.observacion,
                   'registrada_por', l.registrada_por_nombre, 'registrada_en', l.registrada_en,
                   'resuelta_por', l.resuelta_por_nombre, 'resuelta_en', l.resuelta_en, 'motivo_rechazo', l.motivo_rechazo,
                   'puede_resolver', l.estado = 'por_confirmar' and public.usuario_opera_liquidacion(l.destino_id),
                   'pedidos', coalesce((
                     select jsonb_agg(jsonb_build_object('numero', q.numero, 'monto', d.monto) order by q.numero)
                       from public.liquidacion_detalle d join public.pedidos_ubicacion q on q.id = d.pedido_id
                      where d.liquidacion_id = l.id
                   ), '[]'::jsonb)
                 )
                 order by l.registrada_en desc, l.correlativo desc
               )
          from liquidaciones l
      ), '[]'::jsonb)
    )
  );
end $$;

revoke execute on function public.control_de_liquidaciones(uuid, uuid) from public, anon;
grant execute on function public.control_de_liquidaciones(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────
-- LA CAJA POR UBICACIÓN
-- ─────────────────────────────────────────────────────────
/*
  Lo que es de pedidos en un día y una ubicación (null = todas), de la empresa
  de quien consulta. Pieza de los dos reportes de caja: solo administradores,
  como ellos.

  - cobros: el dinero que recibió la ubicación que entregó, por la fecha y con
    el medio del cobro (contado y primas).
  - facturas: el contado de las facturas de pedido, que quien factura no cobró.
  - primas: los abonos que son la prima de un pedido, ya incluidos en los cobros.
  - liquidaciones: las de ese día (por su fecha efectiva) en que la ubicación
    entrega o recibe.
  - saldos: lo que hay por liquidar, por confirmar y liquidado entre cada par,
    al momento de consultar.
*/
create or replace function public.caja_de_pedidos_del_dia(p_desde timestamptz, p_hasta timestamptz, p_ubicacion uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p_empresa uuid := public.empresa_del_usuario();
begin
  if p_empresa is null or not coalesce(public.usuario_es_admin(), false) then
    raise exception 'La caja por ubicación es solo para administradores' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'cobros', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', c.id, 'fecha', c.fecha, 'ubicacion_id', c.ubicacion_id, 'ubicacion', u.nombre,
                 'usuario_id', c.usuario_id, 'medio', c.medio, 'monto', c.monto, 'cargo', c.cargo, 'tasa', c.tasa_cargo,
                 'referencia', c.referencia, 'pedido_id', p.id, 'pedido', p.numero, 'forma_pago', p.forma_pago,
                 'destino', d.nombre, 'cliente', p.nombre_cliente, 'factura', v.numero_factura
               )
               order by c.fecha, c.id
             )
        from public.cobros_por_medio c
        join public.pedidos_ubicacion p on p.id = c.pedido_id
        join public.ubicaciones d on d.id = p.destino_id
        left join public.ubicaciones u on u.id = c.ubicacion_id
        left join public.ventas v on v.id = p.venta_id
       where c.empresa_id = p_empresa
         and c.fecha >= p_desde and c.fecha < p_hasta
         and (p_ubicacion is null or c.ubicacion_id = p_ubicacion)
    ), '[]'::jsonb),
    'facturas', coalesce((
      select jsonb_agg(jsonb_build_object('venta_id', v.id, 'ubicacion_id', v.ubicacion_id, 'total', v.total, 'cargo', v.cargo_por_medio,
                                          'pedido', p.numero, 'cobrado_en', o.nombre))
        from public.ventas v
        join public.pedidos_ubicacion p on p.id = v.pedido_id
        join public.ubicaciones o on o.id = p.origen_id
       where v.empresa_id = p_empresa
         and v.estado <> 'anulada' and v.forma_pago = 'contado'
         and v.fecha >= p_desde and v.fecha < p_hasta
         and (p_ubicacion is null or v.ubicacion_id = p_ubicacion)
    ), '[]'::jsonb),
    'primas', coalesce((
      select jsonb_agg(jsonb_build_object('abono_id', a.id, 'pago_id', g.id, 'ubicacion_id', g.ubicacion_id, 'usuario_id', a.usuario_id,
                                          'monto', a.monto, 'cargo', g.cargo_por_medio, 'pedido_id', g.pedido_id))
        from public.abonos a
        join public.pagos g on g.id = a.pago_id
       where a.empresa_id = p_empresa
         and g.pedido_id is not null and g.estado = 'aplicado'
         and a.fecha >= p_desde and a.fecha < p_hasta
         and (p_ubicacion is null or g.ubicacion_id = p_ubicacion)
    ), '[]'::jsonb),
    'liquidaciones', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', l.id, 'numero', l.numero, 'fecha_efectiva', l.fecha_efectiva, 'estado', l.estado,
                 'origen', o.nombre, 'destino', d.nombre, 'monto', l.monto, 'metodo', l.metodo, 'referencia', l.referencia,
                 'registrada_por', l.registrada_por_nombre, 'resuelta_por', l.resuelta_por_nombre
               )
               order by l.correlativo
             )
        from public.liquidaciones_ubicacion l
        join public.ubicaciones o on o.id = l.origen_id
        join public.ubicaciones d on d.id = l.destino_id
       where l.empresa_id = p_empresa
         and l.fecha_efectiva = (p_desde at time zone 'America/Tegucigalpa')::date
         and (p_ubicacion is null or p_ubicacion in (l.origen_id, l.destino_id))
    ), '[]'::jsonb),
    'saldos', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.origen, x.destino)
        from (
          select s.origen_id, o.nombre as origen, s.destino_id, d.nombre as destino,
                 sum(s.efectivo) as efectivo, sum(s.por_confirmar) as por_confirmar,
                 sum(s.liquidado) as liquidado, sum(s.pendiente) as pendiente
            from public.saldos_de_pedidos(p_empresa) s
            join public.ubicaciones o on o.id = s.origen_id
            join public.ubicaciones d on d.id = s.destino_id
           where s.efectivo > 0
             and (p_ubicacion is null or p_ubicacion in (s.origen_id, s.destino_id))
           group by s.origen_id, o.nombre, s.destino_id, d.nombre
        ) x
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.caja_de_pedidos_del_dia(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.caja_de_pedidos_del_dia(timestamptz, timestamptz, uuid) to authenticated;

-- Suma de un campo de una lista jsonb, opcionalmente solo de una ubicación.
create or replace function public.sumar_de(p_lista jsonb, p_campo text, p_ubicacion text default null)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((e->>p_campo)::numeric), 0)
    from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) e
   where p_ubicacion is null or (e->>'ubicacion_id') is not distinct from p_ubicacion
$$;

revoke execute on function public.sumar_de(jsonb, text, text) from public, anon;
grant execute on function public.sumar_de(jsonb, text, text) to authenticated;

/*
  reporte_diario() con la caja corregida para pedidos. Las ventas siguen siendo de
  quien factura; los cobros, de quien recibió el dinero. Solo administradores
  (lo exige reporte_diario()).
*/
create or replace function public.reporte_diario_de_caja(p_dia date default null, p_ubicacion uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base    jsonb := public.reporte_diario(p_dia, p_ubicacion);
  v_dia     date := (v_base->>'dia')::date;
  v_caja    jsonb;
  v_cobros  jsonb;
  v_fact    jsonb;
  v_primas  jsonb;
  v_i       jsonb := v_base->'indicadores';
  v_cobrado numeric;
begin
  v_caja := public.caja_de_pedidos_del_dia(
    v_dia::timestamp at time zone 'America/Tegucigalpa',
    (v_dia + 1)::timestamp at time zone 'America/Tegucigalpa',
    p_ubicacion);

  v_cobros := v_caja->'cobros';
  v_fact   := v_caja->'facturas';
  v_primas := v_caja->'primas';
  v_cobrado := public.sumar_de(v_cobros, 'monto');

  v_i := v_i || jsonb_build_object(
    'abonos_total', (v_i->>'abonos_total')::numeric - public.sumar_de(v_primas, 'monto'),
    'abonos_cantidad', (v_i->>'abonos_cantidad')::int - jsonb_array_length(v_primas),
    'cobros_total', (v_i->>'cobros_total')::numeric - public.sumar_de(v_fact, 'total') - public.sumar_de(v_primas, 'monto') + v_cobrado,
    'cargos_total', (v_i->>'cargos_total')::numeric - public.sumar_de(v_fact, 'cargo') - public.sumar_de(v_primas, 'cargo') + public.sumar_de(v_cobros, 'cargo'),
    'total_cobrado', (v_i->>'total_cobrado')::numeric
                     - public.sumar_de(v_fact, 'total') - public.sumar_de(v_fact, 'cargo')
                     - public.sumar_de(v_primas, 'monto') - public.sumar_de(v_primas, 'cargo')
                     + v_cobrado + public.sumar_de(v_cobros, 'cargo'),
    'cobros_por_cuenta_de_otras', v_cobrado,
    'cobros_por_cuenta_de_otras_cantidad', jsonb_array_length(v_cobros)
  );

  return v_base || jsonb_build_object(
    'indicadores', v_i,
    'por_ubicacion', coalesce((
      select jsonb_agg(
               u.fila || jsonb_build_object(
                 'abonos_total', (u.fila->>'abonos_total')::numeric - public.sumar_de(v_primas, 'monto', u.fila->>'ubicacion_id'),
                 'cobros_total', (u.fila->>'cobros_total')::numeric
                                 - public.sumar_de(v_fact, 'total', u.fila->>'ubicacion_id')
                                 - public.sumar_de(v_primas, 'monto', u.fila->>'ubicacion_id')
                                 + public.sumar_de(v_cobros, 'monto', u.fila->>'ubicacion_id'),
                 'cobros_por_cuenta_de_otras', public.sumar_de(v_cobros, 'monto', u.fila->>'ubicacion_id')
               )
               order by u.n
             )
        from jsonb_array_elements(v_base->'por_ubicacion') with ordinality u(fila, n)
    ), '[]'::jsonb),
    'por_vendedor', coalesce((
      select jsonb_agg(
               v.fila || jsonb_build_object(
                 'abonos_total', (v.fila->>'abonos_total')::numeric
                                 - coalesce((select sum((p->>'monto')::numeric) from jsonb_array_elements(v_primas) p
                                              where (p->>'usuario_id') is not distinct from (v.fila->>'usuario_id')), 0)
               )
               order by v.n
             )
        from jsonb_array_elements(v_base->'por_vendedor') with ordinality v(fila, n)
    ), '[]'::jsonb),
    'abonos', coalesce((
      select jsonb_agg(a.fila order by a.n)
        from jsonb_array_elements(v_base->'abonos') with ordinality a(fila, n)
       where not exists (select 1 from jsonb_array_elements(v_primas) p where p->>'abono_id' = a.fila->>'id')
    ), '[]'::jsonb),
    'ventas', coalesce((
      select jsonb_agg(
               s.fila || coalesce((
                 select jsonb_build_object('pedido', f->>'pedido', 'cobrado_en', f->>'cobrado_en')
                   from jsonb_array_elements(v_fact) f where f->>'venta_id' = s.fila->>'id'
               ), '{}'::jsonb)
               order by s.n
             )
        from jsonb_array_elements(v_base->'ventas') with ordinality s(fila, n)
    ), '[]'::jsonb),
    'cobros_de_pedidos', v_cobros,
    'liquidaciones_del_dia', v_caja->'liquidaciones',
    'saldos_por_liquidar', v_caja->'saldos'
  );
end $$;

/*
  reporte_medios_de_pago() con los cobros de pedidos en su ubicación, su fecha y
  su medio real. El contado de las facturas de pedido y las primas dejan de
  figurar como «sin registrar». Solo administradores (lo exige el reporte base).
*/
create or replace function public.reporte_medios_de_caja(p_dia date default null, p_ubicacion uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base   jsonb := public.reporte_medios_de_pago(p_dia, p_ubicacion);
  v_dia    date := coalesce(p_dia, (now() at time zone 'America/Tegucigalpa')::date);
  v_caja   jsonb;
  v_cobros jsonb;
  v_quitar jsonb;
  v_t      jsonb := v_base->'totales';
  v_monto  numeric;
  v_cargo  numeric;
  v_menos  numeric;
begin
  v_caja := public.caja_de_pedidos_del_dia(
    v_dia::timestamp at time zone 'America/Tegucigalpa',
    (v_dia + 1)::timestamp at time zone 'America/Tegucigalpa',
    p_ubicacion);

  v_cobros := v_caja->'cobros';

  -- Lo que el reporte base contaba «sin registrar» y es de pedidos: facturas de contado y primas.
  v_quitar := coalesce((
    select jsonb_agg(jsonb_build_object('ubicacion_id', f->>'ubicacion_id', 'monto', (f->>'total')::numeric))
      from jsonb_array_elements(v_caja->'facturas') f
     where not exists (select 1 from public.cobros_por_medio c where c.venta_id = (f->>'venta_id')::uuid)
  ), '[]'::jsonb) || coalesce((
    select jsonb_agg(jsonb_build_object('ubicacion_id', p->>'ubicacion_id', 'monto', (p->>'monto')::numeric))
      from jsonb_array_elements(v_caja->'primas') p
     where not exists (select 1 from public.cobros_por_medio c where c.pago_id = (p->>'pago_id')::uuid)
  ), '[]'::jsonb);

  v_monto := public.sumar_de(v_cobros, 'monto');
  v_cargo := public.sumar_de(v_cobros, 'cargo');
  v_menos := public.sumar_de(v_quitar, 'monto');

  v_t := v_t || jsonb_build_object(
    'total', (v_t->>'total')::numeric - v_menos + v_monto,
    'registrado', (v_t->>'registrado')::numeric + v_monto,
    'sin_registrar', (v_t->>'sin_registrar')::numeric - v_menos,
    'cargos', (v_t->>'cargos')::numeric + v_cargo,
    'total_cobrado', (v_t->>'total_cobrado')::numeric - v_menos + v_monto + v_cargo,
    'por_cuenta_de_otras', v_monto
  );

  return v_base || jsonb_build_object(
    'totales', v_t,

    'por_medio', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.orden)
        from (
          select medio, sum(operaciones)::int as operaciones, sum(monto) as monto, sum(cargo) as cargo,
                 sum(monto) + sum(cargo) as total_cobrado,
                 array_position(array['efectivo', 'transferencia', 'tarjeta', 'enlace', 'sin_registrar'], medio) as orden
            from (
              select m->>'medio' as medio, (m->>'operaciones')::numeric as operaciones, (m->>'monto')::numeric as monto, (m->>'cargo')::numeric as cargo
                from jsonb_array_elements(v_base->'por_medio') m
              union all
              select 'sin_registrar', -1, -(q->>'monto')::numeric, 0 from jsonb_array_elements(v_quitar) q
              union all
              select c->>'medio', 1, (c->>'monto')::numeric, (c->>'cargo')::numeric from jsonb_array_elements(v_cobros) c
            ) todo
           group by medio
          having sum(operaciones) > 0 or sum(monto) <> 0
        ) x
    ), '[]'::jsonb),

    'por_ubicacion', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.total desc, x.ubicacion)
        from (
          select t.ubicacion_id, coalesce(u.nombre, 'Sin ubicación') as ubicacion,
                 sum(t.efectivo) as efectivo, sum(t.transferencia) as transferencia, sum(t.tarjeta) as tarjeta,
                 sum(t.enlace) as enlace, sum(t.sin_registrar) as sin_registrar,
                 sum(t.efectivo + t.transferencia + t.tarjeta + t.enlace + t.sin_registrar) as total,
                 sum(t.cargo) as cargo, sum(t.por_cuenta_de_otras) as por_cuenta_de_otras
            from (
              select (b->>'ubicacion_id')::uuid as ubicacion_id, (b->>'efectivo')::numeric as efectivo, (b->>'transferencia')::numeric as transferencia,
                     (b->>'tarjeta')::numeric as tarjeta, (b->>'enlace')::numeric as enlace, (b->>'sin_registrar')::numeric as sin_registrar,
                     (b->>'cargo')::numeric as cargo, 0::numeric as por_cuenta_de_otras
                from jsonb_array_elements(v_base->'por_ubicacion') b
              union all
              select (q->>'ubicacion_id')::uuid, 0, 0, 0, 0, -(q->>'monto')::numeric, 0, 0 from jsonb_array_elements(v_quitar) q
              union all
              select (c->>'ubicacion_id')::uuid,
                     case when c->>'medio' = 'efectivo' then (c->>'monto')::numeric else 0 end,
                     case when c->>'medio' = 'transferencia' then (c->>'monto')::numeric else 0 end,
                     case when c->>'medio' = 'tarjeta' then (c->>'monto')::numeric else 0 end,
                     case when c->>'medio' = 'enlace' then (c->>'monto')::numeric else 0 end,
                     0, (c->>'cargo')::numeric, (c->>'monto')::numeric
                from jsonb_array_elements(v_cobros) c
            ) t
            left join public.ubicaciones u on u.id = t.ubicacion_id
           group by t.ubicacion_id, u.nombre
          having sum(t.efectivo + t.transferencia + t.tarjeta + t.enlace + t.sin_registrar) <> 0 or sum(t.cargo) <> 0
        ) x
    ), '[]'::jsonb),

    -- El medio de una factura de pedido es el de su cobro en origen; el de la prima, igual.
    'por_venta', (v_base->'por_venta') || coalesce((
      select jsonb_object_agg(f->>'venta_id', (
               select jsonb_agg(jsonb_build_object('medio', c.medio, 'monto', c.monto, 'cargo', c.cargo, 'tasa', c.tasa_cargo, 'referencia', c.referencia) order by c.medio)
                 from public.cobros_por_medio c
                 join public.ventas v on v.pedido_id = c.pedido_id
                where v.id = (f->>'venta_id')::uuid
             ))
        from jsonb_array_elements(v_caja->'facturas') f
       where exists (select 1 from public.ventas v join public.cobros_por_medio c on c.pedido_id = v.pedido_id where v.id = (f->>'venta_id')::uuid)
    ), '{}'::jsonb),

    'cobros_de_pedidos', v_cobros
  );
end $$;

revoke execute on function
  public.reporte_diario_de_caja(date, uuid),
  public.reporte_medios_de_caja(date, uuid)
from public, anon;

grant execute on function
  public.reporte_diario_de_caja(date, uuid),
  public.reporte_medios_de_caja(date, uuid)
to authenticated;
