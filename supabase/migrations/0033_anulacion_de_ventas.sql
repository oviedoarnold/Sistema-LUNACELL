-- Anulación de ventas (A-5).
--
-- Una venta registrada no se borra ni se renumera: se anula. Su número, su
-- fecha, su cliente, sus productos y su total se quedan como están; la
-- venta pasa a «anulada», la mercadería vuelve a la ubicación DESDE LA QUE
-- SE VENDIÓ y queda un registro inmutable de quién lo hizo, cuándo y por
-- qué.
--
-- Quién anula:
-- - el administrador, en cualquier ubicación de su empresa y sin plazo;
-- - el vendedor con «Historial» (sales-history) Y «Anular ventas»
--   (sales-void), solo en la ubicación que tiene asignada AHORA y solo el
--   mismo día de la venta, en hora de Honduras. Las ventas aplicadas por
--   conciliación las anula únicamente el administrador.
--
-- Qué no se anula aquí:
-- - facturas fiscales (CAI): su tratamiento —anulación o nota de crédito—
--   está pendiente del contador;
-- - ventas con abonos: revertir un pago repartido es otra funcionalidad;
-- - ventas antiguas sin ubicación o cuyo inventario no se puede
--   reconstruir con seguridad.
--
-- Lo que NO hace: no toca ningún dato existente, no da el permiso nuevo a
-- nadie, y no modifica registrar_venta_ubicacion(), registrar_pago_cliente(),
-- conciliar_venta(), los traslados, la sincronización sin conexión ni los
-- correlativos.

-- ─────────────────────────────────────────────────────────
-- EL PERMISO «ANULAR VENTAS»
-- ─────────────────────────────────────────────────────────
/*
  Aparte de sales-history a propósito. sales-history ya deja ver el
  historial y cobrar; anular una venta de contado ya cobrada es más
  delicado, y tiene que poder darse a un vendedor sin dárselo a todos los
  que cobran. Se suma a la lista con el mismo procedimiento que la 0015:
  quitar la restricción por lo que dice y no por su nombre, y volver a
  crearla. Las filas que ya existen se revisan al crearla y todas la cumplen.
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
    'sales-void'
  ));

-- ─────────────────────────────────────────────────────────
-- EL MOVIMIENTO QUE COMPENSA
-- ─────────────────────────────────────────────────────────
/*
  Un tipo propio y no «devolucion» ni «ajuste»: el Kardex tiene que decir
  que esas unidades volvieron porque la venta se anuló, no porque un
  cliente devolviera algo o porque alguien corrigiera un conteo.
*/
alter table public.movimientos_inventario
  drop constraint if exists movimientos_inventario_tipo_check;

alter table public.movimientos_inventario
  add constraint movimientos_inventario_tipo_check
  check (tipo in (
    'entrada', 'salida', 'ajuste', 'devolucion',
    'traslado_salida', 'traslado_entrada',
    'anulacion_venta'
  ));

/*
  Cada producto de una venta vuelve una sola vez. Aunque la función se
  escribiera mal o se llamara dos veces, la segunda devolución no entra.
*/
create unique index if not exists movimientos_anulacion_una_vez
  on public.movimientos_inventario (venta_id, producto_id)
  where tipo = 'anulacion_venta';

