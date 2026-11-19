-- Etapas C4 y C5: devoluciones después de facturar y ajustes de crédito.
--
-- El cliente devuelve uno o varios productos de una factura vigente (normal o
-- de un pedido). La factura no cambia: conserva su número, productos, precios,
-- impuestos, cargo y pagos. Cada devolución es un registro aparte, ligado a
-- la factura, y de ella salen tres efectos:
-- - inventario: lo que vuelve en buen estado suma, solo en la ubicación que lo
--   recibe de verdad; lo dañado queda registrado sin sumar;
-- - deuda (crédito): el valor devuelto rebaja el saldo de esa factura con un
--   ajuste (un pago en estado «ajuste» y su abono a esa factura). Así el saldo,
--   la aplicación FIFO de pagos y las cuentas por cobrar ya lo descuentan, y
--   los reportes de caja no lo cuentan como dinero (solo cuentan pagos
--   «aplicado»). Nunca toca otras facturas ni otros abonos;
-- - dinero: lo pagado de más (contado, o un crédito que ya estaba pagado)
--   queda a favor del cliente, por devolver. No baja ninguna caja hasta que se
--   registra el reembolso real.
--
-- Decisiones del propietario (2026-11-19):
-- - valor devuelto: precio facturado × cantidad, más su ISV. El cargo de
--   tarjeta o enlace solo se devuelve cuando se devuelve todo lo que queda; esa
--   última devolución también ajusta el céntimo para que nunca se pase del total;
-- - medio del reembolso: lo elige quien registra. Efectivo, desde la ubicación
--   que facturó; transferencia, tarjeta o enlace, solo el administrador y con
--   referencia. En contado, nunca más de lo cobrado por ese medio; en un
--   crédito, el tope es lo que quedó a favor;
-- - facturas de pedido: el dinero solo sale de la ubicación que facturó, así
--   que no cambia ninguna obligación entre ubicaciones (C2b);
-- - permiso nuevo «Registrar devoluciones» (sales-return), que nadie recibe al
--   instalar: el vendedor, en la ubicación que facturó y sin límite de día; el
--   administrador, siempre; el contador, nunca.
-- Facturas fiscales (CAI): no se devuelven por aquí (DV004) hasta definir la
-- nota de crédito con el contador. Una factura con devoluciones ya no se anula
-- (ni con anular_venta ni con C3): el camino desde ahí son más devoluciones.
--
-- Errores: DV001 datos, DV002 la venta no existe, DV003 venta anulada,
-- DV004 fiscal, DV005 cantidad mayor que lo disponible, DV006 clave reusada,
-- DV007 reembolso no válido, AV010 anular una venta con devoluciones, 42501.
--
-- No cambia ninguna fila existente. Idempotente.

-- ─────────────────────────────────────────────────────────
-- PERMISO, ESTADO DE PAGO Y TIPOS
-- ─────────────────────────────────────────────────────────
alter table public.permisos_usuario drop constraint if exists permisos_usuario_seccion_check;
alter table public.permisos_usuario add constraint permisos_usuario_seccion_check
  check (seccion in (
    'dashboard', 'pos', 'quotes', 'products', 'clients', 'suppliers', 'sales-history', 'settings', 'locations',
    'inventory-own', 'inventory-all', 'sales-void', 'sales-return', 'products-read',
    'orders-resolve', 'orders-cancel', 'settlements-view', 'settlements-manage'
  ));

-- «ajuste»: la rebaja de una factura por una devolución. No es dinero que entró.
alter table public.pagos drop constraint if exists pagos_estado_check;
alter table public.pagos add constraint pagos_estado_check check (estado in ('aplicado', 'revertido', 'ajuste'));

-- ─────────────────────────────────────────────────────────
-- LOS REGISTROS
-- ─────────────────────────────────────────────────────────
create table if not exists public.devoluciones_de_venta (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas (id),
  venta_id           uuid not null references public.ventas (id),
  motivo             text not null check (char_length(btrim(motivo)) between 5 and 500),
  valor              numeric(12,2) not null check (valor >= 0),
  cargo              numeric(12,2) not null default 0 check (cargo >= 0),
  ajuste_credito     numeric(12,2) not null default 0 check (ajuste_credito >= 0),
  a_favor            numeric(12,2) not null default 0 check (a_favor >= 0),
  ubicacion_id       uuid not null,
  usuario_id         uuid not null references public.usuarios (id),
  usuario_nombre     text not null,
  usuario_rol        text not null,
  devuelto_en        timestamptz not null default now(),
  clave_idempotencia text not null check (btrim(clave_idempotencia) <> ''),
  huella             text not null,
  constraint devoluciones_ubicacion_de_la_empresa foreign key (ubicacion_id, empresa_id) references public.ubicaciones (id, empresa_id),
  constraint devoluciones_clave_unica unique (empresa_id, clave_idempotencia),
  constraint devoluciones_cuadran check (valor + cargo = ajuste_credito + a_favor)
);

