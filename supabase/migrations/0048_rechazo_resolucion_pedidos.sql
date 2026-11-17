-- Pedidos interubicación, etapa C1: rechazo y resolución antes de facturar.
--
-- La ubicación que debe facturar un pedido puede rechazarlo con un motivo. El
-- pedido pasa a «por resolver» y la ubicación que lo entregó decide:
-- - facturarlo ella misma («Facturar en origen»): en la misma operación el
--   pedido pasa a ser suyo y se emite su única factura, con facturar_pedido();
-- - enviarlo a otra ubicación: el mismo pedido vuelve a «pendiente» con el
--   destino nuevo, que recibe el aviso y lo factura como cualquier otro.
--
-- Rechazar no cancela: no devuelve inventario ni dinero, no factura, no toca
-- cobros ni liquidaciones. Resolver tampoco: el pedido conserva número,
-- cliente, productos, precios, ISV, cobros y el inventario que salió al
-- entregar. Solo cambian su estado y la ubicación que lo factura, y cada paso
-- queda en eventos_de_pedido, que sigue siendo inmutable.
--
-- El dinero sigue al destino final:
-- - el efectivo cobrado en origen se le debe a la ubicación que factura; si
--   factura la misma que cobró, no hay nada que liquidar;
-- - mientras el pedido está por resolver nadie sabe a quién se le debe, así que
--   su efectivo no se puede liquidar;
-- - un pedido con efectivo ya metido en una liquidación por confirmar o
--   confirmada no se rechaza ni cambia de ubicación (PI013): moverlo exigiría
--   ajustar esa liquidación, y eso es de la etapa C2.
--
-- Las versiones de la 0045 y la 0046 que cambian de comportamiento no se
-- reescriben: se renombran con el sufijo _base y las envuelve una función con
-- el nombre de siempre, que solo agrega lo nuevo. Así su código, ya probado en
-- producción, sigue siendo exactamente el mismo.
--
-- Errores nuevos: PI011 clave usada para otra operación; PI012 el pedido no
-- está en el estado que la operación necesita; PI013 el pedido tiene efectivo
-- en una liquidación registrada. Además PI001, PI003, PI008, PI009 y 42501.
--
-- No cambia ninguna fila comercial. Idempotente.

-- ─────────────────────────────────────────────────────────
-- LA CLAVE DE CADA OPERACIÓN
-- ─────────────────────────────────────────────────────────
/*
  Rechazar y resolver llevan una clave, como entregar. Se guarda en el evento
  que deja la operación, con la huella de lo que se pidió: un reintento con la
  misma clave devuelve lo hecho, y la clave usada para otra cosa da PI011.
*/
alter table public.eventos_de_pedido add column if not exists clave_idempotencia text;
alter table public.eventos_de_pedido add column if not exists huella text;

create unique index if not exists eventos_de_pedido_clave
  on public.eventos_de_pedido (empresa_id, clave_idempotencia)
  where clave_idempotencia is not null;