-- ─────────────────────────────────────────────────────────
-- EL REGISTRO DE LA ANULACIÓN
-- ─────────────────────────────────────────────────────────
/*
  Uno por venta (venta_id único): una venta no se anula dos veces.

  Nombre, rol y ubicación de quien anuló son copias del momento, no
  referencias que miren el presente: si mañana se le cambia el rol, se le
  reasigna o se le renombra, el registro sigue diciendo lo que pasó.

  El dinero va aparte y nunca se da por devuelto:
  - reembolso_pendiente: venta de contado, el dinero está por devolver;
  - no_cobrado: venta de contado registrada por error, no se cobró;
  - credito_sin_abonos: venta a crédito sin abonos, no entró dinero.
*/
create table if not exists public.anulaciones_venta (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas (id),
  venta_id            uuid not null unique references public.ventas (id),
  numero_documento    text not null,
  estado_anterior     text not null check (estado_anterior in ('pendiente', 'pagada')),
  forma_pago          text not null check (forma_pago in ('contado', 'credito')),
  total               numeric(12,2) not null,
  saldo_cancelado     numeric(12,2) not null default 0 check (saldo_cancelado >= 0),
  ubicacion_venta     uuid not null,
  usuario_id          uuid not null references public.usuarios (id),
  usuario_nombre      text not null,
  usuario_rol         text not null check (usuario_rol in ('admin', 'vendedor')),
  ubicacion_usuario   uuid,
  motivo              text not null check (char_length(btrim(motivo)) >= 10),
  tratamiento_dinero  text not null check (tratamiento_dinero in ('reembolso_pendiente', 'no_cobrado', 'credito_sin_abonos')),
  movimientos         jsonb not null default '[]'::jsonb,
  clave_idempotencia  text,
  anulada_en          timestamptz not null default now(),

  constraint anulaciones_venta_ubicacion_de_la_empresa
    foreign key (ubicacion_venta, empresa_id) references public.ubicaciones (id, empresa_id),

  constraint anulaciones_venta_dinero_segun_forma_de_pago
    check (
      (forma_pago = 'contado' and tratamiento_dinero in ('reembolso_pendiente', 'no_cobrado'))
      or (forma_pago = 'credito' and tratamiento_dinero = 'credito_sin_abonos')
    )
);

create unique index if not exists anulaciones_venta_clave
  on public.anulaciones_venta (empresa_id, clave_idempotencia)
  where clave_idempotencia is not null;

create index if not exists anulaciones_venta_empresa_fecha
  on public.anulaciones_venta (empresa_id, anulada_en desc);

/*
  Nadie lo cambia ni lo borra: ni quien anuló, ni un administrador, ni una
  función SECURITY DEFINER. Mismo trato que auditoria_rescates (0027), más
  TRUNCATE: un disparador de fila no lo detiene, y vaciar la tabla borraría
  todos los registros de una vez.
*/
create or replace function public.anulaciones_venta_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El registro de una anulación no se modifica ni se borra'
    using errcode = '42501';
end $$;

drop trigger if exists anulaciones_venta_inmutable on public.anulaciones_venta;
create trigger anulaciones_venta_inmutable
  before update or delete on public.anulaciones_venta
  for each row execute function public.anulaciones_venta_inmutable();

drop trigger if exists anulaciones_venta_sin_vaciar on public.anulaciones_venta;
create trigger anulaciones_venta_sin_vaciar
  before truncate on public.anulaciones_venta
  for each statement execute function public.anulaciones_venta_inmutable();

revoke execute on function public.anulaciones_venta_inmutable() from public, anon, authenticated;

/*
  Se lee con la misma regla que la venta: el administrador las ve todas;
  el vendedor, las de las ventas de su ubicación actual. La política de
  ventas ya decide eso, así que aquí solo se pregunta si la venta se ve.
  Escribir solo lo hace anular_venta().

  Supabase concede por omisión todo sobre una tabla nueva también a
  service_role, la clave del servidor, que pasa por encima de RLS: con ella
  se podría insertar un registro falso o vaciar la tabla. Se le deja solo
  leer, igual que a la aplicación.
*/
alter table public.anulaciones_venta enable row level security;

revoke all on public.anulaciones_venta from anon, authenticated, service_role;
grant select on public.anulaciones_venta to authenticated, service_role;

drop policy if exists anulaciones_venta_lectura on public.anulaciones_venta;
create policy anulaciones_venta_lectura on public.anulaciones_venta
  for select
  to authenticated
  using (
    empresa_id = (select public.empresa_del_usuario())
    and exists (select 1 from public.ventas v where v.id = anulaciones_venta.venta_id)
  );

-- ─────────────────────────────────────────────────────────
-- UNA VENTA ANULADA NO VUELVE
-- ─────────────────────────────────────────────────────────
/*
  Dos reglas sobre el estado, para todos —también para el dueño y para las
  funciones SECURITY DEFINER—:
  - una venta anulada no vuelve a pendiente ni a pagada;
  - una venta solo pasa a anulada si ya tiene su registro de anulación.
  Así no hay forma de anular «por debajo» sin dejar quién, cuándo y por qué.

  Solo mira las actualizaciones: las ventas no se insertan anuladas por
  ningún camino de la aplicación.
*/
create or replace function public.ventas_anulacion_definitiva()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado = 'anulada' and new.estado is distinct from 'anulada' then
    raise exception 'Una venta anulada no vuelve a estar vigente'
      using errcode = '42501';
  end if;

  if new.estado = 'anulada' and old.estado is distinct from 'anulada'
     and not exists (select 1 from public.anulaciones_venta a where a.venta_id = new.id) then
    raise exception 'Una venta solo se anula con anular_venta(), que deja su registro'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists ventas_anulacion_definitiva on public.ventas;
