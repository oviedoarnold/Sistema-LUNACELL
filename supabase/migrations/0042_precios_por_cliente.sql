-- Productos habituales y precios especiales por cliente.
--
-- Cada cliente puede tener un precio propio por producto. Sin él, vale el precio
-- general. El servidor decide el precio de cada venta: no llega del navegador.
--
-- Solo el administrador los cambia, y solo con guardar_precios_de_cliente(): todo
-- o nada. El resto de la empresa los lee, porque el POS y la copia sin conexión los
-- necesitan; no incluyen costos.
--
-- Las ventas ya hechas no cambian: cada renglón guarda su precio.
--
-- Una venta sin conexión con un precio que ya no vale va a conciliación, como hoy
-- con el precio general: el total cobrado no cambia en silencio.
--
-- Va antes que su frontend. La versión publicada sigue funcionando: mientras un
-- cliente no tenga precios especiales, todo se vende al precio general.

-- ─────────────────────────────────────────────────────────
-- LOS PRECIOS
-- ─────────────────────────────────────────────────────────
create table if not exists public.precios_por_cliente (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id),
  cliente_id     uuid not null references public.clientes (id) on delete cascade,
  producto_id    uuid not null references public.productos (id),
  precio         numeric(12,2) not null check (precio > 0),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint precios_por_cliente_unico unique (cliente_id, producto_id)
);

create index if not exists precios_por_cliente_empresa on public.precios_por_cliente (empresa_id);
create index if not exists precios_por_cliente_producto on public.precios_por_cliente (producto_id);

alter table public.precios_por_cliente enable row level security;

revoke all on public.precios_por_cliente from public, anon, authenticated, service_role;
grant select on public.precios_por_cliente to authenticated, service_role;

drop policy if exists precios_por_cliente_lectura on public.precios_por_cliente;
create policy precios_por_cliente_lectura on public.precios_por_cliente
  for select to authenticated
  using (empresa_id = public.empresa_del_usuario());

-- El contador no escribe en ninguna tabla (0036).
drop trigger if exists impedir_escritura_del_contador on public.precios_por_cliente;
create trigger impedir_escritura_del_contador
  before insert or update or delete or truncate on public.precios_por_cliente
  for each statement
  execute function public.impedir_escritura_del_contador();

-- ─────────────────────────────────────────────────────────
-- EL PRECIO DE UNA VENTA
-- ─────────────────────────────────────────────────────────
-- El especial del cliente o, si no tiene, el general. El mismo cálculo que el POS.
create or replace function public.precio_de_venta(p_empresa uuid, p_cliente uuid, p_producto uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.precio from public.precios_por_cliente e
      where e.empresa_id = p_empresa and e.cliente_id = p_cliente and e.producto_id = p_producto),
    (select p.precio from public.productos p
      where p.empresa_id = p_empresa and p.id = p_producto)
  )
$$;

