-- Recepción de traslados: la mercadería entra al destino cuando alguien de
-- ese destino confirma que la recibió.
--
-- Hasta la 0055 un traslado descontaba el origen y sumaba al destino en el
-- acto. Ahora:
-- - Enviar (registrar_traslado, mismos argumentos y misma respuesta)
--   descuenta el origen y anota la salida, y deja el traslado PENDIENTE.
--   El destino todavía no lo tiene: no se puede vender allí.
-- - Confirmar la recepción (confirmar_recepcion_traslado) suma al destino,
--   anota la entrada con quién recibió y cuándo, y lo deja RECIBIDO.
-- - Si lo recibido no coincide con lo enviado, el receptor reporta UNA
--   incidencia (reportar_incidencia_traslado) con una observación; el
--   traslado queda CON INCIDENCIA, sin sumar nada, hasta que se confirme.
--
-- Decisiones del propietario (2026-11-26):
-- - confirma o reporta: el administrador, o un usuario activo cuya ubicación
--   operativa sea el destino, con permiso de inventario y que no sea quien
--   envió. «Inventario de todas» no da recepción en otras ubicaciones; el
--   contador nunca. La identidad sale de la sesión, nunca de un parámetro;
-- - el administrador confirma en cualquier destino, también lo que él
--   envió. Si el destino no es su ubicación operativa, o si lo envió él, es
--   una CONFIRMACIÓN ADMINISTRATIVA: la base la marca sola y exige una
--   observación (5 a 500 caracteres) que explique el motivo;
-- - un destino desactivado no recibe: hay que reactivarlo. Un producto
--   desactivado después de enviarlo sí se recibe;
-- - el contenido enviado se protege: al enviar se guarda una huella
--   (productos y cantidades, en orden) y el total de unidades; si el
--   contenido cambia o desaparece, no se puede confirmar ni reportar;
-- - sin anulación, sin recepción parcial, sin devoluciones ni ajustes
--   automáticos, sin plazos ni confirmaciones automáticas.
--
-- Los traslados anteriores quedan como están: estado «aplicado», sin
-- receptor ni fecha de recepción inventados.
--
-- Errores nuevos: LT010 el traslado no existe; LT011 su estado no lo
-- permite; LT012 destino desactivado; LT013 falta la observación de la
-- confirmación administrativa; LT014 el contenido cambió desde el envío;
-- LT015 ya tiene una incidencia; LT016 observación de la incidencia no
-- válida; 42501 sin permiso.
--
-- Lo que NO hace: no cambia ventas, pedidos, regalías, liquidaciones,
-- existencias ni permisos, ni los movimientos ya escritos. Idempotente.

-- ─────────────────────────────────────────────────────────
-- LA CABECERA
-- ─────────────────────────────────────────────────────────
alter table public.traslados add column if not exists unidades integer;
alter table public.traslados add column if not exists contenido_huella text;
alter table public.traslados add column if not exists recibido_por uuid references public.usuarios (id) on delete set null;
alter table public.traslados add column if not exists recibido_por_nombre text;
alter table public.traslados add column if not exists recibido_en timestamptz;
alter table public.traslados add column if not exists confirmacion_administrativa boolean not null default false;
alter table public.traslados add column if not exists observacion_recepcion text;
alter table public.traslados add column if not exists incidencia text;
alter table public.traslados add column if not exists incidencia_por uuid references public.usuarios (id) on delete set null;
alter table public.traslados add column if not exists incidencia_por_nombre text;
alter table public.traslados add column if not exists incidencia_en timestamptz;

alter table public.traslados alter column estado set default 'pendiente';

alter table public.traslados drop constraint if exists traslados_estado_check;
alter table public.traslados add constraint traslados_estado_check
  check (estado in ('aplicado', 'pendiente', 'con_incidencia', 'recibido'));

-- Los de antes del control de recepción: sin contenido guardado ni recepción.
alter table public.traslados drop constraint if exists traslados_aplicado_historico;
alter table public.traslados add constraint traslados_aplicado_historico
  check (estado <> 'aplicado' or (recibido_en is null and incidencia is null and not confirmacion_administrativa));

