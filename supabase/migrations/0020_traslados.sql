-- Traslados de existencia entre ubicaciones.
--
-- Hasta aquí la existencia solo entraba a una ubicación (entradas y
-- ajustes, 0018) o salía de ella (ventas, 0017). No había forma de pasar
-- unidades de la bodega a la tienda o a un camión, ni de que un camión
-- devolviera lo que no vendió.
--
-- Un traslado es UNA operación con dos lados: descuenta el origen y suma
-- al destino en la misma transacción, y deja en el libro una salida y una
-- entrada por producto, ligadas a una cabecera que dice quién lo hizo,
-- cuándo, desde dónde, hacia dónde y por qué.
--
-- Lo que NO trae: número visible del traslado, envío y recepción en dos
-- pasos, mercadería en tránsito, cancelaciones ni la existencia por
-- ubicación en el punto de venta (INV-3.4). Un traslado equivocado no se
-- edita ni se borra: se corrige con otro en sentido contrario.
--
-- Se aplica ANTES de desplegar el frontend de INV-4: solo agrega, así que
-- el frontend actual no la nota, y el nuevo la necesita desde el primer
-- traslado.

-- ─────────────────────────────────────────────────────────
-- LA CABECERA
-- ─────────────────────────────────────────────────────────
/*
  Origen y destino llevan la empresa dentro de la llave, como el
  inventario de la 0014: la función que escribe es SECURITY DEFINER y pasa
  por encima de RLS, así que es la llave la que impide cruzar empresas.

  Sin `on delete` en las ubicaciones: no se puede borrar una ubicación con
  traslados, que es lo que se quiere. Las ubicaciones se desactivan.

  `estado` tiene hoy un solo valor. Está para que el día que haga falta
  otro —enviado, recibido— no haya que migrar los traslados existentes.
*/
create table if not exists traslados (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas (id) on delete cascade,
  origen_id          uuid not null,
  destino_id         uuid not null,
  usuario_id         uuid references usuarios (id) on delete set null,
  estado             text not null default 'aplicado'
                       check (estado in ('aplicado')),
  nota               text not null default '',
  clave_idempotencia text,
  creado_en          timestamptz not null default now(),

  constraint traslado_origen_distinto_destino check (origen_id <> destino_id),

  constraint traslado_origen_de_mi_empresa
    foreign key (origen_id, empresa_id)
    references ubicaciones (id, empresa_id),

  constraint traslado_destino_de_mi_empresa
    foreign key (destino_id, empresa_id)
    references ubicaciones (id, empresa_id)
);

/*
  El par (id, empresa) para que el detalle y los movimientos apunten a la
  cabecera de SU empresa, con la misma técnica que productos y ubicaciones.
*/
create unique index if not exists traslados_id_empresa
  on traslados (id, empresa_id);

/*
  Un reintento con la misma clave encuentra el traslado que ya existe en
  vez de mover dos veces. Por empresa, porque la clave la genera cada
  navegador y dos empresas no tienen por qué no repetirla.
*/
create unique index if not exists traslados_clave_por_empresa
  on traslados (empresa_id, clave_idempotencia)
  where clave_idempotencia is not null;

create index if not exists idx_traslados_empresa_fecha
  on traslados (empresa_id, creado_en desc);

-- ─────────────────────────────────────────────────────────
-- QUÉ SE TRASLADÓ
-- ─────────────────────────────────────────────────────────
/*
  Un producto aparece una sola vez por traslado: los renglones repetidos
  se suman antes de guardar, igual que en la venta. Por eso la llave es
  (traslado, producto) y no un id propio.
*/
create table if not exists traslado_detalle (
  traslado_id uuid not null,
  empresa_id  uuid not null,
  producto_id uuid not null,
  cantidad    integer not null check (cantidad > 0),

  primary key (traslado_id, producto_id),

  constraint detalle_de_mi_traslado
    foreign key (traslado_id, empresa_id)
    references traslados (id, empresa_id) on delete cascade,

  constraint detalle_producto_de_mi_empresa
    foreign key (producto_id, empresa_id)
    references productos (id, empresa_id) on delete cascade
);

-- ─────────────────────────────────────────────────────────
-- EL LIBRO RECONOCE LOS TRASLADOS
-- ─────────────────────────────────────────────────────────
/*
  Dos tipos nuevos en vez de reutilizar `salida` y `entrada`: el Kardex
  tiene que distinguir lo que salió vendido de lo que salió hacia otra
  ubicación, y lo que entró comprado o cargado de lo que entró de otra
  ubicación. Los cuatro tipos de antes siguen valiendo: las filas que ya
  existen se revisan al crear la restricción y todas la cumplen.
*/
alter table movimientos_inventario
  drop constraint if exists movimientos_inventario_tipo_check;