revoke execute on function public.precio_de_venta(uuid, uuid, uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- GUARDAR
-- ─────────────────────────────────────────────────────────
/*
  La lista completa de un cliente, en una transacción: lo que no viene se quita.
  Errores: LP001, datos mal formados; 42501, sin permiso.
*/
create or replace function public.guardar_precios_de_cliente(p_cliente uuid, p_precios jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := public.empresa_del_usuario();
  v_fila    jsonb;
  v_precio  numeric;
  v_vistos  uuid[] := '{}';
  v_prod    uuid;
begin
  if not coalesce(public.usuario_es_admin(), false) or v_empresa is null then
    raise exception 'Solo un administrador cambia los precios especiales' using errcode = '42501';
  end if;

  if not exists (select 1 from public.clientes c where c.id = p_cliente and c.empresa_id = v_empresa) then
    raise exception 'El cliente no existe en esta empresa' using errcode = '42501';
  end if;

  if jsonb_typeof(p_precios) is distinct from 'array' then
    raise exception 'La lista de precios no es válida' using errcode = 'LP001';
  end if;

  for v_fila in select * from jsonb_array_elements(p_precios) loop
    begin
      v_prod   := (v_fila->>'producto_id')::uuid;
      v_precio := (v_fila->>'precio')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Un precio de la lista no es válido' using errcode = 'LP001';
    end;

    if v_prod is null or not exists (
      select 1 from public.productos p where p.id = v_prod and p.empresa_id = v_empresa
    ) then
      raise exception 'Un producto de la lista no existe en esta empresa' using errcode = 'LP001';
    end if;

    if v_prod = any (v_vistos) then
      raise exception 'Un producto no puede estar dos veces en la lista' using errcode = 'LP001';
    end if;

    v_vistos := v_vistos || v_prod;

    if v_precio is null or v_precio <= 0 or v_precio <> round(v_precio, 2) or v_precio >= 10000000000 then
      raise exception 'Cada precio debe ser mayor que cero y tener hasta dos decimales' using errcode = 'LP001';
    end if;

    insert into public.precios_por_cliente (empresa_id, cliente_id, producto_id, precio)
    values (v_empresa, p_cliente, v_prod, v_precio)
    on conflict (cliente_id, producto_id) do update
      set precio = excluded.precio, actualizado_en = now()
      where public.precios_por_cliente.precio <> excluded.precio;
  end loop;

  delete from public.precios_por_cliente e
   where e.cliente_id = p_cliente
     and e.empresa_id = v_empresa
     and e.producto_id <> all (v_vistos);

  return cardinality(v_vistos);
end $$;

revoke execute on function public.guardar_precios_de_cliente(uuid, jsonb) from public, anon;
grant execute on function public.guardar_precios_de_cliente(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────
-- VENDER
-- ─────────────────────────────────────────────────────────
/*
  La misma función de la 0017, con el precio de precio_de_venta() en vez del de
  productos. El candado, la existencia, los correlativos y la idempotencia no cambian.
*/
create or replace function registrar_venta_ubicacion(
  p_items jsonb,
  p_forma_pago text default 'contado',
  p_cliente_id uuid default null,
  p_nombre_cliente text default null,
  p_rtn_comprador text default '',
  p_fecha_vencimiento date default null,
  p_nota text default '',
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_empresa      uuid;
  v_usuario      uuid;
  v_ubicacion    uuid;
  v_ubic         record;
  v_emp          record;
  v_venta        record;
  v_item         record;
  v_producto     record;
  v_disponible   integer;
  v_correlativo  bigint;
  v_numero       text;
  v_fiscal       boolean;
  v_subtotal     numeric(12,2) := 0;
  v_isv          numeric(12,2);
  v_total        numeric(12,2);
  v_tasa         numeric(5,2);
  v_credito      boolean;
  v_venta_id     uuid;
  v_pedido       jsonb;
  v_huella       text;
  v_huella_vieja text;
  v_forma        text := coalesce(p_forma_pago, 'contado');
begin
  /*
    SECURITY DEFINER es necesario y hay que decir por qué, porque apaga
    RLS: la función escribe en ventas, detalle_venta,
    movimientos_inventario e inventario_ubicacion dentro de una sola
    transacción, y esa última tiene revocada la escritura para
    `authenticated` desde la 0014 precisamente para que solo se toque
    desde aquí.

    Como apaga RLS, la empresa NO se acepta como parámetro: se deriva del
    usuario autenticado con la misma función que usan todas las políticas
    del esquema. Es el mismo criterio de registrar_pago_cliente().
  */
  v_empresa := empresa_del_usuario();

  if v_empresa is null then
    raise exception 'Solo un usuario activo de una empresa puede registrar ventas'
      using errcode = '42501';
  end if;

  select id, ubicacion_id into v_usuario, v_ubicacion
    from usuarios
   where auth_id = auth.uid()
     and activo
   limit 1;

  -- ── la ubicación desde la que se vende ──
  /*
    No llega del navegador: se lee del usuario. Un vendedor no puede
    elegir otro camión porque no hay dónde pedirlo.
  */
  if v_ubicacion is null then
    raise exception
      'No tienes una ubicación operativa asignada. Pide que te asignen desde dónde trabajas antes de facturar.'
      using errcode = 'LV001';
  end if;

  select id, nombre, tipo, activa, vende, emite_fiscal into v_ubic
    from ubicaciones
   where id = v_ubicacion
     and empresa_id = v_empresa;

  if not found then
    raise exception 'La ubicación operativa no pertenece a tu empresa'
      using errcode = '42501';
  end if;

  if not v_ubic.activa then
    raise exception
      'La ubicación «%» está desactivada y no puede facturar. Pide que la activen o que te asignen otra.',
      v_ubic.nombre
      using errcode = 'LV002';
  end if;

  /*
    INV-3.2 (1): la ubicación tiene que poder vender.

    Es la regla que la 0016 dejó señalada y sin implementar porque no
    existía dónde expresarla. Ahora existe, y no se decide por tipo ni por
    nombre: se lee la marca.
  */
  if not v_ubic.vende then
    raise exception
      'La ubicación «%» no está habilitada para vender.',
      v_ubic.nombre
      using errcode = 'LV008';
  end if;

  -- ── la intención ──
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene renglones'
      using errcode = 'LV003';
  end if;

  if v_forma not in ('contado', 'credito') then
    raise exception 'Forma de pago desconocida: %', v_forma
      using errcode = 'LV003';
  end if;

  v_credito := v_forma = 'credito';

  if v_credito and p_cliente_id is null then
    raise exception
      'Para una venta a crédito debes seleccionar un cliente registrado'
      using errcode = 'LV004';
  end if;

  if p_cliente_id is not null
     and not exists (
       select 1 from clientes
        where id = p_cliente_id and empresa_id = v_empresa
     ) then
    raise exception 'El cliente no existe en esta empresa'
      using errcode = '42501';
  end if;

  /*
    Los renglones se agrupan por producto antes de nada.

    Si el mismo producto llega dos veces —dos líneas de 3 en vez de una de
    6— tratarlas por separado tomaría el candado de la misma celda dos
    veces y comprobaría 3 contra la existencia las dos veces: con 4
    unidades pasarían ambas y se venderían 6 de 4. Sumarlas primero hace
    que la comprobación sea sobre lo que de verdad se lleva el cliente.
  */
  select coalesce(
           jsonb_agg(
             jsonb_build_object('producto_id', pid, 'cantidad', qty)
             order by pid
           ),
           '[]'::jsonb
         )
    into v_pedido
    from (
      select (item->>'producto_id')::uuid as pid,
             sum((item->>'cantidad')::integer) as qty
        from jsonb_array_elements(p_items) as item
       group by 1
    ) agrupado;

  if exists (
    select 1 from jsonb_array_elements(v_pedido) e
     where (e->>'cantidad')::integer <= 0
  ) then
    raise exception 'La cantidad de cada producto debe ser mayor que cero'
      using errcode = 'LV003';
  end if;

  -- ── ¿ya se registró este mismo intento? ──
  /*
    La huella resume la intención: forma de pago, cliente y qué productos
    en qué cantidades. Un reintento legítimo trae la misma; reutilizar la
    clave para otra venta no es un reintento sino un error de quien llama,
    y devolverle la venta vieja se lo disfrazaría de éxito.

    La huella de la venta ya guardada se reconstruye de su detalle, así
    que no hace falta guardarla en ninguna columna nueva.
  */
  if p_clave_idempotencia is not null then
    select v_forma || '|' || coalesce(p_cliente_id::text, '-') || '|' ||
           string_agg(
             (e->>'producto_id') || 'x' || (e->>'cantidad'),
             ',' order by (e->>'producto_id')
           )
      into v_huella
      from jsonb_array_elements(v_pedido) e;

    select * into v_venta
      from ventas
     where empresa_id = v_empresa
       and clave_idempotencia = p_clave_idempotencia;

    if found then
      select v_venta.forma_pago || '|' ||
             coalesce(v_venta.cliente_id::text, '-') || '|' ||
             string_agg(
               producto_id::text || 'x' || cantidad::text,
               ',' order by producto_id::text
             )
        into v_huella_vieja
        from detalle_venta
       where venta_id = v_venta.id;

      if v_huella_vieja is distinct from v_huella then
        raise exception
          'La clave % ya se usó para una venta distinta de esta empresa',
          p_clave_idempotencia
          using errcode = 'LV005';
      end if;

      return jsonb_build_object(
        'venta_id',       v_venta.id,
        'numero_factura', v_venta.numero_factura,
        'correlativo',    v_venta.correlativo,
        'ubicacion_id',   v_venta.ubicacion_id,
        'es_fiscal',      v_venta.es_fiscal,
        'subtotal',       v_venta.subtotal,
        'isv',            v_venta.isv,
        'total',          v_venta.total,
        'repetida',       true
      );
    end if;
  end if;

  -- ── el inventario, bajo candado ──
  /*
    El orden es por producto_id y no es cosmético: dos ventas que tomen
    las mismas celdas en orden distinto se bloquean mutuamente para
    siempre. Con un orden fijo, la segunda espera a la primera y sigue.

    El candado se toma sobre la celda de ESTA ubicación. Si no hay celda,
    no hay existencia: no se busca en otra bodega ni se completa desde
    otro camión. Eso sería un traslado, y los traslados son de INV-4.
  */
  for v_item in
    select (e->>'producto_id')::uuid as producto_id,
           (e->>'cantidad')::integer as cantidad
      from jsonb_array_elements(v_pedido) e
     order by (e->>'producto_id')
  loop
    select id, nombre, precio into v_producto
      from productos
     where id = v_item.producto_id
       and empresa_id = v_empresa
       and activo;

    if not found then
      raise exception 'Uno de los productos no existe o está inactivo'
        using errcode = 'LV006';
    end if;

    v_producto.precio := precio_de_venta(v_empresa, p_cliente_id, v_item.producto_id);

    select cantidad into v_disponible
      from inventario_ubicacion
     where ubicacion_id = v_ubicacion
       and producto_id = v_item.producto_id
       for update;

    if v_disponible is null or v_disponible < v_item.cantidad then
      raise exception
        'No hay suficiente «%» en %: hay %, se piden %',
        v_producto.nombre,
        v_ubic.nombre,
        coalesce(v_disponible, 0),
        v_item.cantidad
        using errcode = 'LV007';
    end if;

    v_subtotal := v_subtotal + round(v_producto.precio * v_item.cantidad, 2);
  end loop;

  -- ── los importes, calculados aquí ──
  /*
    El precio sale de precio_de_venta() y la tasa de empresas. Ninguno de los
    dos llega del navegador, así que manipular el payload no abarata nada.
  */
  select * into v_emp from empresas where id = v_empresa;

  v_tasa     := coalesce(v_emp.tasa_isv, 15);
  v_subtotal := round(v_subtotal, 2);
  v_isv      := round(v_subtotal * v_tasa / 100, 2);
  v_total    := round(v_subtotal + v_isv, 2);

  -- ── ¿factura autorizada o documento interno? ──
  /*
    INV-3.2 (2): la decisión, y no la toma quien llama.

    No hay ningún parámetro con el que pedir que una venta sea fiscal: se
    deduce de dónde sale y de si la empresa tiene la numeración autorizada
    configurada. Las dos condiciones, no una:

    - la ubicación tiene que estar marcada como emisora. Como mucho hay
      una por empresa, y nace sin marcar.

    - la configuración tiene que estar completa. Son las mismas tres
      condiciones que isFiscalConfigured() en el frontend —CAI, rango y
      fecha límite— y están aquí para que una marca puesta antes de tener
      el CAI no produzca una factura con el CAI vacío.

    Hoy, sin CAI configurado, esto da falso siempre: todas las ventas
    salen internas, incluida la de la tienda. Es lo correcto, y es también
    lo que hace que esta migración no cambie el comportamiento actual.
  */
  v_fiscal := v_ubic.emite_fiscal
          and coalesce(btrim(coalesce(v_emp.cai, '')), '') <> ''
          and coalesce(v_emp.rango_hasta, 0) > 0
          and v_emp.fecha_limite_emision is not null;

  /*
    INV-3.2 (3): cada documento pide su número a su propio contador.

    Aquí vive la invariante: una venta interna llama a
    siguiente_correlativo('interno'), que toca otra columna. No existe un
    camino por el que una venta no fiscal avance el contador autorizado,
    porque no lo nombra.

    Los dos se piden DENTRO de la transacción, así que un fallo posterior
    devuelve también el contador, igual que en la 0016.
  */
  if v_fiscal then
    v_correlativo := siguiente_correlativo('factura');

    v_numero := numero_de_factura(
      v_correlativo,
      v_emp.cai,
      v_emp.rango_hasta,
      v_emp.fecha_limite_emision,
      v_emp.establecimiento,
      v_emp.punto_emision,
      v_emp.tipo_documento
    );
  else
    v_correlativo := siguiente_correlativo('interno');
    v_numero      := numero_interno(v_correlativo);
  end if;

  -- ── la factura ──
  /*
    INV-3.2 (4): los datos fiscales solo se sellan si la venta lo es.

    Un documento interno guarda CAI vacío y rangos nulos, que es lo que
    de verdad ocurrió. La 0016 los copiaba siempre.
  */
  insert into ventas (
    empresa_id, cliente_id, usuario_id, ubicacion_id,
    numero_factura, correlativo, es_fiscal,
    nombre_cliente, rtn_comprador,
    subtotal, isv, tasa_isv, total,
    forma_pago, fecha_vencimiento, estado,
    cai_emision, rango_desde_emision, rango_hasta_emision,
    fecha_limite_emision_emision,
    nota, clave_idempotencia
  ) values (
    v_empresa, p_cliente_id, v_usuario, v_ubicacion,
    v_numero, v_correlativo, v_fiscal,
    coalesce(nullif(btrim(coalesce(p_nombre_cliente, '')), ''), 'Consumidor Final'),
    coalesce(p_rtn_comprador, ''),
    v_subtotal, v_isv, v_tasa, v_total,
    v_forma,
    case when v_credito then p_fecha_vencimiento else null end,
    case when v_credito then 'pendiente' else 'pagada' end,
    case when v_fiscal then coalesce(v_emp.cai, '') else '' end,
    case when v_fiscal then v_emp.rango_desde else null end,
    case when v_fiscal then v_emp.rango_hasta else null end,
    case when v_fiscal then v_emp.fecha_limite_emision else null end,
    coalesce(p_nota, ''), p_clave_idempotencia
  )
  returning id into v_venta_id;

  -- ── el detalle, el descuento y el Kardex ──
  for v_item in
    select (e->>'producto_id')::uuid as producto_id,
           (e->>'cantidad')::integer as cantidad
      from jsonb_array_elements(v_pedido) e
     order by (e->>'producto_id')
  loop
    select nombre, codigo, precio into v_producto
      from productos where id = v_item.producto_id;

    v_producto.precio := precio_de_venta(v_empresa, p_cliente_id, v_item.producto_id);

    insert into detalle_venta (
      empresa_id, venta_id, producto_id, nombre, codigo,
      cantidad, precio, subtotal
    ) values (
      v_empresa, v_venta_id, v_item.producto_id,
      v_producto.nombre, coalesce(v_producto.codigo, ''),
      v_item.cantidad, v_producto.precio,
      round(v_producto.precio * v_item.cantidad, 2)
    );

    /*
      La existencia baja en la celda de esta ubicación. El check
      cantidad >= 0 de la 0014 queda como última red: aunque esta función
      se escribiera mal, la fila no entraría en negativo.
    */
    update inventario_ubicacion
       set cantidad = cantidad - v_item.cantidad,
           actualizado_en = now()
     where ubicacion_id = v_ubicacion
       and producto_id = v_item.producto_id;

    insert into movimientos_inventario (
      empresa_id, producto_id, usuario_id, venta_id,
      ubicacion_id, tipo, cantidad, motivo
    ) values (
      v_empresa, v_item.producto_id, v_usuario, v_venta_id,
      v_ubicacion, 'salida', -v_item.cantidad, 'Venta'
    );
  end loop;

  return jsonb_build_object(
    'venta_id',       v_venta_id,
    'numero_factura', v_numero,
    'correlativo',    v_correlativo,
    'ubicacion_id',   v_ubicacion,
    'es_fiscal',      v_fiscal,
    'subtotal',       v_subtotal,
    'isv',            v_isv,
    'total',          v_total,
    'repetida',       false
  );
end $$;

-- ─────────────────────────────────────────────────────────
-- SIN CONEXIÓN
-- ─────────────────────────────────────────────────────────
/*
  La misma función de la 0041, comparando con el precio que corresponde a ese
  cliente. Si no coincide, va a conciliación y conserva lo cobrado, como antes.
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
  v_desfase   integer;
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
    El reloj del teléfono: cuánto difería del servidor al enviar. La fecha
    oficial es siempre la declarada; si el desfase pasa de 10 minutos no se
    adivina cuál era la hora real: la venta va a conciliación.
  */
  v_desfase := round(extract(epoch from now() - p_reloj_dispositivo))::integer;

  select vende_sin_conexion, activa, vende into v_ubic from ubicaciones where id = p_ubicacion_id;

  v_motivo := case
    when not v_usuario.activo or v_usuario.debe_cambiar_contrasena then 'usuario-inactivo'
    when not usuario_tiene_permiso('pos') then 'sin-permiso'
    when v_usuario.ubicacion_id is distinct from p_ubicacion_id then 'ubicacion-cambiada'
    when not (v_ubic.vende_sin_conexion and v_ubic.activa and v_ubic.vende) then 'ubicacion-no-habilitada'
    when p_registrada_en > p_reloj_dispositivo + interval '1 minute'
      or p_registrada_en > now() + interval '10 minutes'
      or p_registrada_en < now() - interval '7 days' then 'fecha-fuera-de-rango'
    when abs(v_desfase) > 600 then 'reloj-desfasado'
    when p_cliente_id is not null and not exists (
      select 1 from clientes c where c.id = p_cliente_id and c.empresa_id = v_usuario.empresa_id
    ) then 'cliente-invalido'
    when exists (
      select 1 from jsonb_array_elements(p_renglones) r
       where not exists (
         select 1 from productos p
          where p.id = (r->>'producto_id')::uuid and p.empresa_id = v_usuario.empresa_id and p.activo)
    ) then 'producto-invalido'
    when (round(p_tasa_isv, 2) <> 0 and round(p_tasa_isv, 2) is distinct from (select coalesce(e.tasa_isv, 15) from empresas e where e.id = v_usuario.empresa_id))
      or exists (
        select 1 from jsonb_array_elements(p_renglones) r
          join productos p on p.id = (r->>'producto_id')::uuid
         where precio_de_venta(v_usuario.empresa_id, p_cliente_id, p.id) <> (r->>'precio_unitario')::numeric
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

      -- Vendida sin ISV: registrar_venta_ubicacion() siempre lo calcula.
      if round(p_tasa_isv, 2) = 0 and (v_resultado->>'isv')::numeric <> 0 then
        perform quitar_isv_de_venta((v_resultado->>'venta_id')::uuid);
        v_resultado := v_resultado || jsonb_build_object('total', v_resultado->'subtotal', 'isv', 0);
      end if;

      if (v_resultado->>'total')::numeric is distinct from round(p_total_cobrado, 2) then
        raise exception 'El total registrado (%) no coincide con el cobrado (%)', v_resultado->>'total', p_total_cobrado
          using errcode = 'OF009';
      end if;

      update ventas
         set fecha              = p_registrada_en,
             origen             = 'sin_conexion',
             dispositivo        = p_dispositivo,
             numero_provisional = p_numero_provisional,
             registrada_en      = p_registrada_en,
             recibida_en        = now(),
             reloj_dispositivo  = p_reloj_dispositivo,
             desfase_segundos   = v_desfase,
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
      when sqlstate 'LV003' or sqlstate 'LV005' or sqlstate 'LV009' or sqlstate '42501' then
        v_motivo := 'otro-negocio'; v_codigo := sqlstate; v_detalle := sqlerrm;
    end;
  end if;

  v_detalle := coalesce(v_detalle, case v_motivo
    when 'usuario-inactivo' then 'El vendedor está desactivado o tiene un cambio de contraseña pendiente'
    when 'sin-permiso' then 'El vendedor ya no tiene permiso para facturar'
    when 'ubicacion-cambiada' then 'El vendedor ya no está asignado a la ubicación de la venta'
    when 'ubicacion-no-habilitada' then 'La ubicación no está habilitada para vender sin conexión'
    when 'fecha-fuera-de-rango' then 'La fecha de la venta está fuera del rango aceptado'
    when 'reloj-desfasado' then 'El reloj del teléfono difería más de 10 minutos del servidor'
    when 'cliente-invalido' then 'El cliente de la venta no existe en la empresa'
    when 'producto-invalido' then 'Uno de los productos no existe o está inactivo'
    when 'precio-distinto' then 'El precio o el impuesto cambiaron desde la venta'
  end);

  v_id := guardar_venta_por_conciliar(
    v_venta, v_usuario.empresa_id, v_usuario.id, v_huella, v_desfase,
    v_motivo, v_codigo, v_detalle, 'vendedor', null);

  return jsonb_build_object(
    'estado', 'en_conciliacion', 'conciliacion_id', v_id, 'motivo', v_motivo, 'detalle', v_detalle);
end $$;
