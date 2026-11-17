-- Pedidos interubicación, etapa C2a: cancelar un pedido antes de facturarlo,
-- recibir los productos que devuelve el cliente y devolverle su dinero.
--
-- Tres hechos distintos, cada uno con su propio registro:
-- - la cancelación (cancelaciones_de_pedido): el pedido deja de poder
--   facturarse. No mueve inventario ni dinero;
-- - la recepción física (recepciones_de_pedido): qué productos volvieron, a qué
--   ubicación y en qué estado. Solo lo que vuelve en buen estado suma
--   existencias, y solo en la ubicación que lo recibió;
-- - el reembolso (reembolsos_de_pedido): cada entrega de dinero al cliente, por
--   medio. Lo pendiente no es un registro: es lo cobrado menos lo devuelto.
-- Los tres pueden hacerse en la misma operación o después. Nada de lo cobrado
-- se modifica ni se borra.
--
-- Decisiones del propietario (2026-11-17):
-- - se devuelve lo realmente recibido, cargo de tarjeta o enlace incluido, con
--   los importes históricos;
-- - el efectivo se devuelve en efectivo desde el origen o el destino del pedido;
--   transferencia, tarjeta y enlace los devuelve solo el administrador, con
--   referencia, porque salen de la cuenta de la empresa;
-- - un reembolso puede hacerse en varias entregas, nunca por más de lo pendiente
--   de cada medio;
-- - un empleado con «Autorizar cancelación de pedidos» recibe productos solo en
--   su ubicación, si es el origen o el destino. En otra ubicación, solo el
--   administrador, con una nota que respalde la recepción.
--
-- Liquidaciones: un pedido cancelado ya no se le debe al destino. Lo único que
-- queda entre ubicaciones es el efectivo que el destino haya devuelto al
-- cliente por cuenta del origen. Con efectivo del pedido en una liquidación por
-- confirmar o confirmada no se cancela (PI013); reembolsar desde una tercera
-- ubicación tampoco: las dos cosas son de la etapa C2b.
--
-- Errores nuevos: PI014 recepción no válida; PI015 reembolso no válido. Además
-- PI001, PI008, PI011, PI012, PI013 y 42501.
--
-- No cambia ninguna fila existente. Idempotente.

-- ─────────────────────────────────────────────────────────
-- LA HISTORIA
-- ─────────────────────────────────────────────────────────
do $$
declare
  v_restriccion text;
begin
  for v_restriccion in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.eventos_de_pedido'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%cancelacion_solicitada%'
  loop
    execute format('alter table public.eventos_de_pedido drop constraint %I', v_restriccion);
  end loop;
end $$;

alter table public.eventos_de_pedido
  add constraint eventos_de_pedido_tipo_check
  check (tipo in (
    'entregado', 'facturado',
    'rechazado', 'reenviado', 'facturar_en_origen',
    'cancelacion_solicitada', 'cancelacion_autorizada', 'cancelacion_rechazada',
    'cancelado', 'devolucion_recibida', 'reembolso_registrado'
  ));

-- ─────────────────────────────────────────────────────────
-- LA CANCELACIÓN
-- ─────────────────────────────────────────────────────────
/*
  Una por pedido. Guarda lo que se recibió del cliente al cancelar (principal y
  cargo, tal como se cobraron): eso es lo que hay que devolverle.
*/
create table if not exists public.cancelaciones_de_pedido (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references public.empresas (id),
  pedido_id              uuid not null unique,
  estado_anterior        text not null check (estado_anterior in ('pendiente', 'por_resolver')),
  motivo                 text not null check (char_length(btrim(motivo)) between 5 and 500),
  usuario_id             uuid not null references public.usuarios (id),
  usuario_nombre         text not null,
  ubicacion_usuario      uuid,
  principal_recibido     numeric(12,2) not null check (principal_recibido >= 0),
  cargo_recibido         numeric(12,2) not null check (cargo_recibido >= 0),
  cancelado_en           timestamptz not null default now(),
  clave_idempotencia     text not null check (btrim(clave_idempotencia) <> ''),
  huella                 text not null,

  constraint cancelaciones_del_pedido foreign key (pedido_id, empresa_id)
    references public.pedidos_ubicacion (id, empresa_id),
  constraint cancelaciones_clave_unica unique (empresa_id, clave_idempotencia)
);

-- ─────────────────────────────────────────────────────────
-- LA RECEPCIÓN DE LOS PRODUCTOS
-- ─────────────────────────────────────────────────────────
/*
  Cada vez que el cliente devuelve algo: dónde se recibió, quién lo recibió y,
  por producto, cuántas unidades y en qué estado. `en_otra_ubicacion`: la
  recibió una ubicación que no es ni el origen ni el destino (solo el
  administrador, con nota).
*/
create table if not exists public.recepciones_de_pedido (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas (id),
  pedido_id           uuid not null,
  ubicacion_id        uuid not null,
  en_otra_ubicacion   boolean not null default false,
  nota                text not null default '' check (char_length(nota) <= 500),
  usuario_id          uuid not null references public.usuarios (id),
  usuario_nombre      text not null,
  ubicacion_usuario   uuid,
  recibido_en         timestamptz not null default now(),
  clave_idempotencia  text not null check (btrim(clave_idempotencia) <> ''),
  huella              text not null,

  constraint recepciones_del_pedido foreign key (pedido_id, empresa_id)
    references public.pedidos_ubicacion (id, empresa_id),
  constraint recepciones_en_una_ubicacion_de_la_empresa foreign key (ubicacion_id, empresa_id)
    references public.ubicaciones (id, empresa_id),
  constraint recepciones_clave_unica unique (empresa_id, clave_idempotencia),
  constraint recepciones_en_otra_ubicacion_con_nota check (not en_otra_ubicacion or char_length(btrim(nota)) >= 5)
);

create unique index if not exists recepciones_id_empresa on public.recepciones_de_pedido (id, empresa_id);
create index if not exists idx_recepciones_pedido on public.recepciones_de_pedido (pedido_id);