alter table movimientos_inventario
  add constraint movimientos_inventario_tipo_check
  check (tipo in (
    'entrada', 'salida', 'ajuste', 'devolucion',
    'traslado_salida', 'traslado_entrada'
  ));

/*
  Qué traslado causó el movimiento, como venta_id dice qué venta. Nulo en
  todo lo que no sea un traslado, incluidos los movimientos históricos.
*/
alter table movimientos_inventario
  add column if not exists traslado_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'movimientos_traslado_de_mi_empresa'
       and conrelid = 'movimientos_inventario'::regclass
  ) then
    alter table movimientos_inventario
      add constraint movimientos_traslado_de_mi_empresa
      foreign key (traslado_id, empresa_id)
      references traslados (id, empresa_id);
  end if;
end $$;

create index if not exists idx_movimientos_traslado
  on movimientos_inventario (traslado_id)
  where traslado_id is not null;

-- ─────────────────────────────────────────────────────────
-- QUIÉN LEE Y QUIÉN ESCRIBE
-- ─────────────────────────────────────────────────────────
/*
  Escribe solo registrar_traslado(). La tabla no se edita ni se borra
  desde fuera: un traslado equivocado se corrige con otro inverso.

  Se lee con la misma regla que el inventario: un traslado se ve si se ve
  su origen o su destino. El vendedor del Camión 01 ve lo que entró y
  salió de su camión, y no lo que se movió entre la bodega y la tienda.
  El detalle sigue a su cabecera: la subconsulta pasa por la RLS de
  traslados.
*/
alter table traslados enable row level security;
alter table traslado_detalle enable row level security;

drop policy if exists traslados_visibles on traslados;
create policy traslados_visibles on traslados
  for select
  to authenticated
  using (
    empresa_id = empresa_del_usuario()
    and (usuario_ve_ubicacion(origen_id) or usuario_ve_ubicacion(destino_id))
  );

drop policy if exists traslado_detalle_visible on traslado_detalle;
create policy traslado_detalle_visible on traslado_detalle
  for select
  to authenticated
  using (
    exists (select 1 from traslados t where t.id = traslado_detalle.traslado_id)
  );

revoke all on traslados from anon, authenticated;
revoke all on traslado_detalle from anon, authenticated;
grant select on traslados to authenticated;
grant select on traslado_detalle to authenticated;