create table if not exists public.devolucion_venta_detalle (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id),
  devolucion_id  uuid not null references public.devoluciones_de_venta (id),
  producto_id    uuid not null references public.productos (id),
  cantidad       integer not null check (cantidad > 0),
  condicion      text not null check (condicion in ('buen_estado', 'danado')),
  valor          numeric(12,2) not null check (valor >= 0)
);

create table if not exists public.reembolsos_de_venta (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas (id),
  venta_id           uuid not null references public.ventas (id),
  medio              text not null check (medio in ('efectivo', 'transferencia', 'tarjeta', 'enlace')),
  importe            numeric(12,2) not null check (importe > 0),
  ubicacion_id       uuid,
  referencia         text not null default '' check (char_length(referencia) <= 120),
  usuario_id         uuid not null references public.usuarios (id),
  usuario_nombre     text not null,
  reembolsado_en     timestamptz not null default now(),
  clave_idempotencia text not null check (btrim(clave_idempotencia) <> ''),
  huella             text not null,
  constraint reembolsos_venta_clave_unica unique (empresa_id, clave_idempotencia),
  -- El efectivo sale de una caja; lo electrónico, de la cuenta de la empresa.
  constraint reembolsos_venta_efectivo_con_ubicacion check ((medio = 'efectivo') = (ubicacion_id is not null))
);

create index if not exists devoluciones_de_venta_venta on public.devoluciones_de_venta (venta_id);
create index if not exists devolucion_venta_detalle_devolucion on public.devolucion_venta_detalle (devolucion_id);
create index if not exists reembolsos_de_venta_venta on public.reembolsos_de_venta (venta_id);

-- El ajuste de crédito es un abono ligado a su devolución; lo que vuelve al inventario, un movimiento ligado a ella.
alter table public.abonos add column if not exists devolucion_id uuid references public.devoluciones_de_venta (id);
alter table public.movimientos_inventario add column if not exists devolucion_venta_id uuid references public.devoluciones_de_venta (id);

alter table public.movimientos_inventario drop constraint if exists movimientos_devolucion_de_una_venta;
alter table public.movimientos_inventario add constraint movimientos_devolucion_de_una_venta
  check (devolucion_venta_id is null or (tipo = 'devolucion' and venta_id is not null and cantidad > 0));

create unique index if not exists movimientos_devolucion_venta_una_vez
  on public.movimientos_inventario (devolucion_venta_id, producto_id) where devolucion_venta_id is not null;

/*
  Inmutables, sin vaciar, el contador no escribe, y se leen con la misma regla
  que la venta (la política de ventas decide). Solo escriben las funciones.
*/
do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['devoluciones_de_venta', 'devolucion_venta_detalle', 'reembolsos_de_venta'] loop
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on public.%I from public, anon, authenticated', v_tabla);
    execute format('grant select on public.%I to authenticated', v_tabla);

    execute format('drop trigger if exists %1$s_no_cambia on public.%1$I', v_tabla);
    execute format('create trigger %1$s_no_cambia before update or delete on public.%1$I for each row execute function public.registro_de_pedido_inmutable()', v_tabla);
    execute format('drop trigger if exists %1$s_no_se_vacia on public.%1$I', v_tabla);
    execute format('create trigger %1$s_no_se_vacia before truncate on public.%1$I for each statement execute function public.registro_de_pedido_inmutable()', v_tabla);
    execute format('drop trigger if exists impedir_escritura_del_contador on public.%I', v_tabla);
    execute format('create trigger impedir_escritura_del_contador before insert or update or delete or truncate on public.%I for each statement execute function public.impedir_escritura_del_contador()', v_tabla);
  end loop;
end $$;

drop policy if exists devoluciones_de_venta_lectura on public.devoluciones_de_venta;
create policy devoluciones_de_venta_lectura on public.devoluciones_de_venta for select to authenticated
  using (empresa_id = (select public.empresa_del_usuario()) and exists (select 1 from public.ventas v where v.id = devoluciones_de_venta.venta_id));

drop policy if exists devolucion_venta_detalle_lectura on public.devolucion_venta_detalle;
create policy devolucion_venta_detalle_lectura on public.devolucion_venta_detalle for select to authenticated
  using (empresa_id = (select public.empresa_del_usuario())
         and exists (select 1 from public.devoluciones_de_venta d where d.id = devolucion_venta_detalle.devolucion_id));

drop policy if exists reembolsos_de_venta_lectura on public.reembolsos_de_venta;
create policy reembolsos_de_venta_lectura on public.reembolsos_de_venta for select to authenticated
  using (empresa_id = (select public.empresa_del_usuario()) and exists (select 1 from public.ventas v where v.id = reembolsos_de_venta.venta_id));