-- ─────────────────────────────────────────────────────────
-- LAS TRANSICIONES
-- ─────────────────────────────────────────────────────────
/*
  Las únicas que existen:
  - pendiente → facturado: la factura (sin cambios desde la 0045);
  - pendiente → por resolver: el rechazo, que solo cambia el estado;
  - por resolver → pendiente: la resolución, que solo cambia el estado y el
    destino, y siempre a otra ubicación.
  Un pedido facturado o cancelado ya no cambia.
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

  if old.estado = 'pendiente' and new.estado = 'facturado' and new.venta_id is not null then
    if (to_jsonb(new) - v_facturacion) <> (to_jsonb(old) - v_facturacion) then
      raise exception 'Los datos de un pedido entregado no se modifican' using errcode = '42501';
    end if;

    return new;
  end if;

  if old.estado = 'pendiente' and new.estado = 'por_resolver' then
    if (to_jsonb(new) - 'estado') <> (to_jsonb(old) - 'estado') then
      raise exception 'Rechazar un pedido no cambia sus datos' using errcode = '42501';
    end if;

    return new;
  end if;

  if old.estado = 'por_resolver' and new.estado = 'pendiente' and new.destino_id <> old.destino_id then
    if (to_jsonb(new) - array['estado', 'destino_id']) <> (to_jsonb(old) - array['estado', 'destino_id']) then
      raise exception 'Resolver un pedido solo cambia la ubicación que lo factura' using errcode = '42501';
    end if;

    return new;
  end if;

  raise exception '%', case old.estado
      when 'pendiente' then 'Un pedido pendiente solo puede pasar a facturado o a por resolver'
      when 'por_resolver' then 'Un pedido por resolver solo vuelve a pendiente con otra ubicación destino'
      else 'Un pedido ' || old.estado || ' ya no cambia'
    end
    using errcode = '42501';
end $$;

revoke execute on function public.pedido_solo_avanza() from public, anon, authenticated;

/*
  Antes, origen y destino no podían coincidir nunca. Ahora coinciden en un solo
  caso: el pedido que se factura en su origen. Eso ocurre dentro de una
  operación que lo deja facturado, así que la regla se revisa al confirmar la
  transacción: si origen y destino son la misma ubicación, el pedido está
  facturado y su historia dice que se resolvió facturarlo en origen. Un pedido
  pendiente para su propia ubicación no puede quedar guardado.
*/
alter table public.pedidos_ubicacion drop constraint if exists pedidos_origen_distinto_destino;

create or replace function public.pedido_en_su_origen_sale_facturado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos_ubicacion;
begin
  select p.* into v_pedido from public.pedidos_ubicacion p where p.id = new.id;

  if v_pedido.origen_id = v_pedido.destino_id and (
       v_pedido.estado <> 'facturado'
       or not exists (
         select 1 from public.eventos_de_pedido e
          where e.pedido_id = v_pedido.id and e.tipo = 'facturar_en_origen'
       )
     ) then
    raise exception 'Un pedido solo se factura en la ubicación que lo entregó al resolverlo, y en la misma operación'
      using errcode = '42501';
  end if;

  return null;
end $$;

revoke execute on function public.pedido_en_su_origen_sale_facturado() from public, anon, authenticated;

drop trigger if exists pedido_en_su_origen_sale_facturado on public.pedidos_ubicacion;
create constraint trigger pedido_en_su_origen_sale_facturado
  after insert or update on public.pedidos_ubicacion
  deferrable initially deferred
  for each row execute function public.pedido_en_su_origen_sale_facturado();

-- ─────────────────────────────────────────────────────────
-- LAS PIEZAS QUE COMPARTEN RECHAZAR Y RESOLVER
-- ─────────────────────────────────────────────────────────
/*
  El pedido, listo para operar. Primero el candado del par de ubicaciones, el
  mismo que usa registrar_liquidacion(): una liquidación de ese par no puede
  meter el efectivo de este pedido mientras se rechaza o se resuelve. Después
  la fila del pedido. Si entre la lectura y los candados alguien le cambió el
  destino, se pide volver a abrirlo (PI012).
*/
create or replace function public.tomar_pedido(p_empresa uuid, p_pedido uuid)
returns public.pedidos_ubicacion
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visto  public.pedidos_ubicacion;
  v_pedido public.pedidos_ubicacion;
begin
  select p.* into v_visto
    from public.pedidos_ubicacion p
   where p.id = p_pedido
     and p.empresa_id = p_empresa;

  if v_visto.id is null then
    raise exception 'El pedido no existe en tu empresa' using errcode = 'PI008';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'liquidacion|' || p_empresa::text || '|' || v_visto.origen_id::text || '|' || v_visto.destino_id::text, 0));

  select p.* into v_pedido from public.pedidos_ubicacion p where p.id = p_pedido for update;

  if v_pedido.destino_id <> v_visto.destino_id then
    raise exception 'El pedido % cambió mientras lo revisabas: ábrelo de nuevo', v_pedido.numero
      using errcode = 'PI012';
  end if;

  return v_pedido;
end $$;