alter table public.traslados drop constraint if exists traslados_contenido_registrado;
alter table public.traslados add constraint traslados_contenido_registrado
  check (estado = 'aplicado' or (unidades > 0 and contenido_huella ~ '^[0-9a-f]{32}$'));

alter table public.traslados drop constraint if exists traslados_recepcion_coherente;
alter table public.traslados add constraint traslados_recepcion_coherente
  check ((estado = 'recibido') = (recibido_en is not null)
         and (recibido_en is null) = (recibido_por_nombre is null));

alter table public.traslados drop constraint if exists traslados_confirmacion_administrativa;
alter table public.traslados add constraint traslados_confirmacion_administrativa
  check ((not confirmacion_administrativa and observacion_recepcion is null)
         or (confirmacion_administrativa and estado = 'recibido'
             and char_length(btrim(observacion_recepcion)) between 5 and 500));

alter table public.traslados drop constraint if exists traslados_incidencia_coherente;
alter table public.traslados add constraint traslados_incidencia_coherente
  check ((incidencia is null) = (incidencia_en is null)
         and (incidencia is null) = (incidencia_por_nombre is null)
         and (incidencia is null or char_length(btrim(incidencia)) between 5 and 500)
         and (estado <> 'con_incidencia' or incidencia is not null));

create index if not exists traslados_por_recibir
  on public.traslados (empresa_id, destino_id) where estado in ('pendiente', 'con_incidencia');

-- ─────────────────────────────────────────────────────────
-- LA PROTECCIÓN DEL TRASLADO
-- ─────────────────────────────────────────────────────────
/*
  Un traslado nace pendiente, con su contenido guardado, y solo avanza:
  pendiente → con incidencia → recibido, o pendiente → recibido. Lo
  recibido y lo «aplicado» de antes no cambian. Nada de lo enviado cambia
  nunca: origen, destino, quién envió, nota, fecha, número, unidades y
  huella. La recepción y la incidencia se escriben una sola vez.

  Lo único que puede cambiar sin pasar por las funciones es que un usuario
  borrado deje su referencia en nulo (ON DELETE SET NULL); el nombre
  guardado se conserva.
*/
create or replace function public.traslado_protegido()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'pendiente' or new.unidades is null or new.contenido_huella is null
       or new.recibido_en is not null or new.incidencia is not null or new.confirmacion_administrativa then
      raise exception 'Un traslado nuevo nace pendiente, con su contenido y sin recepción' using errcode = '42501';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id or new.empresa_id is distinct from old.empresa_id
     or new.origen_id is distinct from old.origen_id or new.destino_id is distinct from old.destino_id
     or new.nota is distinct from old.nota or new.clave_idempotencia is distinct from old.clave_idempotencia
     or new.creado_en is distinct from old.creado_en
     or new.unidades is distinct from old.unidades or new.contenido_huella is distinct from old.contenido_huella
     or (new.usuario_id is distinct from old.usuario_id and new.usuario_id is not null)
     or (new.recibido_por is distinct from old.recibido_por and new.recibido_por is not null and old.estado = 'recibido')
     or (new.incidencia_por is distinct from old.incidencia_por and new.incidencia_por is not null and old.incidencia is not null) then
    raise exception 'Lo enviado en el traslado % no se puede cambiar', old.numero using errcode = '42501';
  end if;

  if new.estado is distinct from old.estado
     and (old.estado, new.estado) not in (('pendiente', 'con_incidencia'), ('pendiente', 'recibido'), ('con_incidencia', 'recibido')) then
    raise exception 'El traslado % no puede pasar de % a %', old.numero, old.estado, new.estado using errcode = '42501';
  end if;

  -- La recepción se escribe solo al recibir; la incidencia, solo al reportarla.
  if (new.estado = old.estado or new.estado <> 'recibido')
     and (new.recibido_en is distinct from old.recibido_en or new.recibido_por_nombre is distinct from old.recibido_por_nombre
          or new.confirmacion_administrativa is distinct from old.confirmacion_administrativa
          or new.observacion_recepcion is distinct from old.observacion_recepcion
          or (new.recibido_por is distinct from old.recibido_por and new.recibido_por is not null)) then
    raise exception 'La recepción del traslado % no se puede cambiar', old.numero using errcode = '42501';
  end if;

  if (new.estado = old.estado or new.estado <> 'con_incidencia')
     and (new.incidencia is distinct from old.incidencia or new.incidencia_en is distinct from old.incidencia_en
          or new.incidencia_por_nombre is distinct from old.incidencia_por_nombre
          or (new.incidencia_por is distinct from old.incidencia_por and new.incidencia_por is not null)) then
    raise exception 'La incidencia del traslado % no se puede cambiar', old.numero using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function public.traslado_protegido() from public, anon, authenticated;