-- ─────────────────────────────────────────────────────────
-- UN SOLO CAMINO
-- ─────────────────────────────────────────────────────────
/*
  Una venta con devoluciones ya no se anula: anularla devolvería otra vez al
  inventario lo que ya volvió y dejaría el dinero contado dos veces. Lo mira
  el registro de la anulación, que exigen anular_venta() y C3, así que ninguna
  de las dos tiene que cambiar.
*/
create or replace function public.sin_anular_con_devoluciones()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.devoluciones_de_venta d where d.venta_id = new.venta_id) then
    raise exception 'Esta venta ya tiene devoluciones registradas: no se anula. Registra la devolución de lo que falta'
      using errcode = 'AV010';
  end if;

  return new;
end $$;

revoke execute on function public.sin_anular_con_devoluciones() from public, anon, authenticated;

drop trigger if exists anulacion_sin_devoluciones on public.anulaciones_venta;
create trigger anulacion_sin_devoluciones before insert on public.anulaciones_venta
  for each row execute function public.sin_anular_con_devoluciones();

-- ─────────────────────────────────────────────────────────
-- LAS CIFRAS DE UNA VENTA
-- ─────────────────────────────────────────────────────────
-- Por producto: lo vendido, su subtotal (sin ISV), lo ya devuelto y lo que aún se puede devolver. Pieza interna.
create or replace function public.productos_de_la_venta(p_venta uuid)
returns table (producto_id uuid, nombre text, vendido integer, subtotal numeric, devuelto integer, disponible integer)
language sql
stable
security definer
set search_path = ''
as $$
  select d.producto_id, max(d.nombre), sum(d.cantidad)::integer, sum(d.subtotal),
         coalesce(r.devuelto, 0)::integer, (sum(d.cantidad) - coalesce(r.devuelto, 0))::integer
    from public.detalle_venta d
    left join (
      select x.producto_id, sum(x.cantidad) as devuelto
        from public.devolucion_venta_detalle x
        join public.devoluciones_de_venta k on k.id = x.devolucion_id
       where k.venta_id = p_venta
       group by x.producto_id
    ) r on r.producto_id = d.producto_id
   where d.venta_id = p_venta and d.producto_id is not null
   group by d.producto_id, r.devuelto
$$;