-- ─────────────────────────────────────────────────────────
-- EL TRASLADO
-- ─────────────────────────────────────────────────────────
create or replace function registrar_traslado(
  p_origen             uuid,
  p_destino            uuid,
  p_items              jsonb,
  p_nota               text default '',
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
  v_propia       uuid;
  v_todas        boolean;
  v_origen       record;
  v_destino      record;
  v_pedido       jsonb;
  v_item         record;
  v_producto     record;
  v_disponible   integer;
  v_traslado     uuid;
  v_previo       record;
  v_huella       text;
  v_huella_vieja text;
begin
  /*
    SECURITY DEFINER porque escribe en inventario_ubicacion,
    movimientos_inventario y las tablas de traslados, que `authenticated`
    no puede tocar. Como eso apaga RLS, la empresa y el usuario no se
    aceptan como parámetro: se derivan de la sesión.
  */
  v_empresa := empresa_del_usuario();

  if v_empresa is null then
    raise exception 'Solo un usuario activo de una empresa puede trasladar inventario'
      using errcode = '42501';
  end if;

  select id, ubicacion_id into v_usuario, v_propia
    from usuarios
   where auth_id = auth.uid()
     and activo
   limit 1;

  -- ── la forma del pedido ──
  if p_origen is null or p_destino is null then
    raise exception 'Falta la ubicación de origen o la de destino'
      using errcode = 'LT003';
  end if;

  if p_origen = p_destino then
    raise exception 'El origen y el destino del traslado son la misma ubicación'
      using errcode = 'LT001';
  end if;

  /*
    Cada renglón tiene que traer un identificador y una cantidad entera
    positiva. Se comprueba con expresiones y no convirtiendo, para que un
    dato mal formado sea un rechazo con su código y no un error de tipos.
  */
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or exists (
          select 1 from jsonb_array_elements(p_items) e
           where jsonb_typeof(e) <> 'object'
              or coalesce(e->>'producto_id', '') !~*
                   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              or coalesce(e->>'cantidad', '') !~ '^[1-9][0-9]{0,8}$'
        ) then
    raise exception 'Los renglones del traslado no son válidos'
      using errcode = 'LT003';
  end if;

  -- Los renglones del mismo producto son un solo movimiento de mercadería.
  select jsonb_agg(
           jsonb_build_object('producto_id', pid, 'cantidad', qty)
           order by pid
         )
    into v_pedido
    from (
      select (e->>'producto_id')::uuid as pid,
             sum((e->>'cantidad')::integer) as qty
        from jsonb_array_elements(p_items) e
       group by 1
    ) agrupado;

  -- ── dónde ──
  select id, nombre, activa into v_origen
    from ubicaciones where id = p_origen and empresa_id = v_empresa;

  select id, nombre, activa into v_destino
    from ubicaciones where id = p_destino and empresa_id = v_empresa;

  if v_origen.id is null or v_destino.id is null then
    raise exception 'La ubicación no pertenece a tu empresa'
      using errcode = '42501';
  end if;

  if not v_origen.activa or not v_destino.activa then
    raise exception
      'La ubicación «%» está desactivada y no puede enviar ni recibir traslados.',
      case when not v_origen.activa then v_origen.nombre else v_destino.nombre end
      using errcode = 'LT002';
  end if;

  /*
    Quién puede trasladar desde dónde (D1 y D3):

    - quien ve todas las ubicaciones —el administrador o inventory-all—
      traslada entre cualquier par de ubicaciones activas de su empresa;
    - quien solo ve la suya —inventory-own— traslada únicamente DESDE su
      ubicación operativa, hacia cualquier otra activa: así un camión
      devuelve a la bodega aunque la bodega no la pueda consultar.

    No se crea un permiso aparte: son los mismos que ya deciden qué
    inventario ve cada quien.
  */
  v_todas := usuario_tiene_permiso('inventory-all');

  if not v_todas then
    if not usuario_tiene_permiso('inventory-own')
       or v_propia is null
       or v_propia <> p_origen then
      raise exception 'Solo puedes trasladar desde tu propia ubicación operativa'
        using errcode = '42501';
    end if;
  end if;

  -- ── qué ──
  /*
    Se busca sin filtrar por empresa para distinguir «no existe» de «es de
    otra empresa», como en la 0018.
  */
  for v_item in
    select (e->>'producto_id')::uuid as producto_id
      from jsonb_array_elements(v_pedido) e
  loop
    select id, nombre, activo, empresa_id into v_producto
      from productos where id = v_item.producto_id;

    if not found then
      raise exception 'Uno de los productos no existe'
        using errcode = 'LT004';
    end if;

    if v_producto.empresa_id <> v_empresa then
      raise exception 'Uno de los productos no pertenece a tu empresa'
        using errcode = '42501';
    end if;

    if not v_producto.activo then
      raise exception 'El producto «%» está inactivo', v_producto.nombre
        using errcode = 'LT004';
    end if;
  end loop;

  -- ── ¿ya se registró este mismo intento? ──
  /*
    La huella es la intención: de dónde, hacia dónde y qué productos en qué
    cantidades, ya agrupados y ordenados. Un reintento legítimo trae la
    misma; reutilizar la clave para otro traslado es un error de quien
    llama, y devolverle el viejo se lo disfrazaría de éxito.
  */
  v_huella := p_origen::text || '>' || p_destino::text || '|' ||
              (select string_agg((e->>'producto_id') || 'x' || (e->>'cantidad'),
                                 ',' order by (e->>'producto_id'))
                 from jsonb_array_elements(v_pedido) e);

  if p_clave_idempotencia is not null then
    select * into v_previo
      from traslados
     where empresa_id = v_empresa
       and clave_idempotencia = p_clave_idempotencia;

    if found then
      select v_previo.origen_id::text || '>' || v_previo.destino_id::text || '|' ||
             string_agg(producto_id::text || 'x' || cantidad::text,
                        ',' order by producto_id::text)
        into v_huella_vieja
        from traslado_detalle
       where traslado_id = v_previo.id;

      if v_huella_vieja is distinct from v_huella then
        raise exception
          'La clave % ya se usó para un traslado distinto de esta empresa',
          p_clave_idempotencia
          using errcode = 'LT006';
      end if;

      return jsonb_build_object(
        'traslado_id', v_previo.id,
        'origen_id',   v_previo.origen_id,
        'destino_id',  v_previo.destino_id,
        'estado',      v_previo.estado,
        'items',       v_pedido,
        'repetida',    true
      );
    end if;
  end if;

  -- ── las celdas, bajo candado ──
  /*
    La existencia del destino puede no existir: se crea en cero antes de
    bloquear, como en la 0018. Si el traslado se rechaza más abajo, se
    deshace con la transacción.
  */
  insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
  select v_empresa, p_destino, (e->>'producto_id')::uuid, 0
    from jsonb_array_elements(v_pedido) e
   order by (e->>'producto_id')
  on conflict (ubicacion_id, producto_id) do nothing;

  /*
    Todas las celdas del traslado —origen y destino de cada producto— se
    bloquean en UNA pasada y en un único orden global: (producto,
    ubicación) ascendente.

    La venta bloquea sus celdas de una sola ubicación en orden de producto
    y el ajuste bloquea una sola: los dos recorren el mismo orden global.
    Mientras todos lo respeten, dos operaciones nunca se esperan en
    círculo, ni siquiera un traslado A→B contra otro B→A.
  */
  perform 1
     from inventario_ubicacion iu
    where iu.ubicacion_id in (p_origen, p_destino)
      and iu.producto_id in (
            select (e->>'producto_id')::uuid from jsonb_array_elements(v_pedido) e
          )
    order by iu.producto_id, iu.ubicacion_id
      for update;

  for v_item in
    select (e->>'producto_id')::uuid as producto_id,
           (e->>'cantidad')::integer as cantidad
      from jsonb_array_elements(v_pedido) e
     order by (e->>'producto_id')
  loop
    select cantidad into v_disponible
      from inventario_ubicacion
     where ubicacion_id = p_origen
       and producto_id = v_item.producto_id;

    if v_disponible is null or v_disponible < v_item.cantidad then
      select nombre into v_producto from productos where id = v_item.producto_id;

      raise exception
        'No hay suficiente «%» en %: hay %, se trasladan %',
        v_producto.nombre,
        v_origen.nombre,
        coalesce(v_disponible, 0),
        v_item.cantidad
        using errcode = 'LT005';
    end if;
  end loop;

  -- ── la cabecera y el detalle ──
  insert into traslados (
    empresa_id, origen_id, destino_id, usuario_id, estado, nota, clave_idempotencia
  ) values (
    v_empresa, p_origen, p_destino, v_usuario, 'aplicado',
    coalesce(btrim(p_nota), ''), p_clave_idempotencia
  )
  returning id into v_traslado;

  insert into traslado_detalle (traslado_id, empresa_id, producto_id, cantidad)
  select v_traslado, v_empresa,
         (e->>'producto_id')::uuid, (e->>'cantidad')::integer
    from jsonb_array_elements(v_pedido) e;

  -- ── los dos lados, y el libro ──
  /*
    Cada cambio de una celda queda escrito en el libro con la misma
    cantidad y con su ubicación, así que la suma de las celdas de un
    producto sigue siendo la suma de su libro. Y como se descuenta y se
    suma lo mismo, el stock global no cambia: trasladar no crea ni destruye
    mercadería.
  */
  for v_item in
    select (e->>'producto_id')::uuid as producto_id,
           (e->>'cantidad')::integer as cantidad
      from jsonb_array_elements(v_pedido) e
     order by (e->>'producto_id')
  loop
    update inventario_ubicacion
       set cantidad = cantidad - v_item.cantidad,
           actualizado_en = now()
     where ubicacion_id = p_origen
       and producto_id = v_item.producto_id;

    update inventario_ubicacion
       set cantidad = cantidad + v_item.cantidad,
           actualizado_en = now()
     where ubicacion_id = p_destino
       and producto_id = v_item.producto_id;

    insert into movimientos_inventario (
      empresa_id, producto_id, usuario_id, venta_id, traslado_id,
      ubicacion_id, tipo, cantidad, motivo
    ) values
      (v_empresa, v_item.producto_id, v_usuario, null, v_traslado,
       p_origen, 'traslado_salida', -v_item.cantidad,
       'Traslado a ' || v_destino.nombre),
      (v_empresa, v_item.producto_id, v_usuario, null, v_traslado,
       p_destino, 'traslado_entrada', v_item.cantidad,
       'Traslado desde ' || v_origen.nombre);
  end loop;

  return jsonb_build_object(
    'traslado_id', v_traslado,
    'origen_id',   p_origen,
    'destino_id',  p_destino,
    'estado',      'aplicado',
    'items',       v_pedido,
    'repetida',    false
  );
end $$;

-- ─────────────────────────────────────────────────────────
-- QUIÉN PUEDE EJECUTARLA
-- ─────────────────────────────────────────────────────────
revoke execute on function registrar_traslado(
  uuid, uuid, jsonb, text, text
) from public;

revoke execute on function registrar_traslado(
  uuid, uuid, jsonb, text, text
) from anon;

grant execute on function registrar_traslado(
  uuid, uuid, jsonb, text, text
) to authenticated, service_role;