drop trigger if exists traslados_protegido on public.traslados;
create trigger traslados_protegido before insert or update on public.traslados
  for each row execute function public.traslado_protegido();

/*
  Los renglones no se modifican nunca, y solo se agregan a un traslado
  pendiente (al enviarlo). No se borran directamente; un borrado en cascada
  —un producto o una cabecera borrados por el dueño de la base— se rechaza
  mientras el traslado esté pendiente o con incidencia, y en lo demás sigue
  como antes.
*/
create or replace function public.traslado_detalle_protegido()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estado text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Los renglones de un traslado no se modifican' using errcode = '42501';
  end if;

  select t.estado into v_estado
    from public.traslados t
   where t.id = case when tg_op = 'INSERT' then new.traslado_id else old.traslado_id end;

  if tg_op = 'INSERT' then
    if v_estado is distinct from 'pendiente' then
      raise exception 'Solo se agregan renglones a un traslado que se está enviando' using errcode = '42501';
    end if;

    return new;
  end if;

  if pg_trigger_depth() <= 1 or v_estado in ('pendiente', 'con_incidencia') then
    raise exception 'Los renglones de un traslado sin recibir no se borran' using errcode = '42501';
  end if;

  return old;
end $$;

revoke execute on function public.traslado_detalle_protegido() from public, anon, authenticated;

drop trigger if exists traslado_detalle_protegido on public.traslado_detalle;
create trigger traslado_detalle_protegido before insert or update or delete on public.traslado_detalle
  for each row execute function public.traslado_detalle_protegido();

-- ─────────────────────────────────────────────────────────
-- EL CONTENIDO Y QUIÉN RECIBE
-- ─────────────────────────────────────────────────────────
/*
  La huella del contenido: cada producto con su cantidad, en orden de
  producto. La misma cuenta al enviar (sobre lo pedido) y al recibir (sobre
  los renglones guardados).
*/
create or replace function public.contenido_de_traslado(p_traslado uuid, out unidades integer, out huella text)
language sql
stable
set search_path = ''
as $$
  select sum(d.cantidad)::integer,
         md5(string_agg(d.producto_id::text || 'x' || d.cantidad::text, ',' order by d.producto_id::text))
    from public.traslado_detalle d
   where d.traslado_id = p_traslado
$$;

revoke execute on function public.contenido_de_traslado(uuid) from public, anon, authenticated;

/*
  Quién puede recibir este traslado o reportar su incidencia. Devuelve el
  usuario de la sesión o falla con 42501. La identidad sale de auth.uid().
*/
create or replace function public.receptor_de_traslado(p_traslado public.traslados)
returns public.usuarios
language plpgsql
stable
set search_path = ''
as $$
declare
  v_usuario public.usuarios;
begin
  select u.* into v_usuario
    from public.usuarios u
   where u.auth_id = auth.uid() and u.activo and not u.debe_cambiar_contrasena
   limit 1;

  if v_usuario.id is null or v_usuario.rol = 'contador' or v_usuario.empresa_id is distinct from p_traslado.empresa_id then
    raise exception 'No tienes permiso para recibir traslados' using errcode = '42501';
  end if;

  if v_usuario.rol = 'admin' then
    return v_usuario;
  end if;

  if v_usuario.ubicacion_id is distinct from p_traslado.destino_id then
    raise exception 'Solo recibe este traslado alguien de su ubicación de destino' using errcode = '42501';
  end if;

  if not (public.usuario_tiene_permiso('inventory-own') or public.usuario_tiene_permiso('inventory-all')) then
    raise exception 'Necesitas permiso de inventario para recibir traslados' using errcode = '42501';
  end if;

  if v_usuario.id = p_traslado.usuario_id then
    raise exception 'Quien envía un traslado no puede confirmar su recepción' using errcode = '42501';
  end if;

  return v_usuario;