/*
  El dinero de una venta después de sus devoluciones: lo devuelto (valor y
  cargo), lo que rebajó la deuda, lo que quedó a favor del cliente, lo ya
  reembolsado y lo pendiente; y, por medio, lo cobrado y lo ya reembolsado.
  El cobro de una factura de pedido es el del pedido. Una venta antigua sin
  medios registrados cuenta como efectivo. Pieza interna.
*/
create or replace function public.dinero_de_la_venta(p_venta uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  v as (select * from public.ventas where id = p_venta),
  dev as (
    select coalesce(sum(valor), 0) as valor, coalesce(sum(cargo), 0) as cargo,
           coalesce(sum(ajuste_credito), 0) as ajuste, coalesce(sum(a_favor), 0) as a_favor
      from public.devoluciones_de_venta where venta_id = p_venta
  ),
  reemb as (select medio, sum(importe) as importe from public.reembolsos_de_venta where venta_id = p_venta group by medio),
  cobros as (
    select c.medio, sum(c.monto + c.cargo) as cobrado
      from public.cobros_por_medio c, v
     where c.venta_id = v.id or (v.pedido_id is not null and c.pedido_id = v.pedido_id)
     group by c.medio
  ),
  medios as (
    select m.medio,
           coalesce(c.cobrado, case when m.medio = 'efectivo' and not exists (select 1 from cobros) and v.forma_pago = 'contado'
                                    then v.total + v.cargo_por_medio else 0 end) as cobrado,
           coalesce(r.importe, 0) as reembolsado
      from unnest(array['efectivo', 'transferencia', 'tarjeta', 'enlace']) as m (medio)
      cross join v
      left join cobros c on c.medio = m.medio
      left join reemb r on r.medio = m.medio
  ),
  pagado as (
    select coalesce(sum(a.monto) filter (where a.devolucion_id is null), 0) as real,
           coalesce(sum(a.monto), 0) as todo
      from public.abonos a where a.venta_id = p_venta
  )
  select jsonb_build_object(
    'total', v.total, 'cargo_original', v.cargo_por_medio, 'forma_pago', v.forma_pago,
    'devuelto', dev.valor, 'cargo_devuelto', dev.cargo,
    'neto', v.total - dev.valor,
    'pagado', case when v.forma_pago = 'contado' then v.total + v.cargo_por_medio else pagado.real end,
    'saldo', case when v.forma_pago = 'credito' and v.estado <> 'anulada' then greatest(round(v.total - pagado.todo, 2), 0) else 0 end,
    'ajuste_credito', dev.ajuste, 'a_favor', dev.a_favor,
    'reembolsado', coalesce((select sum(importe) from reemb), 0),
    'pendiente', dev.a_favor - coalesce((select sum(importe) from reemb), 0),
    'medios', (select jsonb_agg(jsonb_build_object('medio', medio, 'cobrado', cobrado, 'reembolsado', reembolsado)
                                order by array_position(array['efectivo', 'transferencia', 'tarjeta', 'enlace'], medio))
                 from medios where cobrado > 0 or reembolsado > 0)
  )
    from v, dev, pagado
$$;

/*
  Quién registra devoluciones y reembolsos de esta venta: el administrador de
  la empresa, o el vendedor con «Registrar devoluciones» en la ubicación que
  facturó. Nunca el contador. Pieza interna.
*/
create or replace function public.quien_devuelve(p_venta public.ventas)
returns public.usuarios
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario public.usuarios;
begin
  select u.* into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid() and u.activo and not u.debe_cambiar_contrasena and u.empresa_id = p_venta.empresa_id
   limit 1;

  if v_usuario.id is null or v_usuario.rol = 'contador'
     or not (v_usuario.rol = 'admin'
             or (public.usuario_tiene_permiso('sales-return') and v_usuario.ubicacion_id = p_venta.ubicacion_id)) then
    raise exception 'Necesitas «Registrar devoluciones» en la ubicación que facturó' using errcode = '42501';
  end if;

  return v_usuario;
end $$;

-- La venta de la empresa, bloqueada (la misma fila que bloquean cobrar y anular), y que se pueda devolver. Pieza interna.
create or replace function public.tomar_venta_para_devolver(p_venta uuid)
returns public.ventas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venta public.ventas;
begin
  select v.* into v_venta from public.ventas v where v.id = p_venta and v.empresa_id = public.empresa_del_usuario() for update;

  if v_venta.id is null then
    raise exception 'La venta no existe en tu empresa' using errcode = 'DV002';
  end if;

  if v_venta.estado = 'anulada' then
    raise exception 'La venta % está anulada: no tiene nada que devolver', v_venta.numero_factura using errcode = 'DV003';
  end if;

  if v_venta.es_fiscal or btrim(coalesce(v_venta.cai_emision, '')) <> '' then
    raise exception 'Las facturas fiscales no admiten devoluciones con este procedimiento: falta definir la nota de crédito con el contador'
      using errcode = 'DV004';
  end if;

  return v_venta;
end $$;

revoke execute on function
  public.productos_de_la_venta(uuid), public.dinero_de_la_venta(uuid),
  public.quien_devuelve(public.ventas), public.tomar_venta_para_devolver(uuid)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- REGISTRAR UNA DEVOLUCIÓN
-- ─────────────────────────────────────────────────────────
/*
  `p_productos`: [{producto_id, cantidad, condicion}], recibidos en
  `p_ubicacion` (el vendedor, la suya; el administrador, cualquier ubicación
  activa; por omisión, la que facturó). Primero se calcula todo y después se
  escribe una sola vez: el registro nace con sus cifras finales. Un reintento
  con la misma clave devuelve la devolución hecha.
*/
create or replace function public.registrar_devolucion_de_venta(
  p_venta              uuid,
  p_motivo             text,
  p_productos          jsonb,
  p_ubicacion          uuid default null,
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta    ventas;
  v_usuario  usuarios;
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_huella   text;
  v_previa   devoluciones_de_venta;
  v_registro devoluciones_de_venta;
  v_recibe   uuid;
  v_lineas   jsonb;
  v_linea    jsonb;
  v_valor    numeric(12,2);
  v_cargo    numeric(12,2) := 0;
  v_ajuste   numeric(12,2) := 0;
  v_saldo    numeric(12,2);
  v_deuda    numeric(12,2);
  v_pago     uuid;
begin
  perform exigir_clave(p_clave_idempotencia);

  if char_length(v_motivo) not between 5 and 500
     or jsonb_typeof(p_productos) is distinct from 'array' or jsonb_array_length(p_productos) = 0 then
    raise exception 'Escribe el motivo (de 5 a 500 caracteres) e indica los productos devueltos' using errcode = 'DV001';
  end if;

  v_venta := tomar_venta_para_devolver(p_venta);
  v_huella := concat_ws('|', 'devolver', p_venta::text, v_motivo, p_productos::text, coalesce(p_ubicacion::text, '-'));

  select d.* into v_previa from devoluciones_de_venta d where d.empresa_id = v_venta.empresa_id and d.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_previa.huella <> v_huella then
      raise exception 'La clave % ya se usó para otra devolución', p_clave_idempotencia using errcode = 'DV006';
    end if;

    return to_jsonb(v_previa) - 'huella' - 'clave_idempotencia' || jsonb_build_object('repetido', true);
  end if;

  v_usuario := quien_devuelve(v_venta);
  v_recibe := case when v_usuario.rol = 'admin' then coalesce(p_ubicacion, v_venta.ubicacion_id) else v_usuario.ubicacion_id end;

  if p_ubicacion is not null and p_ubicacion is distinct from v_recibe then
    raise exception 'Solo recibes devoluciones en tu ubicación' using errcode = '42501';
  end if;

  if v_recibe is null or not exists (select 1 from ubicaciones u where u.id = v_recibe and u.empresa_id = v_venta.empresa_id and u.activa) then
    raise exception 'Elige una ubicación activa donde se recibieron los productos' using errcode = 'DV001';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_productos) e
     where coalesce(e->>'cantidad', '') !~ '^[1-9][0-9]{0,5}$' or coalesce(e->>'condicion', '') not in ('buen_estado', 'danado')
        or coalesce(e->>'producto_id', '') !~ '^[0-9a-fA-F-]{36}$'
  ) then
    raise exception 'Cada producto lleva una cantidad entera mayor que cero y su estado (buen_estado o danado)' using errcode = 'DV001';
  end if;

  /*
    Las líneas, agrupadas por producto y estado, con su valor: su parte del
    subtotal más su ISV (la proporción total/subtotal de la factura). `queda`
    es lo que seguiría por devolver de ese producto después de esta.
  */
  select jsonb_agg(to_jsonb(z) order by z.producto_id, z.condicion)
    into v_lineas
    from (
      select l.producto_id, l.condicion, l.cantidad,
             round(p.subtotal * l.cantidad / p.vendido * case when v_venta.subtotal > 0 then v_venta.total / v_venta.subtotal else 1 end, 2) as valor,
             p.disponible - sum(l.cantidad) over (partition by l.producto_id) as queda
        from (
          select (e->>'producto_id')::uuid as producto_id, e->>'condicion' as condicion, sum((e->>'cantidad')::integer) as cantidad
            from jsonb_array_elements(p_productos) e
           group by 1, 2
        ) l
        left join productos_de_la_venta(v_venta.id) p on p.producto_id = l.producto_id
    ) z;

  if exists (select 1 from jsonb_array_elements(v_lineas) x where x->>'valor' is null or (x->>'queda')::integer < 0) then
    raise exception 'Un producto no es de esta venta o se devuelve más de lo que queda por devolver' using errcode = 'DV005';
  end if;

  v_valor := (select sum((x->>'valor')::numeric) from jsonb_array_elements(v_lineas) x);

  -- Si con esto vuelve todo, esta devolución cierra el céntimo (en su última línea) y devuelve el cargo.
  if not exists (
    select 1 from productos_de_la_venta(v_venta.id) p
     where p.disponible > coalesce((select sum((x->>'cantidad')::integer) from jsonb_array_elements(v_lineas) x
                                     where (x->>'producto_id')::uuid = p.producto_id), 0)
  ) then
    v_cargo := v_venta.cargo_por_medio;
    v_lineas := jsonb_set(v_lineas, array[(jsonb_array_length(v_lineas) - 1)::text, 'valor'],
                  to_jsonb((v_lineas->-1->>'valor')::numeric
                           + v_venta.total - coalesce((select sum(d.valor) from devoluciones_de_venta d where d.venta_id = v_venta.id), 0) - v_valor));
    v_valor := v_venta.total - coalesce((select sum(d.valor) from devoluciones_de_venta d where d.venta_id = v_venta.id), 0);
  end if;

  -- El crédito: primero rebaja el saldo de esta factura; lo que sobre queda a favor del cliente.
  if v_venta.forma_pago = 'credito' then
    v_saldo := greatest(round(v_venta.total - coalesce((select sum(a.monto) from abonos a where a.venta_id = v_venta.id), 0), 2), 0);
    v_ajuste := least(v_valor + v_cargo, v_saldo);
  end if;

  insert into devoluciones_de_venta (
    empresa_id, venta_id, motivo, valor, cargo, ajuste_credito, a_favor, ubicacion_id,
    usuario_id, usuario_nombre, usuario_rol, clave_idempotencia, huella
  ) values (
    v_venta.empresa_id, v_venta.id, v_motivo, v_valor, v_cargo, v_ajuste, v_valor + v_cargo - v_ajuste, v_recibe,
    v_usuario.id, v_usuario.nombre, v_usuario.rol, p_clave_idempotencia, v_huella
  )
  returning * into v_registro;

  for v_linea in select x from jsonb_array_elements(v_lineas) x loop
    insert into devolucion_venta_detalle (empresa_id, devolucion_id, producto_id, cantidad, condicion, valor)
    values (v_venta.empresa_id, v_registro.id, (v_linea->>'producto_id')::uuid, (v_linea->>'cantidad')::integer,
            v_linea->>'condicion', (v_linea->>'valor')::numeric);

    -- Solo lo bueno suma, y solo donde se recibió.
    if v_linea->>'condicion' = 'buen_estado' then
      insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
      values (v_venta.empresa_id, v_recibe, (v_linea->>'producto_id')::uuid, 0)
      on conflict (ubicacion_id, producto_id) do nothing;

      update inventario_ubicacion set cantidad = cantidad + (v_linea->>'cantidad')::integer, actualizado_en = now()
       where ubicacion_id = v_recibe and producto_id = (v_linea->>'producto_id')::uuid;

      insert into movimientos_inventario (empresa_id, producto_id, usuario_id, venta_id, ubicacion_id, tipo, cantidad, motivo, devolucion_venta_id)
      values (v_venta.empresa_id, (v_linea->>'producto_id')::uuid, v_usuario.id, v_venta.id, v_recibe, 'devolucion',
              (v_linea->>'cantidad')::integer, 'Devolución de ' || v_venta.numero_factura || ': ' || v_motivo, v_registro.id);
    end if;
  end loop;

  -- El ajuste: un pago «ajuste» (no es dinero) y su abono a esta factura, nunca a otra.
  if v_ajuste > 0 then
    select coalesce(sum(greatest(round(x.total - coalesce((select sum(a.monto) from abonos a where a.venta_id = x.id), 0), 2), 0)), 0)
      into v_deuda
      from ventas x
     where x.empresa_id = v_venta.empresa_id and x.cliente_id = v_venta.cliente_id and x.forma_pago = 'credito' and x.estado <> 'anulada';

    insert into pagos (empresa_id, cliente_id, usuario_id, ubicacion_id, monto, saldo_anterior, saldo_posterior, nota, clave_idempotencia, estado)
    values (v_venta.empresa_id, v_venta.cliente_id, v_usuario.id, v_venta.ubicacion_id, v_ajuste, v_deuda, v_deuda - v_ajuste,
            'Ajuste por devolución de ' || v_venta.numero_factura, p_clave_idempotencia || '|ajuste', 'ajuste')
    returning id into v_pago;

    insert into abonos (empresa_id, venta_id, usuario_id, monto, nota, pago_id, saldo_anterior, saldo_posterior, devolucion_id)
    values (v_venta.empresa_id, v_venta.id, v_usuario.id, v_ajuste, 'Ajuste por devolución', v_pago, v_saldo, v_saldo - v_ajuste, v_registro.id);

    if v_saldo - v_ajuste <= 0 then
      update ventas set estado = 'pagada' where id = v_venta.id;
    end if;
  end if;

  return to_jsonb(v_registro) - 'huella' - 'clave_idempotencia' || jsonb_build_object('repetido', false);