create trigger ventas_anulacion_definitiva
  before update of estado on public.ventas
  for each row execute function public.ventas_anulacion_definitiva();

revoke execute on function public.ventas_anulacion_definitiva() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- ANULAR
-- ─────────────────────────────────────────────────────────
/*
  Todo en una transacción: si algo falla, no queda ni la venta anulada, ni
  la mercadería devuelta, ni el registro.

  Errores:
  - 42501: sin sesión válida, sin permiso, o una venta de otra ubicación;
  - AV001: motivo de menos de 10 caracteres o tratamiento del dinero desconocido;
  - AV002: la venta no existe en tu empresa;
  - AV003: un vendedor fuera del día de la venta (hora de Honduras);
  - AV004: factura fiscal;
  - AV005: la venta tiene abonos;
  - AV006: venta antigua sin ubicación;
  - AV007: el inventario de la venta no se puede reconstruir con seguridad;
  - AV008: venta de conciliación y quien anula no es administrador;
  - AV009: la clave ya se usó para anular otra venta.

  Si la venta ya estaba anulada responde «ya_anulada» con el registro que
  existe, sin escribir nada: un reintento o un doble clic no es un error.
*/
create or replace function public.anular_venta(
  p_venta_id           uuid,
  p_motivo             text,
  p_tratamiento_dinero text default null,
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario      usuarios;
  v_empresa      uuid;
  v_es_admin     boolean;
  v_motivo       text := btrim(coalesce(p_motivo, ''));
  v_tratamiento  text;
  v_venta        ventas;
  v_anulacion    anulaciones_venta;
  v_item         record;
  v_movimiento   bigint;
  v_movimientos  jsonb := '[]'::jsonb;
  v_diferencias  integer;
begin
  -- ── quién anula ──
  /*
    Activo, sin cambio de contraseña pendiente y de una empresa. La fila se
    bloquea para compartir: si un administrador le cambia la ubicación, el
    rol o lo desactiva mientras tanto, ese cambio espera a que esto
    termine, y la anulación se resuelve con lo que había al empezar.
  */
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid()
     and u.activo
     and not u.debe_cambiar_contrasena
   limit 1
     for share;

  if v_usuario.id is null then
    raise exception 'Inicia sesión con un usuario activo para anular ventas'
      using errcode = '42501';
  end if;

  v_empresa := v_usuario.empresa_id;
  v_es_admin := v_usuario.rol = 'admin';

  /*
    El vendedor necesita las dos marcas: ver el historial y anular. Para el
    administrador usuario_tiene_permiso() ya responde que sí.
  */
  if not v_es_admin and not (usuario_tiene_permiso('sales-history') and usuario_tiene_permiso('sales-void')) then
    raise exception 'No tienes permiso para anular ventas'
      using errcode = '42501';
  end if;

  if not v_es_admin and v_usuario.ubicacion_id is null then
    raise exception 'No tienes una ubicación asignada: solo puedes anular ventas de tu ubicación'
      using errcode = '42501';
  end if;

  if char_length(v_motivo) < 10 then
    raise exception 'Escribe el motivo de la anulación (al menos 10 caracteres)'
      using errcode = 'AV001';
  end if;

  -- ── la venta, bajo candado ──
  /*
    La fila de la venta pone en fila todo lo que la toca: otra anulación, y
    también el cobro, porque registrar_pago_cliente() bloquea las facturas
    del cliente antes de repartir. El que entra segundo espera y ve lo que
    hizo el primero: un abono que ya entró, o una venta ya anulada que ya
    no cuenta como deuda.
  */
  select v.* into v_venta
    from ventas v
   where v.id = p_venta_id
     and v.empresa_id = v_empresa
     for update;

  if not found then
    raise exception 'La venta no existe en tu empresa'
      using errcode = 'AV002';
  end if;

  -- ── de qué ubicación ──
  /*
    El vendedor, solo en la que tiene asignada ahora. Si lo reasignaron, las
    ventas de su ubicación anterior ya no son suyas para anular, aunque las
    haya hecho él: es la misma regla con la que deja de verlas (0029).
  */
  if not v_es_admin and v_venta.ubicacion_id is distinct from v_usuario.ubicacion_id then
    raise exception 'Solo puedes anular ventas de tu ubicación'
      using errcode = '42501';
  end if;

  -- ── ¿ya estaba anulada? ──
  if v_venta.estado = 'anulada' then
    select a.* into v_anulacion from anulaciones_venta a where a.venta_id = v_venta.id;

    return jsonb_build_object(
      'estado',          'ya_anulada',
      'venta_id',        v_venta.id,
      'numero_factura',  v_venta.numero_factura,
      'anulacion_id',    v_anulacion.id,
      'anulada_en',      v_anulacion.anulada_en,
      'motivo',          v_anulacion.motivo
    );
  end if;

  if p_clave_idempotencia is not null and exists (
    select 1 from anulaciones_venta a
     where a.empresa_id = v_empresa and a.clave_idempotencia = p_clave_idempotencia
  ) then
    raise exception 'La clave % ya se usó para anular otra venta', p_clave_idempotencia
      using errcode = 'AV009';
  end if;

  -- ── lo que esta anulación no cubre ──
  if v_venta.origen = 'conciliacion' and not v_es_admin then
    raise exception 'Esta venta se aplicó por conciliación: solo un administrador puede anularla'
      using errcode = 'AV008';
  end if;

  /*
    El plazo del vendedor: el mismo día de la venta, contado en hora de
    Honduras con el reloj del servidor. La hora del navegador no cuenta.
  */
  if not v_es_admin
     and (v_venta.fecha at time zone 'America/Tegucigalpa')::date
         <> (now() at time zone 'America/Tegucigalpa')::date then
    raise exception 'Solo puedes anular ventas del mismo día. Para una venta anterior, contacta con el administrador'
      using errcode = 'AV003';
  end if;

  if v_venta.es_fiscal or btrim(coalesce(v_venta.cai_emision, '')) <> '' then
    raise exception 'Las facturas fiscales no se anulan con este procedimiento'
      using errcode = 'AV004';
  end if;

  if v_venta.ubicacion_id is null then
    raise exception 'Es una venta antigua sin ubicación: no se sabe a dónde devolver la mercadería'
      using errcode = 'AV006';
  end if;

  /*
    Con abonos, parciales o que la saldaron, no: el dinero ya entró y pudo
    llegar en un pago repartido entre varias facturas. Revertirlo es otra
    funcionalidad. Se mira con la venta ya bloqueada, así que un cobro
    simultáneo o entró antes —y aquí se ve— o espera.
  */
  if exists (select 1 from abonos a where a.venta_id = v_venta.id) then
    raise exception 'Esta venta tiene abonos registrados y no puede anularse mediante el procedimiento actual. Contacta con el administrador'
      using errcode = 'AV005';
  end if;

  -- ── el dinero ──
  if v_venta.forma_pago = 'contado' then
    v_tratamiento := coalesce(p_tratamiento_dinero, 'reembolso_pendiente');

    if v_tratamiento not in ('reembolso_pendiente', 'no_cobrado') then
      raise exception 'Tratamiento del dinero desconocido: %', v_tratamiento
        using errcode = 'AV001';
    end if;
  else
    v_tratamiento := 'credito_sin_abonos';
  end if;

  -- ── lo que salió, contra lo que se vendió ──
  /*
    Se devuelve lo que el libro dice que salió por esta venta, y solo si
    coincide producto por producto con el detalle y salió de la ubicación
    de la venta. Si el producto se borró, si falta un movimiento o sobra
    uno, no se adivina: se rechaza.

    Los ajustes de la conciliación (venta_id nulo) no entran: corrigieron
    una diferencia física real y no son parte de la venta.
  */
  if exists (select 1 from detalle_venta d where d.venta_id = v_venta.id and d.producto_id is null) then
    raise exception 'Uno de los productos de la venta ya no existe: el inventario no se puede devolver con seguridad'
      using errcode = 'AV007';
  end if;

  select count(*) into v_diferencias
    from (
      select d.producto_id, sum(d.cantidad)::integer as cantidad
        from detalle_venta d
       where d.venta_id = v_venta.id
       group by d.producto_id
    ) vendido
    full join (
      select m.producto_id, sum(-m.cantidad)::integer as cantidad
        from movimientos_inventario m
       where m.venta_id = v_venta.id
         and m.tipo = 'salida'
         and m.ubicacion_id = v_venta.ubicacion_id
       group by m.producto_id
    ) salio on salio.producto_id = vendido.producto_id
   where vendido.cantidad is distinct from salio.cantidad;

  if v_diferencias > 0
     or not exists (select 1 from detalle_venta d where d.venta_id = v_venta.id)
     or exists (
       select 1 from movimientos_inventario m
        where m.venta_id = v_venta.id
          and m.tipo = 'salida'
          and m.ubicacion_id is distinct from v_venta.ubicacion_id
     ) then
    raise exception 'Los movimientos de inventario de la venta no coinciden con su detalle: no se puede devolver con seguridad'
      using errcode = 'AV007';
  end if;

  -- ── la mercadería vuelve a donde salió ──
  /*
    A la ubicación de la venta, aunque esté desactivada y aunque quien anula
    trabaje en otra. Las celdas se bloquean en orden de producto, el mismo
    que usa la venta. Si la celda ya no existe, se crea en cero.
  */
  for v_item in
    select m.producto_id, sum(-m.cantidad)::integer as cantidad
      from movimientos_inventario m
     where m.venta_id = v_venta.id
       and m.tipo = 'salida'
     group by m.producto_id
     order by m.producto_id
  loop
    insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
    values (v_empresa, v_venta.ubicacion_id, v_item.producto_id, 0)
    on conflict (ubicacion_id, producto_id) do nothing;

    perform 1
       from inventario_ubicacion
      where ubicacion_id = v_venta.ubicacion_id
        and producto_id = v_item.producto_id
        for update;

    update inventario_ubicacion
       set cantidad = cantidad + v_item.cantidad,
           actualizado_en = now()
     where ubicacion_id = v_venta.ubicacion_id
       and producto_id = v_item.producto_id;

    insert into movimientos_inventario (
      empresa_id, producto_id, usuario_id, venta_id, ubicacion_id, tipo, cantidad, motivo
    ) values (
      v_empresa, v_item.producto_id, v_usuario.id, v_venta.id, v_venta.ubicacion_id,
      'anulacion_venta', v_item.cantidad,
      'Anulación de ' || v_venta.numero_factura || ': ' || v_motivo
    )
    returning id into v_movimiento;

    v_movimientos := v_movimientos || to_jsonb(v_movimiento);
  end loop;

  -- ── el registro, antes que el estado ──
  /*
    Con los movimientos que se acaban de crear. Va antes de cambiar el
    estado porque el disparador de ventas no deja anular sin registro.
  */
  insert into anulaciones_venta (
    empresa_id, venta_id, numero_documento, estado_anterior, forma_pago, total,
    saldo_cancelado, ubicacion_venta, usuario_id, usuario_nombre, usuario_rol,
    ubicacion_usuario, motivo, tratamiento_dinero, movimientos, clave_idempotencia
  ) values (
    v_empresa, v_venta.id, v_venta.numero_factura, v_venta.estado, v_venta.forma_pago, v_venta.total,
    case when v_venta.forma_pago = 'credito' then v_venta.total else 0 end,
    v_venta.ubicacion_id, v_usuario.id, v_usuario.nombre, v_usuario.rol,
    v_usuario.ubicacion_id, v_motivo, v_tratamiento, v_movimientos, p_clave_idempotencia
  )
  returning * into v_anulacion;

  update ventas set estado = 'anulada' where id = v_venta.id;

  return jsonb_build_object(
    'estado',             'anulada',
    'venta_id',           v_venta.id,
    'numero_factura',     v_venta.numero_factura,
    'anulacion_id',       v_anulacion.id,
    'anulada_en',         v_anulacion.anulada_en,
    'tratamiento_dinero', v_tratamiento,
    'saldo_cancelado',    v_anulacion.saldo_cancelado,
    'movimientos',        v_movimientos
  );
end $$;

revoke execute on function public.anular_venta(uuid, text, text, text) from public, anon;
grant execute on function public.anular_venta(uuid, text, text, text) to authenticated, service_role;