create table if not exists public.recepcion_detalle (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id),
  recepcion_id  uuid not null,
  pedido_id     uuid not null,
  producto_id   uuid not null,
  cantidad      integer not null check (cantidad > 0),
  condicion     text not null check (condicion in ('buen_estado', 'danado')),

  constraint recepcion_detalle_de_la_recepcion foreign key (recepcion_id, empresa_id)
    references public.recepciones_de_pedido (id, empresa_id),
  constraint recepcion_detalle_del_pedido foreign key (pedido_id, empresa_id)
    references public.pedidos_ubicacion (id, empresa_id),
  constraint recepcion_detalle_un_renglon unique (recepcion_id, producto_id, condicion)
);

create index if not exists idx_recepcion_detalle_pedido on public.recepcion_detalle (pedido_id, producto_id);

/*
  Lo que vuelve en buen estado entra al Kardex como 'devolucion', ligado a su
  recepción: un producto de una recepción entra una sola vez.
*/
alter table public.movimientos_inventario
  add column if not exists recepcion_id uuid references public.recepciones_de_pedido (id);

alter table public.movimientos_inventario drop constraint if exists movimientos_devolucion_de_un_pedido;
alter table public.movimientos_inventario add constraint movimientos_devolucion_de_un_pedido
  check (recepcion_id is null or (tipo = 'devolucion' and pedido_id is not null and cantidad > 0 and venta_id is null));

create unique index if not exists movimientos_devolucion_una_vez
  on public.movimientos_inventario (recepcion_id, producto_id)
  where recepcion_id is not null;

-- ─────────────────────────────────────────────────────────
-- LOS REEMBOLSOS
-- ─────────────────────────────────────────────────────────
/*
  Cada entrega de dinero al cliente, con su medio. El efectivo sale de una
  ubicación (la que pagó); lo electrónico sale de la cuenta de la empresa y
  lleva la referencia de la devolución.
*/
create table if not exists public.reembolsos_de_pedido (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas (id),
  pedido_id           uuid not null,
  medio               text not null check (medio in ('efectivo', 'transferencia', 'tarjeta', 'enlace')),
  importe             numeric(12,2) not null check (importe > 0),
  ubicacion_id        uuid,
  referencia          text not null default '' check (char_length(referencia) <= 120),
  usuario_id          uuid not null references public.usuarios (id),
  usuario_nombre      text not null,
  usuario_rol         text not null,
  ubicacion_usuario   uuid,
  reembolsado_en      timestamptz not null default now(),
  clave_idempotencia  text not null check (btrim(clave_idempotencia) <> ''),
  huella              text not null,

  constraint reembolsos_del_pedido foreign key (pedido_id, empresa_id)
    references public.pedidos_ubicacion (id, empresa_id),
  constraint reembolsos_desde_una_ubicacion_de_la_empresa foreign key (ubicacion_id, empresa_id)
    references public.ubicaciones (id, empresa_id),
  constraint reembolsos_clave_unica unique (empresa_id, clave_idempotencia),
  constraint reembolsos_efectivo_desde_una_ubicacion check ((medio = 'efectivo') = (ubicacion_id is not null)),
  constraint reembolsos_electronicos_con_referencia check (medio = 'efectivo' or char_length(btrim(referencia)) > 0)
);

create index if not exists idx_reembolsos_pedido on public.reembolsos_de_pedido (pedido_id);
create index if not exists idx_reembolsos_fecha on public.reembolsos_de_pedido (empresa_id, reembolsado_en);

-- ─────────────────────────────────────────────────────────
-- SOLO SE AGREGA, Y SOLO DESDE LAS FUNCIONES
-- ─────────────────────────────────────────────────────────
revoke all on public.cancelaciones_de_pedido, public.recepciones_de_pedido, public.recepcion_detalle, public.reembolsos_de_pedido
  from public, anon, authenticated;
grant select on public.cancelaciones_de_pedido, public.recepciones_de_pedido, public.recepcion_detalle, public.reembolsos_de_pedido
  to authenticated;