end $$;

-- ─────────────────────────────────────────────────────────
-- REGISTRAR UN REEMBOLSO
-- ─────────────────────────────────────────────────────────
/*
  Una entrega real de dinero al cliente por lo que quedó a favor. Efectivo,
  desde la ubicación que facturó; lo electrónico, solo el administrador y con
  referencia. En contado, nunca más de lo cobrado por ese medio. Reintento
  con la misma clave: el mismo reembolso.
*/
create or replace function public.registrar_reembolso_de_venta(
  p_venta              uuid,
  p_medio              text,
  p_importe            numeric,
  p_referencia         text default '',
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta      ventas;
  v_usuario    usuarios;
  v_referencia text := btrim(coalesce(p_referencia, ''));
  v_huella     text;
  v_previa     reembolsos_de_venta;
  v_dinero     jsonb;
  v_medio      jsonb;
  v_registro   reembolsos_de_venta;
begin
  perform exigir_clave(p_clave_idempotencia);

  v_venta := tomar_venta_para_devolver(p_venta);
  v_huella := concat_ws('|', 'reembolsar', p_venta::text, coalesce(p_medio, '-'), coalesce(p_importe::text, '-'), v_referencia);

  select r.* into v_previa from reembolsos_de_venta r where r.empresa_id = v_venta.empresa_id and r.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_previa.huella <> v_huella then
      raise exception 'La clave % ya se usó para otro reembolso', p_clave_idempotencia using errcode = 'DV006';
    end if;

    return to_jsonb(v_previa) - 'huella' - 'clave_idempotencia' || jsonb_build_object('repetido', true);
  end if;

  v_usuario := quien_devuelve(v_venta);

  if coalesce(p_medio, '') not in ('efectivo', 'transferencia', 'tarjeta', 'enlace')
     or p_importe is null or p_importe <= 0 or p_importe <> round(p_importe, 2) or char_length(v_referencia) > 120 then
    raise exception 'Indica el medio y un importe mayor que cero con hasta dos decimales' using errcode = 'DV007';
  end if;

  if p_medio <> 'efectivo' and v_usuario.rol <> 'admin' then
    raise exception 'Las devoluciones por transferencia, tarjeta o enlace las registra el administrador' using errcode = '42501';
  end if;

  if p_medio <> 'efectivo' and v_referencia = '' then
    raise exception 'Escribe la referencia de la devolución hecha por %', p_medio using errcode = 'DV007';
  end if;

  v_dinero := dinero_de_la_venta(v_venta.id);

  if p_importe > (v_dinero->>'pendiente')::numeric then
    raise exception 'El reembolso (%) supera lo que hay a favor del cliente (%)',
      to_char(p_importe, 'FM999999990.00'), to_char((v_dinero->>'pendiente')::numeric, 'FM999999990.00') using errcode = 'DV007';
  end if;

  if v_venta.forma_pago = 'contado' then
    select m into v_medio from jsonb_array_elements(coalesce(v_dinero->'medios', '[]'::jsonb)) m where m->>'medio' = p_medio;

    if v_medio is null or p_importe > (v_medio->>'cobrado')::numeric - (v_medio->>'reembolsado')::numeric then
      raise exception 'Con % no se puede devolver más de lo que se cobró por ese medio en esta factura', p_medio using errcode = 'DV007';
    end if;
  end if;

  insert into reembolsos_de_venta (empresa_id, venta_id, medio, importe, ubicacion_id, referencia, usuario_id, usuario_nombre, clave_idempotencia, huella)
  values (v_venta.empresa_id, v_venta.id, p_medio, p_importe, case when p_medio = 'efectivo' then v_venta.ubicacion_id end,
          v_referencia, v_usuario.id, v_usuario.nombre, p_clave_idempotencia, v_huella)
  returning * into v_registro;

  return to_jsonb(v_registro) - 'huella' - 'clave_idempotencia' || jsonb_build_object('repetido', false);
end $$;

-- ─────────────────────────────────────────────────────────
-- LO QUE VE LA PANTALLA
-- ─────────────────────────────────────────────────────────
/*
  Para registrar una devolución o un reembolso: los productos con lo que aún
  se puede devolver (y su valor por unidad con ISV), el dinero de la venta, lo
  registrado, dónde puede recibir quien mira y qué puede hacer. Solo quien ve
  la venta (la misma regla que la lista de ventas).
*/
create or replace function public.devolucion_de_venta(p_venta uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venta  public.ventas;
  v_admin  boolean := coalesce(public.usuario_es_admin(), false);
  v_aqui   uuid := public.ubicacion_del_usuario();
  v_puede  boolean;
begin
  select v.* into v_venta from public.ventas v where v.id = p_venta and v.empresa_id = public.empresa_del_usuario();

  if v_venta.id is null
     or not (v_admin or v_venta.ubicacion_id = v_aqui or (public.usuario_es_contador() and public.usuario_tiene_permiso('sales-history'))) then
    raise exception 'La venta no existe en tu empresa' using errcode = 'DV002';
  end if;

  v_puede := not coalesce(public.usuario_es_contador(), false)
             and (v_admin or (public.usuario_tiene_permiso('sales-return') and v_venta.ubicacion_id = v_aqui));

  return jsonb_build_object(
    'puede_registrar', v_puede and v_venta.estado <> 'anulada' and not v_venta.es_fiscal and btrim(coalesce(v_venta.cai_emision, '')) = '',
    'bloqueo', case
      when v_venta.estado = 'anulada' then 'La venta está anulada.'
      when v_venta.es_fiscal or btrim(coalesce(v_venta.cai_emision, '')) <> '' then 'Las facturas fiscales no admiten devoluciones todavía: falta definir la nota de crédito con el contador.'
    end,
    'puede_reembolsar_electronico', v_puede and v_admin,
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', p.producto_id, 'nombre', p.nombre, 'vendido', p.vendido, 'devuelto', p.devuelto, 'disponible', p.disponible,
               'valor_unitario', round(p.subtotal / p.vendido * case when v_venta.subtotal > 0 then v_venta.total / v_venta.subtotal else 1 end, 2))
             order by p.nombre)
        from public.productos_de_la_venta(v_venta.id) p
    ), '[]'::jsonb),
    'dinero', public.dinero_de_la_venta(v_venta.id),
    'devoluciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fecha', d.devuelto_en, 'motivo', d.motivo, 'usuario', d.usuario_nombre, 'ubicacion', u.nombre,
               'valor', d.valor, 'cargo', d.cargo, 'ajuste_credito', d.ajuste_credito, 'a_favor', d.a_favor,
               'productos', (select jsonb_agg(jsonb_build_object('nombre', pr.nombre, 'cantidad', x.cantidad, 'condicion', x.condicion, 'valor', x.valor) order by pr.nombre)
                               from public.devolucion_venta_detalle x join public.productos pr on pr.id = x.producto_id
                              where x.devolucion_id = d.id))
             order by d.devuelto_en)
        from public.devoluciones_de_venta d join public.ubicaciones u on u.id = d.ubicacion_id
       where d.venta_id = v_venta.id
    ), '[]'::jsonb),
    'reembolsos', coalesce((
      select jsonb_agg(jsonb_build_object('fecha', r.reembolsado_en, 'medio', r.medio, 'importe', r.importe, 'ubicacion', u.nombre,
                                          'referencia', r.referencia, 'usuario', r.usuario_nombre) order by r.reembolsado_en)
        from public.reembolsos_de_venta r left join public.ubicaciones u on u.id = r.ubicacion_id
       where r.venta_id = v_venta.id
    ), '[]'::jsonb),
    'ubicaciones_para_recibir', case when v_puede then coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.id <> v_venta.ubicacion_id, u.nombre)
        from public.ubicaciones u
       where u.empresa_id = v_venta.empresa_id and u.activa and (v_admin or u.id = v_aqui)
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