/*
  ¿Esta clave ya hizo esta misma operación? Sí: true. No se usó: false. Se usó
  para otra cosa: PI011.
*/
create or replace function public.operacion_de_pedido_repetida(p_empresa uuid, p_clave text, p_huella text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_huella text;
begin
  select e.huella into v_huella
    from public.eventos_de_pedido e
   where e.empresa_id = p_empresa
     and e.clave_idempotencia = p_clave;

  if not found then
    return false;
  end if;

  if v_huella is distinct from p_huella then
    raise exception 'La clave % ya se usó para otra operación', p_clave using errcode = 'PI011';
  end if;

  return true;
end $$;

/*
  Las liquidaciones registradas que tienen efectivo de este pedido y siguen
  contando: por confirmar o confirmadas. Las rechazadas ya devolvieron su monto
  a lo pendiente. Null si no hay ninguna.
*/
create or replace function public.liquidaciones_del_pedido(p_pedido uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(l.numero || ' (' || replace(l.estado, '_', ' ') || ')', ', ' order by l.correlativo)
    from public.liquidacion_detalle d
    join public.liquidaciones_ubicacion l on l.id = d.liquidacion_id
   where d.pedido_id = p_pedido
     and l.estado in ('por_confirmar', 'confirmada')
$$;

revoke execute on function
  public.tomar_pedido(uuid, uuid),
  public.operacion_de_pedido_repetida(uuid, text, text),
  public.liquidaciones_del_pedido(uuid)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- RECHAZAR
-- ─────────────────────────────────────────────────────────
/*
  Lo hace quien factura en la ubicación destino (permiso «Facturar»), o el
  administrador. Necesita un motivo. El pedido pasa a «por resolver» y el aviso
  vuelve a quedar sin leer para que lo vea la ubicación que lo entregó.
*/
create or replace function public.rechazar_pedido(
  p_pedido             uuid,
  p_motivo             text,
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario  usuarios;
  v_pedido   pedidos_ubicacion;
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_huella   text;
  v_bloqueo  text;
  v_destino  text;
begin
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid()
     and u.activo
     and not u.debe_cambiar_contrasena
   limit 1
     for share;

  if v_usuario.id is null or v_usuario.rol = 'contador' or not usuario_tiene_permiso('pos') then
    raise exception 'No tienes permiso para rechazar pedidos' using errcode = '42501';
  end if;

  if p_clave_idempotencia is null or btrim(p_clave_idempotencia) = '' then
    raise exception 'Falta la clave de la operación' using errcode = 'PI001';
  end if;

  if char_length(v_motivo) < 5 or char_length(v_motivo) > 500 then
    raise exception 'Escribe el motivo del rechazo (de 5 a 500 caracteres)' using errcode = 'PI001';
  end if;

  v_pedido := tomar_pedido(v_usuario.empresa_id, p_pedido);
  v_huella := concat_ws('|', 'rechazar', p_pedido::text, v_motivo);

  if operacion_de_pedido_repetida(v_usuario.empresa_id, p_clave_idempotencia, v_huella) then
    return resumen_de_pedido(p_pedido) || jsonb_build_object('repetido', true);
  end if;

  if v_usuario.rol <> 'admin' and v_usuario.ubicacion_id is distinct from v_pedido.destino_id then
    raise exception 'Solo la ubicación que debe facturar el pedido puede rechazarlo' using errcode = '42501';
  end if;

  if v_pedido.estado <> 'pendiente' then
    raise exception '%', case v_pedido.estado
        when 'por_resolver' then 'El pedido ' || v_pedido.numero || ' ya fue rechazado y espera que lo resuelva la ubicación que lo entregó'
        when 'facturado' then 'El pedido ' || v_pedido.numero || ' ya está facturado: no se puede rechazar'
        else 'El pedido ' || v_pedido.numero || ' está ' || v_pedido.estado || ': no se puede rechazar'
      end
      using errcode = 'PI012';
  end if;

  v_bloqueo := liquidaciones_del_pedido(p_pedido);

  if v_bloqueo is not null then
    raise exception 'El efectivo de este pedido ya está en la liquidación %. Mientras siga ahí, el pedido no se puede rechazar: si está por confirmar, quien la recibe puede rechazarla en Liquidaciones; si ya está confirmada, consulta con el administrador', v_bloqueo
      using errcode = 'PI013';
  end if;

  select u.nombre into v_destino from ubicaciones u where u.id = v_pedido.destino_id;

  update pedidos_ubicacion set estado = 'por_resolver' where id = p_pedido;

  insert into eventos_de_pedido (
    empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle, clave_idempotencia, huella
  ) values (
    v_usuario.empresa_id, p_pedido, 'rechazado', v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id, v_motivo,
    jsonb_build_object('destino_id', v_pedido.destino_id, 'destino', v_destino),
    p_clave_idempotencia, v_huella
  );

  -- El aviso es nuevo para todos: ahora le toca a la ubicación que entregó.
  delete from pedido_lecturas where pedido_id = p_pedido;

  return resumen_de_pedido(p_pedido) || jsonb_build_object('repetido', false);
end $$;

revoke execute on function public.rechazar_pedido(uuid, text, text) from public, anon;
grant execute on function public.rechazar_pedido(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────
-- RESOLVER
-- ─────────────────────────────────────────────────────────
/*
  Lo hace quien tiene «Resolver pedidos interubicación» en la ubicación que
  entregó el pedido, o el administrador. La ubicación de la factura siempre sale
  del pedido o de las ubicaciones de la empresa, nunca de la del administrador.

  `p_decision`:
  - 'reenviar': el mismo pedido vuelve a pendiente para `p_destino`, que debe
    ser otra ubicación activa que factura (ni la de origen ni la que lo
    rechazó). Esa ubicación recibe el aviso.
  - 'facturar_en_origen': la ubicación que lo entregó lo factura, en esta misma
    operación, con facturar_pedido(). Necesita también «Facturar». No queda
    ningún momento en que otra ubicación pueda facturarlo.

  `p_nota`: opcional, queda en la historia junto a quién resolvió.
*/
create or replace function public.resolver_pedido(
  p_pedido             uuid,
  p_decision           text,
  p_destino            uuid default null,
  p_nota               text default '',
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario  usuarios;
  v_pedido   pedidos_ubicacion;
  v_nota     text := btrim(coalesce(p_nota, ''));
  v_huella   text;
  v_bloqueo  text;
  v_origen   ubicaciones;
  v_anterior ubicaciones;
  v_nuevo    ubicaciones;
  v_tasa     numeric;
begin
  select u.* into v_usuario
    from usuarios u
   where u.auth_id = auth.uid()
     and u.activo
     and not u.debe_cambiar_contrasena
   limit 1
     for share;

  if v_usuario.id is null or v_usuario.rol = 'contador' then
    raise exception 'No tienes permiso para resolver pedidos' using errcode = '42501';
  end if;

  if p_clave_idempotencia is null or btrim(p_clave_idempotencia) = '' then
    raise exception 'Falta la clave de la operación' using errcode = 'PI001';
  end if;

  if coalesce(p_decision, '') not in ('reenviar', 'facturar_en_origen') then
    raise exception 'Decisión desconocida: %', p_decision using errcode = 'PI001';
  end if;

  if char_length(v_nota) > 500 then
    raise exception 'La nota es demasiado larga (500 caracteres como máximo)' using errcode = 'PI001';
  end if;

  v_pedido := tomar_pedido(v_usuario.empresa_id, p_pedido);
  v_huella := concat_ws('|', 'resolver', p_pedido::text, p_decision,
                        case when p_decision = 'reenviar' then coalesce(p_destino::text, '-') else '-' end, v_nota);

  if operacion_de_pedido_repetida(v_usuario.empresa_id, p_clave_idempotencia, v_huella) then
    return resumen_de_pedido(p_pedido) || jsonb_build_object('repetido', true, 'decision', p_decision);
  end if;

  if not usuario_puede_resolver_pedido(p_pedido)
     or (v_usuario.rol <> 'admin' and v_usuario.ubicacion_id is distinct from v_pedido.origen_id) then
    raise exception 'Resuelve los pedidos rechazados quien tiene «Resolver pedidos interubicación» en la ubicación que los entregó'
      using errcode = '42501';
  end if;

  if v_pedido.estado <> 'por_resolver' then
    raise exception 'El pedido % no está por resolver: está %', v_pedido.numero, replace(v_pedido.estado, '_', ' ')
      using errcode = 'PI012';
  end if;

  v_bloqueo := liquidaciones_del_pedido(p_pedido);

  if v_bloqueo is not null then
    raise exception 'El efectivo de este pedido ya está en la liquidación %. Mientras siga ahí, el pedido no puede cambiar de ubicación', v_bloqueo
      using errcode = 'PI013';
  end if;

  select * into v_origen from ubicaciones where id = v_pedido.origen_id;
  select * into v_anterior from ubicaciones where id = v_pedido.destino_id;

  if p_decision = 'facturar_en_origen' then
    if not usuario_tiene_permiso('pos') then
      raise exception 'Para facturar en % necesitas también el permiso «Facturar»', v_origen.nombre
        using errcode = '42501';
    end if;

    insert into eventos_de_pedido (
      empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle, clave_idempotencia, huella
    ) values (
      v_usuario.empresa_id, p_pedido, 'facturar_en_origen', v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id, v_nota,
      jsonb_build_object('desde_id', v_anterior.id, 'desde', v_anterior.nombre, 'hacia_id', v_origen.id, 'hacia', v_origen.nombre),
      p_clave_idempotencia, v_huella
    );

    update pedidos_ubicacion set estado = 'pendiente', destino_id = v_origen.id where id = p_pedido;

    -- La factura de siempre: una sola, con la numeración de la empresa y los datos del pedido.
    return facturar_pedido(p_pedido) || jsonb_build_object('repetido', false, 'decision', p_decision);
  end if;

  -- ── reenviar ──
  select * into v_nuevo from ubicaciones where id = p_destino and empresa_id = v_usuario.empresa_id;

  if v_nuevo.id is null then
    raise exception 'Elige la ubicación que facturará el pedido' using errcode = 'PI003';
  end if;

  if v_nuevo.id = v_origen.id then
    raise exception 'Para que lo facture %, usa «Facturar en %»', v_origen.nombre, v_origen.nombre using errcode = 'PI003';
  end if;

  if v_nuevo.id = v_anterior.id then
    raise exception '% rechazó este pedido: elige otra ubicación', v_anterior.nombre using errcode = 'PI003';
  end if;

  if not v_nuevo.activa or not v_nuevo.vende then
    raise exception 'La ubicación «%» no puede recibir pedidos: está desactivada o no factura', v_nuevo.nombre
      using errcode = 'PI003';
  end if;

  select e.tasa_isv into v_tasa from empresas e where e.id = v_usuario.empresa_id;

  if v_nuevo.emite_fiscal and v_pedido.tasa_isv = 0 and coalesce(v_tasa, 15) > 0 then
    raise exception 'La ubicación «%» emite facturas fiscales y el pedido se armó sin ISV', v_nuevo.nombre
      using errcode = 'PI009';
  end if;

  insert into eventos_de_pedido (
    empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle, clave_idempotencia, huella
  ) values (
    v_usuario.empresa_id, p_pedido, 'reenviado', v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id, v_nota,
    jsonb_build_object('desde_id', v_anterior.id, 'desde', v_anterior.nombre, 'hacia_id', v_nuevo.id, 'hacia', v_nuevo.nombre),
    p_clave_idempotencia, v_huella
  );

  update pedidos_ubicacion set estado = 'pendiente', destino_id = v_nuevo.id where id = p_pedido;

  -- Un aviso nuevo para la ubicación que ahora debe facturarlo.
  delete from pedido_lecturas where pedido_id = p_pedido;

  return resumen_de_pedido(p_pedido) || jsonb_build_object('repetido', false, 'decision', p_decision);
end $$;

revoke execute on function public.resolver_pedido(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.resolver_pedido(uuid, text, uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────
-- LO QUE SE ENVUELVE
-- ─────────────────────────────────────────────────────────
/*
  Cinco funciones de la 0045 y la 0046 pasan a llamarse <nombre>_base sin
  cambiar una línea; la función con el nombre de siempre las llama y agrega lo
  de esta etapa. Solo se renombran la primera vez.
*/
do $$
declare
  v_firma text;
begin
  foreach v_firma in array array[
    'saldos_de_pedidos(uuid)',
    'detalle_de_pedido(uuid)',
    'avisos_de_pedidos()',
    'reporte_diario_de_caja(date, uuid)',
    'reporte_medios_de_caja(date, uuid)'
  ]
  loop
    if to_regprocedure('public.' || replace(v_firma, '(', '_base(')) is null then
      execute format('alter function public.%s rename to %I', v_firma, split_part(v_firma, '(', 1) || '_base');
    end if;
  end loop;
end $$;

-- Las versiones base solo se llaman desde las nuevas; los reportes, que son de
-- quien consulta, siguen pudiendo llamarlas (y exigen administrador).
revoke execute on function
  public.detalle_de_pedido_base(uuid),
  public.avisos_de_pedidos_base()
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- LO QUE HAY POR LIQUIDAR
-- ─────────────────────────────────────────────────────────
/*
  Lo de la 0046, menos dos casos en que el efectivo no se le debe a otra
  ubicación:
  - el pedido se facturó en su origen: quien cobró es quien factura;
  - el pedido está por resolver: todavía no se sabe quién lo factura.
  Al enviarlo a otra ubicación, su efectivo pasa al par nuevo.
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
  select s.*
    from public.saldos_de_pedidos_base(p_empresa) s
   where s.origen_id <> s.destino_id
     and s.estado <> 'por_resolver'
$$;

revoke execute on function public.saldos_de_pedidos(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- EL DETALLE
-- ─────────────────────────────────────────────────────────
/*
  El de la 0045 (que ya valida quién lo ve) más lo que necesita la pantalla
  para rechazar y resolver: qué puede hacer quien pregunta, el rechazo vigente,
  a dónde se puede reenviar, si una liquidación lo bloquea, y la historia con
  ubicaciones y cambios de destino.
*/
create or replace function public.detalle_de_pedido(p_pedido uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base      jsonb := public.detalle_de_pedido_base(p_pedido);
  v_pedido    public.pedidos_ubicacion;
  v_admin     boolean := coalesce(public.usuario_es_admin(), false);
  v_aqui      uuid := public.ubicacion_del_usuario();
  v_factura   boolean := not coalesce(public.usuario_es_contador(), false) and public.usuario_tiene_permiso('pos');
  v_resuelve  boolean;
  v_origen    public.ubicaciones;
begin
  select p.* into v_pedido from public.pedidos_ubicacion p where p.id = p_pedido;
  select u.* into v_origen from public.ubicaciones u where u.id = v_pedido.origen_id;

  v_resuelve := coalesce(
    v_pedido.estado = 'por_resolver'
    and public.usuario_puede_resolver_pedido(v_pedido.id)
    and (v_admin or v_aqui = v_pedido.origen_id),
    false);

  return v_base || jsonb_build_object(
    'factura_en_origen', v_pedido.origen_id = v_pedido.destino_id,
    'puede_rechazar', coalesce(
      v_pedido.estado = 'pendiente' and v_factura and (v_admin or v_aqui = v_pedido.destino_id),
      false),
    'puede_resolver', v_resuelve,
    'puede_facturar_en_origen', v_resuelve and v_factura and v_origen.activa and v_origen.vende,
    'bloqueo_por_liquidacion', case
      when v_pedido.estado in ('pendiente', 'por_resolver') then public.liquidaciones_del_pedido(v_pedido.id)
    end,
    'rechazo', case when v_pedido.estado = 'por_resolver' then (
      select jsonb_build_object('motivo', e.motivo, 'usuario', e.usuario_nombre, 'ubicacion', e.detalle->>'destino', 'fecha', e.creado_en)
        from public.eventos_de_pedido e
       where e.pedido_id = v_pedido.id and e.tipo = 'rechazado'
       order by e.creado_en desc, e.id desc
       limit 1
    ) end,
    'destinos_para_reenviar', case when v_resuelve then coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre)
        from public.ubicaciones u
       where u.empresa_id = v_pedido.empresa_id
         and u.activa and u.vende
         and u.id not in (v_pedido.origen_id, v_pedido.destino_id)
         and not (u.emite_fiscal and v_pedido.tasa_isv = 0
                  and coalesce((select m.tasa_isv from public.empresas m where m.id = v_pedido.empresa_id), 15) > 0)
    ), '[]'::jsonb) else '[]'::jsonb end,
    'eventos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'tipo', e.tipo, 'usuario', e.usuario_nombre, 'motivo', e.motivo, 'fecha', e.creado_en,
                 'ubicacion', u.nombre, 'rechazado_en', e.detalle->>'destino',
                 'desde', e.detalle->>'desde', 'hacia', e.detalle->>'hacia', 'factura', e.detalle->>'numero_factura'
               )
               order by e.creado_en, e.id
             )
        from public.eventos_de_pedido e
        left join public.ubicaciones u on u.id = e.ubicacion_usuario
       where e.pedido_id = v_pedido.id
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.detalle_de_pedido(uuid) from public, anon;
grant execute on function public.detalle_de_pedido(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────
-- LA CAMPANITA
-- ─────────────────────────────────────────────────────────
/*
  Lo de la 0045 (pendientes de facturar en la ubicación del usuario) más los
  pedidos que entregó su ubicación y que otra rechazó: esos primero, porque
  esperan una decisión. El administrador ve los de toda la empresa; el
  contador, nada.
*/
create or replace function public.avisos_de_pedidos()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  base as (
    select public.avisos_de_pedidos_base() as b
  ),
  rechazados as (
    select q.id, q.numero, q.nombre_cliente, q.total, q.entregado_en,
           o.nombre as origen, d.nombre as destino, r.motivo, r.creado_en as rechazado_en,
           exists (
             select 1 from public.pedido_lecturas l
              where l.pedido_id = q.id and l.usuario_id = public.usuario_actual()
           ) as leido
      from public.pedidos_de_la_bandeja('enviados') q
      join public.ubicaciones o on o.id = q.origen_id
      join public.ubicaciones d on d.id = q.destino_id
      left join lateral (
        select e.motivo, e.creado_en
          from public.eventos_de_pedido e
         where e.pedido_id = q.id and e.tipo = 'rechazado'
         order by e.creado_en desc, e.id desc
         limit 1
      ) r on true
     where q.estado = 'por_resolver'
       and not coalesce(public.usuario_es_contador(), false)
       and public.usuario_tiene_permiso('pos')
  )
  select base.b || jsonb_build_object(
    'por_resolver', (select count(*) from rechazados),
    'por_resolver_sin_leer', (select count(*) from rechazados where not leido),
    'ultimos', coalesce((
      select jsonb_agg(x.fila order by x.orden, x.fecha desc)
        from (
          select y.orden, y.fecha, y.fila
            from (
              select 0 as orden, r.rechazado_en as fecha,
                     jsonb_build_object(
                       'pedido_id', r.id, 'numero', r.numero, 'estado', 'por_resolver',
                       'origen', r.origen, 'destino', r.destino, 'nombre_cliente', r.nombre_cliente,
                       'total', r.total, 'entregado_en', r.entregado_en,
                       'motivo', r.motivo, 'rechazado_en', r.rechazado_en, 'leido', r.leido
                     ) as fila
                from rechazados r
              union all
              select 1, (u->>'entregado_en')::timestamptz, u || jsonb_build_object('estado', 'pendiente')
                from jsonb_array_elements(base.b->'ultimos') u
            ) y
           order by y.orden, y.fecha desc
           limit 8
        ) x
    ), '[]'::jsonb)
  )
    from base
$$;

revoke execute on function public.avisos_de_pedidos() from public, anon;
grant execute on function public.avisos_de_pedidos() to authenticated;

-- ─────────────────────────────────────────────────────────
-- LOS REPORTES DE CAJA
-- ─────────────────────────────────────────────────────────
/*
  Un pedido facturado en su origen cobró y facturó en la misma ubicación. Su
  dinero sigue contando como siempre —en la ubicación, el día y con el medio del
  cobro—, pero no es «cobrado por cuenta de otra ubicación». Estos son esos
  cobros, para restarlos de esa cifra. Solo administradores, como los reportes.
*/
create or replace function public.cobros_de_pedidos_en_origen(p_dia date, p_ubicacion uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'ubicacion_id', c.ubicacion_id, 'monto', c.monto)), '[]'::jsonb)
    from public.cobros_por_medio c
    join public.pedidos_ubicacion p on p.id = c.pedido_id
   where coalesce(public.usuario_es_admin(), false)
     and c.empresa_id = public.empresa_del_usuario()
     and p.origen_id = p.destino_id
     and c.fecha >= p_dia::timestamp at time zone 'America/Tegucigalpa'
     and c.fecha < (p_dia + 1)::timestamp at time zone 'America/Tegucigalpa'
     and (p_ubicacion is null or c.ubicacion_id = p_ubicacion)
$$;

revoke execute on function public.cobros_de_pedidos_en_origen(date, uuid) from public, anon;
grant execute on function public.cobros_de_pedidos_en_origen(date, uuid) to authenticated;

-- La lista de cobros de pedidos sin los de `p_quitar`.
create or replace function public.cobros_sin(p_cobros jsonb, p_quitar jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(c.fila order by c.n), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_cobros, '[]'::jsonb)) with ordinality c(fila, n)
   where not exists (select 1 from jsonb_array_elements(p_quitar) q where q->>'id' = c.fila->>'id')
$$;

revoke execute on function public.cobros_sin(jsonb, jsonb) from public, anon;
grant execute on function public.cobros_sin(jsonb, jsonb) to authenticated;

-- Resta los cobros propios de la cifra `p_campo` de cada fila de `p_filas`.
create or replace function public.filas_sin_cobros_propios(p_filas jsonb, p_campo text, p_quitar jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           u.fila || jsonb_build_object(p_campo,
             (u.fila->>p_campo)::numeric - public.sumar_de(p_quitar, 'monto', u.fila->>'ubicacion_id'))
           order by u.n), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) with ordinality u(fila, n)
$$;

revoke execute on function public.filas_sin_cobros_propios(jsonb, text, jsonb) from public, anon;
grant execute on function public.filas_sin_cobros_propios(jsonb, text, jsonb) to authenticated;

create or replace function public.reporte_diario_de_caja(p_dia date default null, p_ubicacion uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base   jsonb := public.reporte_diario_de_caja_base(p_dia, p_ubicacion);
  v_propio jsonb := public.cobros_de_pedidos_en_origen((v_base->>'dia')::date, p_ubicacion);
  v_i      jsonb := v_base->'indicadores';
begin
  if jsonb_array_length(v_propio) = 0 then
    return v_base;
  end if;

  return v_base || jsonb_build_object(
    'indicadores', v_i || jsonb_build_object(
      'cobros_por_cuenta_de_otras', (v_i->>'cobros_por_cuenta_de_otras')::numeric - public.sumar_de(v_propio, 'monto'),
      'cobros_por_cuenta_de_otras_cantidad', (v_i->>'cobros_por_cuenta_de_otras_cantidad')::int - jsonb_array_length(v_propio)
    ),
    'por_ubicacion', public.filas_sin_cobros_propios(v_base->'por_ubicacion', 'cobros_por_cuenta_de_otras', v_propio),
    'cobros_de_pedidos', public.cobros_sin(v_base->'cobros_de_pedidos', v_propio)
  );
end $$;

create or replace function public.reporte_medios_de_caja(p_dia date default null, p_ubicacion uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base   jsonb := public.reporte_medios_de_caja_base(p_dia, p_ubicacion);
  v_propio jsonb := public.cobros_de_pedidos_en_origen(
                      coalesce(p_dia, (now() at time zone 'America/Tegucigalpa')::date), p_ubicacion);
  v_t      jsonb := v_base->'totales';
begin
  if jsonb_array_length(v_propio) = 0 then
    return v_base;
  end if;

  return v_base || jsonb_build_object(
    'totales', v_t || jsonb_build_object(
      'por_cuenta_de_otras', (v_t->>'por_cuenta_de_otras')::numeric - public.sumar_de(v_propio, 'monto')
    ),
    'por_ubicacion', public.filas_sin_cobros_propios(v_base->'por_ubicacion', 'por_cuenta_de_otras', v_propio),
    'cobros_de_pedidos', public.cobros_sin(v_base->'cobros_de_pedidos', v_propio)
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