end $$;

revoke execute on function public.receptor_de_traslado(public.traslados) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- ENVIAR
-- ─────────────────────────────────────────────────────────
/*
  El mismo envío de la 0020 con tres cambios: la cabecera nace pendiente y
  guarda su contenido (unidades y huella), y ya no se suma al destino ni se
  anota la entrada: eso lo hace la recepción. Los argumentos, las
  validaciones, la idempotencia, el candado del origen y la respuesta no
  cambian.
*/
create or replace function public.registrar_traslado(
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
  v_unidades     integer;
  v_contenido    text;
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

  -- Quién puede trasladar desde dónde: igual que en la 0020 (D1 y D3).
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

  -- ── las celdas del origen, bajo candado ──
  /*
    Solo se bloquea el origen, que es lo único que cambia al enviar, en el
    orden global (producto, ubicación) que respetan ventas, ajustes y la
    recepción: dos operaciones nunca se esperan en círculo.
  */
  perform 1
     from inventario_ubicacion iu
    where iu.ubicacion_id = p_origen
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

  -- ── la cabecera, pendiente y con su contenido ──
  select sum((e->>'cantidad')::integer)::integer,
         md5(string_agg((e->>'producto_id') || 'x' || (e->>'cantidad'), ',' order by (e->>'producto_id')))
    into v_unidades, v_contenido
    from jsonb_array_elements(v_pedido) e;

  insert into traslados (
    empresa_id, origen_id, destino_id, usuario_id, estado, nota, clave_idempotencia, unidades, contenido_huella
  ) values (
    v_empresa, p_origen, p_destino, v_usuario, 'pendiente',
    coalesce(btrim(p_nota), ''), p_clave_idempotencia, v_unidades, v_contenido
  )
  returning id into v_traslado;

  insert into traslado_detalle (traslado_id, empresa_id, producto_id, cantidad)
  select v_traslado, v_empresa,
         (e->>'producto_id')::uuid, (e->>'cantidad')::integer
    from jsonb_array_elements(v_pedido) e;

  -- ── la salida, y el libro ──
  /*
    Cada cambio de una celda queda escrito en el libro con la misma
    cantidad y su ubicación. Lo que va en camino está en el traslado
    pendiente; la recepción lo suma al destino con su propia entrada.
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

    insert into movimientos_inventario (
      empresa_id, producto_id, usuario_id, venta_id, traslado_id,
      ubicacion_id, tipo, cantidad, motivo
    ) values
      (v_empresa, v_item.producto_id, v_usuario, null, v_traslado,
       p_origen, 'traslado_salida', -v_item.cantidad,
       'Traslado a ' || v_destino.nombre);
  end loop;

  return jsonb_build_object(
    'traslado_id', v_traslado,
    'origen_id',   p_origen,
    'destino_id',  p_destino,
    'estado',      'pendiente',
    'items',       v_pedido,
    'repetida',    false
  );
end $$;

revoke execute on function public.registrar_traslado(uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.registrar_traslado(uuid, uuid, jsonb, text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────
-- RECIBIR
-- ─────────────────────────────────────────────────────────
/*
  1. Bloquea el traslado: dos confirmaciones a la vez se ordenan, y la
     segunda encuentra el traslado ya recibido y no vuelve a sumar.
  2. Quién recibe, desde la sesión. Si ya estaba recibido, responde lo
     mismo con repetida = true: reintentar tras perder la conexión es seguro.
  3. Un destino desactivado no recibe; el contenido tiene que ser el que se
     envió; la confirmación administrativa exige su observación.
  4. Bloquea las celdas del destino en el orden global, suma, anota la
     entrada con el receptor y la hora real, y deja el traslado recibido.
  Todo en una transacción: o se recibe entero o no se recibe nada.
*/
create or replace function public.confirmar_recepcion_traslado(
  p_traslado    uuid,
  p_observacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_traslado      public.traslados;
  v_receptor      public.usuarios;
  v_destino       public.ubicaciones;
  v_origen        text;
  v_contenido     record;
  v_administrativa boolean;
  v_observacion   text;
  v_item          record;
begin
  select t.* into v_traslado
    from public.traslados t
   where t.id = p_traslado and t.empresa_id = public.empresa_del_usuario()
     for update;

  if v_traslado.id is null then
    raise exception 'No se encontró el traslado' using errcode = 'LT010';
  end if;

  v_receptor := public.receptor_de_traslado(v_traslado);

  if v_traslado.estado = 'recibido' then
    return jsonb_build_object(
      'traslado_id', v_traslado.id, 'numero', v_traslado.numero, 'estado', v_traslado.estado,
      'recibido_en', v_traslado.recibido_en, 'recibido_por_nombre', v_traslado.recibido_por_nombre,
      'confirmacion_administrativa', v_traslado.confirmacion_administrativa,
      'unidades', v_traslado.unidades, 'repetida', true
    );
  end if;

  if v_traslado.estado not in ('pendiente', 'con_incidencia') then
    raise exception 'El traslado % se aplicó antes del control de recepción y no necesita confirmación', v_traslado.numero
      using errcode = 'LT011';
  end if;

  select u.* into v_destino from public.ubicaciones u where u.id = v_traslado.destino_id;

  if not v_destino.activa then
    raise exception 'La ubicación «%» está desactivada: reactívala para recibir el traslado %', v_destino.nombre, v_traslado.numero
      using errcode = 'LT012';
  end if;

  v_administrativa := v_receptor.rol = 'admin'
    and (v_receptor.ubicacion_id is distinct from v_traslado.destino_id or v_receptor.id = v_traslado.usuario_id);
  v_observacion := nullif(btrim(coalesce(p_observacion, '')), '');

  if v_administrativa and (v_observacion is null or char_length(v_observacion) not between 5 and 500) then
    raise exception 'Una confirmación administrativa necesita una observación de 5 a 500 caracteres que explique el motivo'
      using errcode = 'LT013';
  end if;

  select * into v_contenido from public.contenido_de_traslado(v_traslado.id);

  if v_contenido.unidades is distinct from v_traslado.unidades or v_contenido.huella is distinct from v_traslado.contenido_huella then
    raise exception 'El contenido del traslado % cambió desde el envío; no se puede confirmar. Comunícate con el administrador.', v_traslado.numero
      using errcode = 'LT014';
  end if;

  select u.nombre into v_origen from public.ubicaciones u where u.id = v_traslado.origen_id;

  insert into public.inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
  select v_traslado.empresa_id, v_traslado.destino_id, d.producto_id, 0
    from public.traslado_detalle d
   where d.traslado_id = v_traslado.id
   order by d.producto_id
  on conflict (ubicacion_id, producto_id) do nothing;

  perform 1
     from public.inventario_ubicacion iu
    where iu.ubicacion_id = v_traslado.destino_id
      and iu.producto_id in (select d.producto_id from public.traslado_detalle d where d.traslado_id = v_traslado.id)
    order by iu.producto_id, iu.ubicacion_id
      for update;

  for v_item in
    select d.producto_id, d.cantidad
      from public.traslado_detalle d
     where d.traslado_id = v_traslado.id
     order by d.producto_id
  loop
    update public.inventario_ubicacion
       set cantidad = cantidad + v_item.cantidad,
           actualizado_en = now()
     where ubicacion_id = v_traslado.destino_id
       and producto_id = v_item.producto_id;

    insert into public.movimientos_inventario (
      empresa_id, producto_id, usuario_id, venta_id, traslado_id, ubicacion_id, tipo, cantidad, motivo
    ) values (
      v_traslado.empresa_id, v_item.producto_id, v_receptor.id, null, v_traslado.id,
      v_traslado.destino_id, 'traslado_entrada', v_item.cantidad, 'Traslado desde ' || v_origen
    );
  end loop;

  update public.traslados
     set estado = 'recibido',
         recibido_por = v_receptor.id,
         recibido_por_nombre = v_receptor.nombre,
         recibido_en = now(),
         confirmacion_administrativa = v_administrativa,
         observacion_recepcion = case when v_administrativa then v_observacion end
   where id = v_traslado.id
  returning * into v_traslado;

  return jsonb_build_object(
    'traslado_id', v_traslado.id, 'numero', v_traslado.numero, 'estado', v_traslado.estado,
    'recibido_en', v_traslado.recibido_en, 'recibido_por_nombre', v_traslado.recibido_por_nombre,
    'confirmacion_administrativa', v_traslado.confirmacion_administrativa,
    'unidades', v_traslado.unidades, 'repetida', false
  );
end $$;

revoke execute on function public.confirmar_recepcion_traslado(uuid, text) from public, anon;
grant execute on function public.confirmar_recepcion_traslado(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────
-- LA INCIDENCIA
-- ─────────────────────────────────────────────────────────
/*
  Una por traslado, con observación obligatoria. No suma ni resta nada: el
  traslado queda «con incidencia» hasta que alguien autorizado lo confirme.
  Repetir la misma incidencia (por ejemplo, tras perder la conexión)
  responde lo mismo con repetida = true.
*/
create or replace function public.reportar_incidencia_traslado(
  p_traslado uuid,
  p_nota     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_traslado  public.traslados;
  v_receptor  public.usuarios;
  v_nota      text := btrim(coalesce(p_nota, ''));
  v_contenido record;
begin
  select t.* into v_traslado
    from public.traslados t
   where t.id = p_traslado and t.empresa_id = public.empresa_del_usuario()
     for update;

  if v_traslado.id is null then
    raise exception 'No se encontró el traslado' using errcode = 'LT010';
  end if;

  v_receptor := public.receptor_de_traslado(v_traslado);

  if v_traslado.estado = 'con_incidencia' and v_traslado.incidencia = v_nota and v_traslado.incidencia_por = v_receptor.id then
    return jsonb_build_object('traslado_id', v_traslado.id, 'numero', v_traslado.numero, 'estado', v_traslado.estado,
                              'incidencia', v_traslado.incidencia, 'incidencia_en', v_traslado.incidencia_en, 'repetida', true);
  end if;

  if v_traslado.estado = 'con_incidencia' then
    raise exception 'El traslado % ya tiene una incidencia', v_traslado.numero using errcode = 'LT015';
  end if;

  if v_traslado.estado <> 'pendiente' then
    raise exception 'El traslado % no está pendiente de recepción', v_traslado.numero using errcode = 'LT011';
  end if;

  if char_length(v_nota) not between 5 and 500 then
    raise exception 'Describe la incidencia en 5 a 500 caracteres' using errcode = 'LT016';
  end if;

  select * into v_contenido from public.contenido_de_traslado(v_traslado.id);

  if v_contenido.unidades is distinct from v_traslado.unidades or v_contenido.huella is distinct from v_traslado.contenido_huella then
    raise exception 'El contenido del traslado % cambió desde el envío. Comunícate con el administrador.', v_traslado.numero
      using errcode = 'LT014';
  end if;

  update public.traslados
     set estado = 'con_incidencia',
         incidencia = v_nota,
         incidencia_por = v_receptor.id,
         incidencia_por_nombre = v_receptor.nombre,
         incidencia_en = now()
   where id = v_traslado.id
  returning * into v_traslado;

  return jsonb_build_object('traslado_id', v_traslado.id, 'numero', v_traslado.numero, 'estado', v_traslado.estado,
                            'incidencia', v_traslado.incidencia, 'incidencia_en', v_traslado.incidencia_en, 'repetida', false);
end $$;

revoke execute on function public.reportar_incidencia_traslado(uuid, text) from public, anon;
grant execute on function public.reportar_incidencia_traslado(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────
-- COMPROBACIÓN DE PERMISOS
-- ─────────────────────────────────────────────────────────
/*
  Si algo quedara con más acceso del previsto, la migración entera se
  deshace: las funciones públicas solo para usuarios con sesión, las
  internas para nadie de la API, y las tablas sin escritura directa.
*/
do $$
begin
  if has_function_privilege('anon', 'public.registrar_traslado(uuid, uuid, jsonb, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirmar_recepcion_traslado(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reportar_incidencia_traslado(uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.registrar_traslado(uuid, uuid, jsonb, text, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.confirmar_recepcion_traslado(uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.reportar_incidencia_traslado(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.receptor_de_traslado(public.traslados)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.contenido_de_traslado(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.traslado_protegido()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.traslado_detalle_protegido()', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.traslados', 'INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.traslado_detalle', 'INSERT, UPDATE, DELETE') then
    raise exception 'Los permisos de la 0056 no quedaron como se esperaba: no se aplicó nada.';
  end if;
end $$;