revoke execute on function
  public.registrar_devolucion_de_venta(uuid, text, jsonb, uuid, text),
  public.registrar_reembolso_de_venta(uuid, text, numeric, text, text),
  public.devolucion_de_venta(uuid)
from public, anon;

grant execute on function
  public.registrar_devolucion_de_venta(uuid, text, jsonb, uuid, text),
  public.registrar_reembolso_de_venta(uuid, text, numeric, text, text),
  public.devolucion_de_venta(uuid)
to authenticated;

-- ─────────────────────────────────────────────────────────
-- LOS REPORTES DE CAJA
-- ─────────────────────────────────────────────────────────
/*
  Los de la 0049 suman ahora también los reembolsos de devoluciones (el
  efectivo baja la caja de la ubicación que facturó) y lo que queda a favor
  de clientes por devoluciones (no baja ninguna caja hasta devolverse). Sin
  devoluciones, dan exactamente lo mismo.
*/
create or replace function public.reembolsos_de_pedidos_del_dia(p_dia date, p_ubicacion uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.fila order by x.fecha, x.id), '[]'::jsonb)
    from (
      select r.id, r.reembolsado_en as fecha,
             jsonb_build_object('id', r.id, 'fecha', r.reembolsado_en, 'pedido_id', p.id, 'pedido', p.numero, 'cliente', p.nombre_cliente,
                                'medio', r.medio, 'importe', r.importe, 'ubicacion_id', r.ubicacion_id, 'ubicacion', u.nombre,
                                'referencia', r.referencia, 'usuario', r.usuario_nombre) as fila
        from public.reembolsos_de_pedido r
        join public.pedidos_ubicacion p on p.id = r.pedido_id
        left join public.ubicaciones u on u.id = r.ubicacion_id
       where r.empresa_id = public.empresa_del_usuario()
         and r.reembolsado_en >= p_dia::timestamp at time zone 'America/Tegucigalpa'
         and r.reembolsado_en < (p_dia + 1)::timestamp at time zone 'America/Tegucigalpa'
         and (p_ubicacion is null or r.ubicacion_id = p_ubicacion)
      union all
      select r.id, r.reembolsado_en,
             jsonb_build_object('id', r.id, 'fecha', r.reembolsado_en, 'venta_id', v.id, 'pedido', v.numero_factura, 'cliente', v.nombre_cliente,
                                'medio', r.medio, 'importe', r.importe, 'ubicacion_id', r.ubicacion_id, 'ubicacion', u.nombre,
                                'referencia', r.referencia, 'usuario', r.usuario_nombre, 'devolucion', true)
        from public.reembolsos_de_venta r
        join public.ventas v on v.id = r.venta_id
        left join public.ubicaciones u on u.id = r.ubicacion_id
       where r.empresa_id = public.empresa_del_usuario()
         and r.reembolsado_en >= p_dia::timestamp at time zone 'America/Tegucigalpa'
         and r.reembolsado_en < (p_dia + 1)::timestamp at time zone 'America/Tegucigalpa'
         and (p_ubicacion is null or r.ubicacion_id = p_ubicacion)
    ) x
   where coalesce(public.usuario_es_admin(), false)
$$;

create or replace function public.reembolsos_de_pedidos_pendientes(p_ubicacion uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(public.usuario_es_admin(), false) then
           coalesce((
             select sum(d.pendiente)
               from public.cancelaciones_de_pedido c
               join public.pedidos_ubicacion p on p.id = c.pedido_id
              cross join lateral public.dinero_a_devolver(c.pedido_id) d
              where c.empresa_id = public.empresa_del_usuario() and (p_ubicacion is null or p.origen_id = p_ubicacion)
           ), 0)
         + coalesce((
             select sum((public.dinero_de_la_venta(v.id)->>'pendiente')::numeric)
               from public.ventas v
              where v.empresa_id = public.empresa_del_usuario()
                and exists (select 1 from public.devoluciones_de_venta d where d.venta_id = v.id)
                and (p_ubicacion is null or v.ubicacion_id = p_ubicacion)
           ), 0)
         else 0 end
$$;