grant all on public.cancelaciones_de_pedido, public.recepciones_de_pedido, public.recepcion_detalle, public.reembolsos_de_pedido
  to service_role;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['cancelaciones_de_pedido', 'recepciones_de_pedido', 'recepcion_detalle', 'reembolsos_de_pedido']
  loop
    execute format('drop trigger if exists %1$s_inmutable on public.%1$I', v_tabla);
    execute format(
      'create trigger %1$s_inmutable before update or delete on public.%1$I
         for each row execute function public.registro_de_pedido_inmutable()', v_tabla);

    execute format('drop trigger if exists %1$s_sin_vaciar on public.%1$I', v_tabla);
    execute format(
      'create trigger %1$s_sin_vaciar before truncate on public.%1$I
         for each statement execute function public.registro_de_pedido_inmutable()', v_tabla);

    execute format('drop trigger if exists impedir_escritura_del_contador on public.%I', v_tabla);
    execute format(
      'create trigger impedir_escritura_del_contador
         before insert or update or delete or truncate on public.%I
         for each statement execute function public.impedir_escritura_del_contador()', v_tabla);

    -- Se ven si se ve su pedido.
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('drop policy if exists %1$s_lectura on public.%1$I', v_tabla);
    execute format(
      'create policy %1$s_lectura on public.%1$I for select to authenticated
         using (empresa_id = (select public.empresa_del_usuario())
                and exists (select 1 from public.pedidos_ubicacion p where p.id = %1$I.pedido_id))', v_tabla);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────
-- LAS TRANSICIONES
-- ─────────────────────────────────────────────────────────
/*
  Las de la 0048 más la cancelación: un pedido pendiente o por resolver pasa a
  cancelado, y solo cambia su estado. Un pedido cancelado o facturado ya no
  cambia. Para cada transición, `v_cambia` dice qué columnas puede tocar.
*/
create or replace function public.pedido_solo_avanza()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cambia text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un pedido no se borra' using errcode = '42501';
  end if;

  v_cambia := case
    when old.estado = 'pendiente' and new.estado = 'facturado' and new.venta_id is not null
      then array['estado', 'venta_id', 'facturado_por', 'facturado_por_nombre', 'facturado_en']
    when old.estado = 'pendiente' and new.estado = 'por_resolver'
      then array['estado']
    when old.estado = 'por_resolver' and new.estado = 'pendiente' and new.destino_id <> old.destino_id
      then array['estado', 'destino_id']
    when old.estado in ('pendiente', 'por_resolver') and new.estado = 'cancelado'
      then array['estado']
  end;

  if v_cambia is null then
    raise exception '%', case old.estado
        when 'pendiente' then 'Un pedido pendiente solo puede pasar a facturado, a por resolver o a cancelado'
        when 'por_resolver' then 'Un pedido por resolver solo vuelve a pendiente con otra ubicación destino, o se cancela'
        else 'Un pedido ' || old.estado || ' ya no cambia'
      end
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - v_cambia) <> (to_jsonb(old) - v_cambia) then
    raise exception 'Los datos de un pedido entregado no se modifican' using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function public.pedido_solo_avanza() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- LO QUE HAY QUE DEVOLVER
-- ─────────────────────────────────────────────────────────
/*
  Por medio: lo cobrado (principal y cargo), lo ya devuelto y lo pendiente.
  Pieza interna: no revisa permisos.
*/
create or replace function public.dinero_a_devolver(p_pedido uuid)
returns table (medio text, monto numeric, cargo numeric, total numeric, devuelto numeric, pendiente numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select c.medio, c.monto, c.cargo, c.monto + c.cargo,
         coalesce(r.devuelto, 0),
         c.monto + c.cargo - coalesce(r.devuelto, 0)
    from (
      select cm.medio, sum(cm.monto) as monto, sum(cm.cargo) as cargo
        from public.cobros_por_medio cm
       where cm.pedido_id = p_pedido
       group by cm.medio
    ) c
    left join (
      select x.medio, sum(x.importe) as devuelto
        from public.reembolsos_de_pedido x
       where x.pedido_id = p_pedido
       group by x.medio
    ) r on r.medio = c.medio
$$;

-- Por producto: lo entregado, lo recibido de vuelta en cada estado y lo que falta.
create or replace function public.productos_por_recibir(p_pedido uuid)
returns table (producto_id uuid, nombre text, entregado integer, buen_estado integer, danado integer, pendiente integer)
language sql
stable
security definer
set search_path = ''
as $$
  select d.producto_id, d.nombre, d.cantidad,
         coalesce(r.bueno, 0)::integer, coalesce(r.danado, 0)::integer,
         (d.cantidad - coalesce(r.bueno, 0) - coalesce(r.danado, 0))::integer
    from public.pedido_detalle d
    left join (
      select x.producto_id,
             sum(x.cantidad) filter (where x.condicion = 'buen_estado') as bueno,
             sum(x.cantidad) filter (where x.condicion = 'danado') as danado
        from public.recepcion_detalle x
       where x.pedido_id = p_pedido
       group by x.producto_id
    ) r on r.producto_id = d.producto_id
   where d.pedido_id = p_pedido
$$;

revoke execute on function
  public.dinero_a_devolver(uuid),
  public.productos_por_recibir(uuid)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- RECIBIR (pieza interna)
-- ─────────────────────────────────────────────────────────
/*
  Con el pedido ya bloqueado y el usuario ya autorizado. `p_productos`:
  [{producto_id, cantidad, condicion}]. La ubicación es donde se recibió de
  verdad: el empleado, la suya (si es el origen o el destino); el
  administrador, cualquiera activa de la empresa, con nota si no es ninguna de
  las dos. Lo que vuelve en buen estado suma existencias allí mismo.
*/
create or replace function public.recibir_productos_del_pedido(
  p_pedido    public.pedidos_ubicacion,
  p_usuario   public.usuarios,
  p_ubicacion uuid,
  p_productos jsonb,
  p_nota      text,
  p_clave     text,
  p_huella    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nota      text := btrim(coalesce(p_nota, ''));
  v_ubicacion public.ubicaciones;
  v_otra      boolean;
  v_id        uuid := gen_random_uuid();
  v_linea     record;
  v_exceso    text;
begin
  select u.* into v_ubicacion
    from public.ubicaciones u
   where u.id = coalesce(p_ubicacion, p_usuario.ubicacion_id)
     and u.empresa_id = p_pedido.empresa_id;

  if v_ubicacion.id is null or not v_ubicacion.activa then
    raise exception 'Elige una ubicación activa de la empresa donde se recibieron los productos' using errcode = 'PI014';
  end if;

  v_otra := v_ubicacion.id not in (p_pedido.origen_id, p_pedido.destino_id);

  if p_usuario.rol <> 'admin' and (v_ubicacion.id is distinct from p_usuario.ubicacion_id or v_otra) then
    raise exception 'Registra la recepción en tu ubicación, si es el origen o el destino del pedido. En otra ubicación, solo el administrador'
      using errcode = '42501';
  end if;

  if v_otra and char_length(v_nota) < 5 then
    raise exception 'Para recibir en «%», que no es ni el origen ni el destino, escribe una nota que respalde la recepción', v_ubicacion.nombre
      using errcode = 'PI014';
  end if;

  if char_length(v_nota) > 500 then
    raise exception 'La nota es demasiado larga (500 caracteres como máximo)' using errcode = 'PI014';
  end if;

  if jsonb_typeof(p_productos) is distinct from 'array' or jsonb_array_length(p_productos) = 0 then
    raise exception 'Indica qué productos se recibieron' using errcode = 'PI014';
  end if;

  begin
    if exists (
      select 1 from jsonb_array_elements(p_productos) e
       where jsonb_typeof(e) <> 'object'
          or (e->>'producto_id') is null
          or (e->>'cantidad')::integer <= 0
          or coalesce(e->>'condicion', '') not in ('buen_estado', 'danado')
    ) then
      raise exception 'Un producto recibido no es válido' using errcode = 'PI014';
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Un producto recibido no es válido' using errcode = 'PI014';
  end;

  -- Nunca más de lo entregado y todavía no recibido.
  select string_agg(format('«%s»: se piden %s y faltan %s', coalesce(r.nombre, 'producto que no es del pedido'), x.cantidad, coalesce(r.pendiente, 0)), '; ')
    into v_exceso
    from (
      select (e->>'producto_id')::uuid as producto_id, sum((e->>'cantidad')::integer) as cantidad
        from jsonb_array_elements(p_productos) e
       group by 1
    ) x
    left join public.productos_por_recibir(p_pedido.id) r on r.producto_id = x.producto_id
   where r.producto_id is null or x.cantidad > r.pendiente;

  if v_exceso is not null then
    raise exception 'No se puede recibir más de lo entregado: %', v_exceso using errcode = 'PI014';
  end if;

  insert into public.recepciones_de_pedido (
    id, empresa_id, pedido_id, ubicacion_id, en_otra_ubicacion, nota,
    usuario_id, usuario_nombre, ubicacion_usuario, clave_idempotencia, huella
  ) values (
    v_id, p_pedido.empresa_id, p_pedido.id, v_ubicacion.id, v_otra, v_nota,
    p_usuario.id, p_usuario.nombre, p_usuario.ubicacion_id, p_clave, p_huella
  );

  for v_linea in
    select (e->>'producto_id')::uuid as producto_id, e->>'condicion' as condicion, sum((e->>'cantidad')::integer)::integer as cantidad
      from jsonb_array_elements(p_productos) e
     group by 1, 2
     order by 1, 2
  loop
    insert into public.recepcion_detalle (empresa_id, recepcion_id, pedido_id, producto_id, cantidad, condicion)
    values (p_pedido.empresa_id, v_id, p_pedido.id, v_linea.producto_id, v_linea.cantidad, v_linea.condicion);

    if v_linea.condicion = 'buen_estado' then
      insert into public.inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
      values (p_pedido.empresa_id, v_ubicacion.id, v_linea.producto_id, 0)
      on conflict (ubicacion_id, producto_id) do nothing;

      update public.inventario_ubicacion
         set cantidad = cantidad + v_linea.cantidad,
             actualizado_en = now()
       where ubicacion_id = v_ubicacion.id
         and producto_id = v_linea.producto_id;

      insert into public.movimientos_inventario (
        empresa_id, producto_id, usuario_id, pedido_id, recepcion_id, ubicacion_id, tipo, cantidad, motivo
      ) values (
        p_pedido.empresa_id, v_linea.producto_id, p_usuario.id, p_pedido.id, v_id, v_ubicacion.id, 'devolucion', v_linea.cantidad,
        'Devolución del pedido cancelado ' || p_pedido.numero || ', recibida en ' || v_ubicacion.nombre
      );
    end if;
  end loop;

  insert into public.eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle)
  values (
    p_pedido.empresa_id, p_pedido.id, 'devolucion_recibida', p_usuario.id, p_usuario.nombre, p_usuario.ubicacion_id, v_nota,
    jsonb_build_object('recepcion_id', v_id, 'ubicacion_id', v_ubicacion.id, 'ubicacion', v_ubicacion.nombre,
                       'en_otra_ubicacion', v_otra, 'productos', p_productos)
  );

  return v_id;
end $$;

-- ─────────────────────────────────────────────────────────
-- REEMBOLSAR (pieza interna)
-- ─────────────────────────────────────────────────────────
/*
  Con el pedido ya bloqueado y el usuario ya autorizado. Una entrega de dinero
  por un medio que el cliente usó, nunca por más de lo pendiente de ese medio.
  - Efectivo: desde la ubicación del empleado, si es el origen o el destino; el
    administrador elige entre esas dos. Una tercera ubicación espera a C2b.
  - Transferencia, tarjeta y enlace: solo el administrador, con la referencia de
    la devolución hecha desde la cuenta de la empresa.
*/
create or replace function public.reembolsar_al_cliente(
  p_pedido     public.pedidos_ubicacion,
  p_usuario    public.usuarios,
  p_medio      text,
  p_importe    numeric,
  p_ubicacion  uuid,
  p_referencia text,
  p_clave      text,
  p_huella     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referencia text := btrim(coalesce(p_referencia, ''));
  v_pendiente  numeric;
  v_desde      uuid;
  v_nombre     text;
  v_id         uuid := gen_random_uuid();
begin
  if coalesce(p_medio, '') not in ('efectivo', 'transferencia', 'tarjeta', 'enlace') then
    raise exception 'Medio de reembolso desconocido: %', p_medio using errcode = 'PI015';
  end if;

  if p_importe is null or p_importe <= 0 or p_importe <> round(p_importe, 2) or p_importe >= 10000000000 then
    raise exception 'El importe del reembolso debe ser mayor que cero y tener hasta dos decimales' using errcode = 'PI015';
  end if;

  if char_length(v_referencia) > 120 then
    raise exception 'La referencia es demasiado larga' using errcode = 'PI015';
  end if;

  select d.pendiente into v_pendiente from public.dinero_a_devolver(p_pedido.id) d where d.medio = p_medio;

  if v_pendiente is null then
    raise exception 'El cliente no pagó este pedido con %: no hay nada que devolver por ese medio', p_medio using errcode = 'PI015';
  end if;

  if p_importe > v_pendiente then
    raise exception 'El reembolso (%) supera lo pendiente de devolver con % (%)',
      to_char(p_importe, 'FM999999990.00'), p_medio, to_char(v_pendiente, 'FM999999990.00')
      using errcode = 'PI015';
  end if;

  if p_medio = 'efectivo' then
    v_desde := case when p_usuario.rol = 'admin' then coalesce(p_ubicacion, p_pedido.origen_id) else p_usuario.ubicacion_id end;

    if p_usuario.rol <> 'admin' and p_ubicacion is not null and p_ubicacion is distinct from p_usuario.ubicacion_id then
      raise exception 'El efectivo se devuelve desde tu ubicación' using errcode = '42501';
    end if;

    if v_desde is null or v_desde not in (p_pedido.origen_id, p_pedido.destino_id) then
      raise exception 'El efectivo se devuelve desde el origen o el destino del pedido. Desde otra ubicación se habilitará más adelante'
        using errcode = 'PI015';
    end if;
  else
    if p_usuario.rol <> 'admin' then
      raise exception 'Las devoluciones por transferencia, tarjeta o enlace las registra el administrador' using errcode = '42501';
    end if;

    if v_referencia = '' then
      raise exception 'Escribe la referencia de la devolución hecha por %', p_medio using errcode = 'PI015';
    end if;
  end if;

  insert into public.reembolsos_de_pedido (
    id, empresa_id, pedido_id, medio, importe, ubicacion_id, referencia,
    usuario_id, usuario_nombre, usuario_rol, ubicacion_usuario, clave_idempotencia, huella
  ) values (
    v_id, p_pedido.empresa_id, p_pedido.id, p_medio, p_importe, v_desde, v_referencia,
    p_usuario.id, p_usuario.nombre, p_usuario.rol, p_usuario.ubicacion_id, p_clave, p_huella
  );

  select u.nombre into v_nombre from public.ubicaciones u where u.id = v_desde;

  insert into public.eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle)
  values (
    p_pedido.empresa_id, p_pedido.id, 'reembolso_registrado', p_usuario.id, p_usuario.nombre, p_usuario.ubicacion_id, v_referencia,
    jsonb_build_object('reembolso_id', v_id, 'medio', p_medio, 'importe', p_importe, 'ubicacion_id', v_desde, 'ubicacion', v_nombre)
  );

  return v_id;
end $$;

revoke execute on function
  public.recibir_productos_del_pedido(public.pedidos_ubicacion, public.usuarios, uuid, jsonb, text, text, text),
  public.reembolsar_al_cliente(public.pedidos_ubicacion, public.usuarios, text, numeric, uuid, text, text, text)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- QUIÉN OPERA
-- ─────────────────────────────────────────────────────────
/*
  El usuario activo que cancela, recibe o reembolsa: con «Autorizar cancelación
  de pedidos» en el origen o el destino del pedido, o administrador. Nunca el
  contador ni otra empresa (tomar_pedido ya lo limita a la empresa).
*/
create or replace function public.quien_cancela(p_pedido uuid)
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
   where u.auth_id = auth.uid()
     and u.activo
     and not u.debe_cambiar_contrasena
   limit 1;

  if v_usuario.id is null or v_usuario.rol = 'contador' or not public.usuario_puede_autorizar_cancelacion(p_pedido) then
    raise exception 'Necesitas «Autorizar cancelación de pedidos» en el origen o el destino del pedido' using errcode = '42501';
  end if;

  return v_usuario;
end $$;

revoke execute on function public.quien_cancela(uuid) from public, anon, authenticated;

-- Un error de PI001 para la clave que falta. Pieza interna.
create or replace function public.exigir_clave(p_clave text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_clave is null or btrim(p_clave) = '' then
    raise exception 'Falta la clave de la operación' using errcode = 'PI001';
  end if;
end $$;

revoke execute on function public.exigir_clave(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- CANCELAR
-- ─────────────────────────────────────────────────────────
/*
  Solo un pedido pendiente o por resolver, sin efectivo en una liquidación por
  confirmar o confirmada. En la misma operación, si se indican:
  - `p_recepcion`: {ubicacion_id, nota, productos: [{producto_id, cantidad, condicion}]};
  - `p_reembolsos`: [{medio, importe, ubicacion_id, referencia}].
  Sin ellos, los productos quedan por recibir y el dinero por devolver. Un
  reintento con la misma clave devuelve la cancelación hecha.
*/
create or replace function public.cancelar_pedido(
  p_pedido             uuid,
  p_motivo             text,
  p_recepcion          jsonb default null,
  p_reembolsos         jsonb default '[]'::jsonb,
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa   uuid := empresa_del_usuario();
  v_usuario   usuarios;
  v_pedido    pedidos_ubicacion;
  v_motivo    text := btrim(coalesce(p_motivo, ''));
  v_reembolsos jsonb := coalesce(p_reembolsos, '[]'::jsonb);
  v_huella    text;
  v_previa    cancelaciones_de_pedido;
  v_bloqueo   text;
  v_principal numeric;
  v_cargo     numeric;
  v_r         record;
begin
  perform exigir_clave(p_clave_idempotencia);

  if v_empresa is null then
    raise exception 'Inicia sesión con un usuario activo para cancelar pedidos' using errcode = '42501';
  end if;

  if char_length(v_motivo) < 5 or char_length(v_motivo) > 500 then
    raise exception 'Escribe el motivo de la cancelación (de 5 a 500 caracteres)' using errcode = 'PI001';
  end if;

  if jsonb_typeof(v_reembolsos) is distinct from 'array'
     or (p_recepcion is not null and jsonb_typeof(p_recepcion) is distinct from 'object') then
    raise exception 'Los datos de la recepción o del reembolso no son válidos' using errcode = 'PI001';
  end if;

  v_pedido := tomar_pedido(v_empresa, p_pedido);
  v_huella := concat_ws('|', 'cancelar', p_pedido::text, v_motivo, coalesce(p_recepcion::text, '-'), v_reembolsos::text);

  select c.* into v_previa from cancelaciones_de_pedido c where c.empresa_id = v_empresa and c.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_previa.huella <> v_huella then
      raise exception 'La clave % ya se usó para otra operación', p_clave_idempotencia using errcode = 'PI011';
    end if;

    return resumen_de_pedido(p_pedido) || jsonb_build_object('repetido', true);
  end if;

  v_usuario := quien_cancela(p_pedido);

  if v_pedido.estado not in ('pendiente', 'por_resolver') then
    raise exception '%', case v_pedido.estado
        when 'facturado' then 'El pedido ' || v_pedido.numero || ' ya está facturado: su anulación se hará con la anulación de facturas de pedido'
        when 'cancelado' then 'El pedido ' || v_pedido.numero || ' ya está cancelado'
        else 'El pedido ' || v_pedido.numero || ' está ' || v_pedido.estado || ': no se puede cancelar'
      end
      using errcode = 'PI012';
  end if;

  v_bloqueo := liquidaciones_del_pedido(p_pedido);

  if v_bloqueo is not null then
    raise exception 'El efectivo de este pedido ya está en la liquidación %. Mientras siga ahí, el pedido no se puede cancelar: si está por confirmar, quien la recibe puede confirmarla o rechazarla en Liquidaciones', v_bloqueo
      using errcode = 'PI013';
  end if;

  select coalesce(sum(d.monto), 0), coalesce(sum(d.cargo), 0) into v_principal, v_cargo
    from dinero_a_devolver(p_pedido) d;

  insert into cancelaciones_de_pedido (
    empresa_id, pedido_id, estado_anterior, motivo, usuario_id, usuario_nombre, ubicacion_usuario,
    principal_recibido, cargo_recibido, clave_idempotencia, huella
  ) values (
    v_empresa, p_pedido, v_pedido.estado, v_motivo, v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id,
    v_principal, v_cargo, p_clave_idempotencia, v_huella
  );

  update pedidos_ubicacion set estado = 'cancelado' where id = p_pedido;

  insert into eventos_de_pedido (empresa_id, pedido_id, tipo, usuario_id, usuario_nombre, ubicacion_usuario, motivo, detalle)
  values (
    v_empresa, p_pedido, 'cancelado', v_usuario.id, v_usuario.nombre, v_usuario.ubicacion_id, v_motivo,
    jsonb_build_object('estado_anterior', v_pedido.estado, 'principal_recibido', v_principal, 'cargo_recibido', v_cargo)
  );

  if p_recepcion is not null and jsonb_array_length(coalesce(p_recepcion->'productos', '[]'::jsonb)) > 0 then
    perform recibir_productos_del_pedido(
      v_pedido, v_usuario, (p_recepcion->>'ubicacion_id')::uuid, p_recepcion->'productos', p_recepcion->>'nota',
      p_clave_idempotencia || '|recepcion', v_huella);
  end if;

  for v_r in select e, n from jsonb_array_elements(v_reembolsos) with ordinality x(e, n) loop
    perform reembolsar_al_cliente(
      v_pedido, v_usuario, v_r.e->>'medio', (v_r.e->>'importe')::numeric, (v_r.e->>'ubicacion_id')::uuid, v_r.e->>'referencia',
      p_clave_idempotencia || '|reembolso|' || v_r.n, v_huella);
  end loop;

  return resumen_de_pedido(p_pedido) || jsonb_build_object('repetido', false);
end $$;

revoke execute on function public.cancelar_pedido(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.cancelar_pedido(uuid, text, jsonb, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────
-- RECIBIR Y REEMBOLSAR DESPUÉS
-- ─────────────────────────────────────────────────────────
-- Productos que el cliente devuelve después de cancelar.
create or replace function public.registrar_recepcion_de_pedido(
  p_pedido             uuid,
  p_ubicacion          uuid,
  p_productos          jsonb,
  p_nota               text default '',
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid := empresa_del_usuario();
  v_pedido  pedidos_ubicacion;
  v_huella  text;
  v_previa  recepciones_de_pedido;
  v_id      uuid;
begin
  perform exigir_clave(p_clave_idempotencia);

  if v_empresa is null then
    raise exception 'Inicia sesión con un usuario activo para recibir productos' using errcode = '42501';
  end if;

  v_pedido := tomar_pedido(v_empresa, p_pedido);
  v_huella := concat_ws('|', 'recibir', p_pedido::text, coalesce(p_ubicacion::text, '-'), coalesce(p_productos::text, '-'), btrim(coalesce(p_nota, '')));

  select r.* into v_previa from recepciones_de_pedido r where r.empresa_id = v_empresa and r.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_previa.huella <> v_huella then
      raise exception 'La clave % ya se usó para otra operación', p_clave_idempotencia using errcode = 'PI011';
    end if;

    return jsonb_build_object('recepcion_id', v_previa.id, 'repetido', true);
  end if;

  if v_pedido.estado <> 'cancelado' then
    raise exception 'Solo se reciben productos de un pedido cancelado' using errcode = 'PI012';
  end if;

  v_id := recibir_productos_del_pedido(v_pedido, quien_cancela(p_pedido), p_ubicacion, p_productos, p_nota, p_clave_idempotencia, v_huella);

  return jsonb_build_object('recepcion_id', v_id, 'repetido', false);
end $$;

-- Una entrega de dinero al cliente después de cancelar.
create or replace function public.registrar_reembolso_de_pedido(
  p_pedido             uuid,
  p_medio              text,
  p_importe            numeric,
  p_ubicacion          uuid default null,
  p_referencia         text default '',
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid := empresa_del_usuario();
  v_pedido  pedidos_ubicacion;
  v_huella  text;
  v_previa  reembolsos_de_pedido;
  v_id      uuid;
begin
  perform exigir_clave(p_clave_idempotencia);

  if v_empresa is null then
    raise exception 'Inicia sesión con un usuario activo para registrar reembolsos' using errcode = '42501';
  end if;

  v_pedido := tomar_pedido(v_empresa, p_pedido);
  v_huella := concat_ws('|', 'reembolsar', p_pedido::text, coalesce(p_medio, '-'), coalesce(p_importe::text, '-'),
                        coalesce(p_ubicacion::text, '-'), btrim(coalesce(p_referencia, '')));

  select r.* into v_previa from reembolsos_de_pedido r where r.empresa_id = v_empresa and r.clave_idempotencia = p_clave_idempotencia;

  if found then
    if v_previa.huella <> v_huella then
      raise exception 'La clave % ya se usó para otra operación', p_clave_idempotencia using errcode = 'PI011';
    end if;

    return jsonb_build_object('reembolso_id', v_previa.id, 'repetido', true);
  end if;

  if v_pedido.estado <> 'cancelado' then
    raise exception 'Solo se reembolsa el dinero de un pedido cancelado' using errcode = 'PI012';
  end if;

  v_id := reembolsar_al_cliente(v_pedido, quien_cancela(p_pedido), p_medio, p_importe, p_ubicacion, p_referencia, p_clave_idempotencia, v_huella);

  return jsonb_build_object('reembolso_id', v_id, 'repetido', false);
end $$;

revoke execute on function
  public.registrar_recepcion_de_pedido(uuid, uuid, jsonb, text, text),
  public.registrar_reembolso_de_pedido(uuid, text, numeric, uuid, text, text)
from public, anon;

grant execute on function
  public.registrar_recepcion_de_pedido(uuid, uuid, jsonb, text, text),
  public.registrar_reembolso_de_pedido(uuid, text, numeric, uuid, text, text)
to authenticated;

-- ─────────────────────────────────────────────────────────
-- LO QUE VE LA PANTALLA
-- ─────────────────────────────────────────────────────────
/*
  La cancelación de un pedido: si quien mira puede cancelarlo (o por qué no),
  la cancelación hecha, los productos por recibir, el dinero por devolver por
  medio, las recepciones y reembolsos registrados, y desde dónde puede recibir
  o reembolsar quien mira.
*/
create or replace function public.cancelacion_de_pedido(p_pedido uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos_ubicacion;
  v_admin  boolean := coalesce(public.usuario_es_admin(), false);
  v_aqui   uuid := public.ubicacion_del_usuario();
  v_opera  boolean;
begin
  select p.* into v_pedido from public.pedidos_ubicacion p where p.id = p_pedido;

  if v_pedido.id is null or not public.pedido_visible(v_pedido.empresa_id, v_pedido.origen_id, v_pedido.destino_id) then
    raise exception 'El pedido no existe o no es de tus ubicaciones' using errcode = 'PI008';
  end if;

  v_opera := coalesce(public.usuario_puede_autorizar_cancelacion(v_pedido.id), false);

  return jsonb_build_object(
    'puede_cancelar', v_opera and v_pedido.estado in ('pendiente', 'por_resolver'),
    'bloqueo_por_liquidacion', case
      when v_pedido.estado in ('pendiente', 'por_resolver') then public.liquidaciones_del_pedido(v_pedido.id)
    end,
    'puede_registrar', v_opera and v_pedido.estado = 'cancelado',
    'es_admin', v_admin,
    'cancelacion', (
      select jsonb_build_object('motivo', c.motivo, 'usuario', c.usuario_nombre, 'fecha', c.cancelado_en,
                                'estado_anterior', c.estado_anterior, 'principal', c.principal_recibido, 'cargo', c.cargo_recibido)
        from public.cancelaciones_de_pedido c where c.pedido_id = v_pedido.id
    ),
    'productos', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.nombre, x.producto_id) from public.productos_por_recibir(v_pedido.id) x
    ), '[]'::jsonb),
    'dinero', coalesce((
      select jsonb_agg(to_jsonb(x) order by array_position(array['efectivo', 'transferencia', 'tarjeta', 'enlace'], x.medio))
        from public.dinero_a_devolver(v_pedido.id) x
    ), '[]'::jsonb),
    'recepciones', coalesce((
      select jsonb_agg(
               jsonb_build_object('ubicacion', u.nombre, 'en_otra_ubicacion', r.en_otra_ubicacion, 'nota', r.nota,
                                  'usuario', r.usuario_nombre, 'fecha', r.recibido_en,
                                  'productos', (select jsonb_agg(jsonb_build_object('producto_id', d.producto_id, 'nombre', pd.nombre,
                                                                                    'cantidad', d.cantidad, 'condicion', d.condicion)
                                                                 order by pd.nombre, d.condicion)
                                                  from public.recepcion_detalle d
                                                  join public.pedido_detalle pd on pd.pedido_id = d.pedido_id and pd.producto_id = d.producto_id
                                                 where d.recepcion_id = r.id))
               order by r.recibido_en, r.id)
        from public.recepciones_de_pedido r
        join public.ubicaciones u on u.id = r.ubicacion_id
       where r.pedido_id = v_pedido.id
    ), '[]'::jsonb),
    'reembolsos', coalesce((
      select jsonb_agg(jsonb_build_object('medio', r.medio, 'importe', r.importe, 'ubicacion', u.nombre, 'referencia', r.referencia,
                                          'usuario', r.usuario_nombre, 'fecha', r.reembolsado_en)
                       order by r.reembolsado_en, r.id)
        from public.reembolsos_de_pedido r
        left join public.ubicaciones u on u.id = r.ubicacion_id
       where r.pedido_id = v_pedido.id
    ), '[]'::jsonb),
    -- Dónde puede recibir quien mira: el administrador, cualquier ubicación activa; el empleado, la suya si es del pedido.
    'ubicaciones_para_recibir', case when v_opera then coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre,
                                          'otra', u.id not in (v_pedido.origen_id, v_pedido.destino_id))
                       order by u.id not in (v_pedido.origen_id, v_pedido.destino_id), u.id <> coalesce(v_aqui, v_pedido.origen_id), u.nombre)
        from public.ubicaciones u
       where u.empresa_id = v_pedido.empresa_id
         and u.activa
         and (v_admin or (u.id = v_aqui and u.id in (v_pedido.origen_id, v_pedido.destino_id)))
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- Desde dónde puede devolver efectivo: el origen o el destino (el empleado, solo la suya).
    'ubicaciones_para_reembolsar', case when v_opera then coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre) order by u.id <> coalesce(v_aqui, v_pedido.origen_id), u.nombre)
        from public.ubicaciones u
       where u.id in (v_pedido.origen_id, v_pedido.destino_id)
         and (v_admin or u.id = v_aqui)
    ), '[]'::jsonb) else '[]'::jsonb end,
    'puede_reembolsar_electronico', v_opera and v_admin
  );
end $$;

revoke execute on function public.cancelacion_de_pedido(uuid) from public, anon;
grant execute on function public.cancelacion_de_pedido(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────
-- LIQUIDACIONES
-- ─────────────────────────────────────────────────────────
/*
  La de la 0048 más los pedidos cancelados. Un pedido cancelado ya no se le
  debe al destino: lo cobrado es del cliente hasta que se le devuelva. Lo único
  que queda entre ubicaciones es el efectivo que el destino devolvió al cliente
  por cuenta del origen, que el origen le debe. Lo pendiente de devolver y lo
  que devolvió el propio origen no son deudas entre ubicaciones. Los pedidos
  activos quedan exactamente igual.
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
  select s.pedido_id, s.numero, s.estado, s.origen_id, s.destino_id, s.cliente, s.forma_pago, s.entregado_en, s.venta_id,
         case when s.estado = 'cancelado' then r.por_el_destino else s.efectivo end,
         case when s.estado = 'cancelado' then 0 else s.electronico end,
         case when s.estado = 'cancelado' then 0 else s.cargo end,
         s.por_confirmar,
         s.liquidado,
         case when s.estado = 'cancelado' then r.por_el_destino - s.por_confirmar - s.liquidado else s.pendiente end
    from public.saldos_de_pedidos_base(p_empresa) s
    cross join lateral (
      select coalesce(sum(x.importe), 0)::numeric as por_el_destino
        from public.reembolsos_de_pedido x
       where x.pedido_id = s.pedido_id
         and x.medio = 'efectivo'
         and x.ubicacion_id = s.destino_id
    ) r
   where s.origen_id <> s.destino_id
     and s.estado <> 'por_resolver'
$$;

revoke execute on function public.saldos_de_pedidos(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- LOS REPORTES DE CAJA
-- ─────────────────────────────────────────────────────────
/*
  Los de la 0048 pasan a llamarse <nombre>_sin_reembolsos sin cambiar su código;
  los de siempre los llaman y, solo si hay reembolsos de pedidos ese día o
  reembolsos pendientes, agregan:
  - lo devuelto al cliente ese día, por medio y por la ubicación que pagó (el
    efectivo baja la caja de esa ubicación; lo electrónico, la cuenta de la
    empresa);
  - el neto: lo cobrado menos lo devuelto;
  - lo pendiente de devolver, que no baja ninguna caja.
  Sin cancelaciones, las cifras son exactamente las de antes.
*/
do $$
declare
  v_firma text;
begin
  foreach v_firma in array array['reporte_diario_de_caja(date, uuid)', 'reporte_medios_de_caja(date, uuid)']
  loop
    if to_regprocedure('public.' || replace(v_firma, '(', '_sin_reembolsos(')) is null then
      execute format('alter function public.%s rename to %I', v_firma, split_part(v_firma, '(', 1) || '_sin_reembolsos');
    end if;
  end loop;
end $$;

-- Los reembolsos de pedidos de un día (y una ubicación, o todas). Solo administradores.
create or replace function public.reembolsos_de_pedidos_del_dia(p_dia date, p_ubicacion uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('id', r.id, 'fecha', r.reembolsado_en, 'pedido_id', p.id, 'pedido', p.numero, 'cliente', p.nombre_cliente,
                              'medio', r.medio, 'importe', r.importe, 'ubicacion_id', r.ubicacion_id, 'ubicacion', u.nombre,
                              'referencia', r.referencia, 'usuario', r.usuario_nombre)
           order by r.reembolsado_en, r.id), '[]'::jsonb)
    from public.reembolsos_de_pedido r
    join public.pedidos_ubicacion p on p.id = r.pedido_id
    left join public.ubicaciones u on u.id = r.ubicacion_id
   where coalesce(public.usuario_es_admin(), false)
     and r.empresa_id = public.empresa_del_usuario()
     and r.reembolsado_en >= p_dia::timestamp at time zone 'America/Tegucigalpa'
     and r.reembolsado_en < (p_dia + 1)::timestamp at time zone 'America/Tegucigalpa'
     and (p_ubicacion is null or r.ubicacion_id = p_ubicacion)
$$;

-- Lo que falta devolver de los pedidos cancelados, al consultar. Es de la ubicación que cobró.
create or replace function public.reembolsos_de_pedidos_pendientes(p_ubicacion uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(d.pendiente), 0)
    from public.cancelaciones_de_pedido c
    join public.pedidos_ubicacion p on p.id = c.pedido_id
    cross join lateral public.dinero_a_devolver(c.pedido_id) d
   where coalesce(public.usuario_es_admin(), false)
     and c.empresa_id = public.empresa_del_usuario()
     and (p_ubicacion is null or p.origen_id = p_ubicacion)
$$;

-- A cada fila de ubicación, lo que esa ubicación devolvió en efectivo y el neto de `p_campo`.
create or replace function public.filas_con_reembolsos(p_filas jsonb, p_campo text, p_neto text, p_reembolsos jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           u.fila || jsonb_build_object(
             'reembolsos_pagados', public.sumar_de(p_reembolsos, 'importe', u.fila->>'ubicacion_id'),
             p_neto, (u.fila->>p_campo)::numeric - public.sumar_de(p_reembolsos, 'importe', u.fila->>'ubicacion_id'))
           order by u.n), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) with ordinality u(fila, n)
$$;

revoke execute on function
  public.reembolsos_de_pedidos_del_dia(date, uuid),
  public.reembolsos_de_pedidos_pendientes(uuid),
  public.filas_con_reembolsos(jsonb, text, text, jsonb)
from public, anon;

grant execute on function
  public.reembolsos_de_pedidos_del_dia(date, uuid),
  public.reembolsos_de_pedidos_pendientes(uuid),
  public.filas_con_reembolsos(jsonb, text, text, jsonb)
to authenticated;

create or replace function public.reporte_diario_de_caja(p_dia date default null, p_ubicacion uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base      jsonb := public.reporte_diario_de_caja_sin_reembolsos(p_dia, p_ubicacion);
  v_lista     jsonb := public.reembolsos_de_pedidos_del_dia((v_base->>'dia')::date, p_ubicacion);
  v_pendiente numeric := public.reembolsos_de_pedidos_pendientes(p_ubicacion);
  v_efectivo  jsonb;
  v_i         jsonb := v_base->'indicadores';
  v_devuelto  numeric;
begin
  if jsonb_array_length(v_lista) = 0 and v_pendiente = 0 then
    return v_base;
  end if;

  v_efectivo := jsonb_path_query_array(v_lista, '$[*] ? (@.medio == "efectivo")');
  v_devuelto := public.sumar_de(v_lista, 'importe');

  return v_base || jsonb_build_object(
    'indicadores', v_i || jsonb_build_object(
      'reembolsos_pagados', v_devuelto,
      'reembolsos_pagados_cantidad', jsonb_array_length(v_lista),
      'reembolsos_pagados_efectivo', public.sumar_de(v_efectivo, 'importe'),
      'total_cobrado_neto', (v_i->>'total_cobrado')::numeric - v_devuelto,
      'reembolsos_de_pedidos_pendientes', v_pendiente
    ),
    'por_ubicacion', public.filas_con_reembolsos(v_base->'por_ubicacion', 'cobros_total', 'cobros_netos', v_efectivo),
    'reembolsos_de_pedidos', v_lista
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
  v_base      jsonb := public.reporte_medios_de_caja_sin_reembolsos(p_dia, p_ubicacion);
  v_lista     jsonb := public.reembolsos_de_pedidos_del_dia(coalesce(p_dia, (now() at time zone 'America/Tegucigalpa')::date), p_ubicacion);
  v_pendiente numeric := public.reembolsos_de_pedidos_pendientes(p_ubicacion);
  v_efectivo  jsonb;
  v_t         jsonb := v_base->'totales';
begin
  if jsonb_array_length(v_lista) = 0 and v_pendiente = 0 then
    return v_base;
  end if;

  v_efectivo := jsonb_path_query_array(v_lista, '$[*] ? (@.medio == "efectivo")');

  return v_base || jsonb_build_object(
    'totales', v_t || jsonb_build_object(
      'reembolsos_efectivo', public.sumar_de(v_efectivo, 'importe'),
      'reembolsos_electronicos', public.sumar_de(v_lista, 'importe') - public.sumar_de(v_efectivo, 'importe'),
      'total_neto', (v_t->>'total_cobrado')::numeric - public.sumar_de(v_lista, 'importe'),
      'reembolsos_pendientes', v_pendiente
    ),
    'por_ubicacion', public.filas_con_reembolsos(v_base->'por_ubicacion', 'efectivo', 'efectivo_neto', v_efectivo),
    'reembolsos_de_pedidos', v_lista
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
