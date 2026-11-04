-- Medios de pago: con qué se cobró cada venta de contado y cada abono.
--
-- `ventas.forma_pago` sigue diciendo si la venta es al contado o a crédito.
-- El medio es otro dato: efectivo, transferencia, tarjeta o enlace de pago,
-- o varios de ellos con su importe (pago mixto).
--
-- Las funciones de venta, cobro, sincronización y rescate NO cambian. Las
-- nuevas las llaman y, en la misma transacción, guardan los medios. Por eso:
-- - una pestaña con la versión anterior y un teléfono con ventas pendientes
--   siguen funcionando igual, y esas ventas quedan «Sin registrar»;
-- - si los medios no cuadran con lo que calculó el servidor, se deshace todo:
--   la venta, la existencia, el movimiento y el correlativo;
-- - la huella de una venta sin conexión no cambia, así que un reintento se
--   reconoce como siempre.
--
-- La comisión del proveedor de pagos es un dato interno del negocio. Va en
-- su propia tabla, que solo lee el administrador, y no toca ni el total de la
-- venta ni lo que se cobra al comprador.
--
-- Lo que NO hace: no toca ninguna venta, abono ni pago existente, y no les
-- inventa un medio; no cambia ISV, precios, clientes ni permisos. Lo único que
-- agrega como dato son las tasas iniciales de comisión. Idempotente.

-- ─────────────────────────────────────────────────────────
-- LAS TABLAS
-- ─────────────────────────────────────────────────────────
/*
  Una fila por medio. Pertenece a una venta o a un pago, nunca a los dos. Un
  pago repartido entre ubicaciones (lo cobra un administrador) lleva una fila
  por medio y ubicación.
*/
create table if not exists public.cobros_por_medio (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id),
  venta_id      uuid references public.ventas (id),
  pago_id       uuid references public.pagos (id),
  medio         text not null check (medio in ('efectivo', 'transferencia', 'tarjeta', 'enlace')),
  monto         numeric(12,2) not null check (monto > 0),
  referencia    text not null default '',
  ubicacion_id  uuid references public.ubicaciones (id),
  usuario_id    uuid references public.usuarios (id),
  fecha         timestamptz not null,
  creado_en     timestamptz not null default now(),

  constraint cobros_por_medio_de_venta_o_de_pago check ((venta_id is null) <> (pago_id is null)),
  constraint cobros_por_medio_referencia check (
    (medio = 'efectivo' and referencia = '')
    or (medio <> 'efectivo' and btrim(referencia) <> '' and char_length(referencia) <= 120)
  )
);

create unique index if not exists cobros_por_medio_venta
  on public.cobros_por_medio (venta_id, medio)
  where venta_id is not null;

create unique index if not exists cobros_por_medio_pago
  on public.cobros_por_medio (pago_id, medio, ubicacion_id) nulls not distinct
  where pago_id is not null;

/*
  Qué tasa vale desde cuándo. Una tasa nueva no se aplica hacia atrás: cada
  cobro se queda con la que estaba vigente en su fecha, y cambiarla agrega una
  fila.
*/
create table if not exists public.tasas_de_comision (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas (id),
  medio          text not null check (medio in ('tarjeta', 'enlace')),
  tasa           numeric(5,2) not null check (tasa between 0 and 100),
  vigente_desde  timestamptz not null,
  creado_por     uuid references public.usuarios (id),
  creado_en      timestamptz not null default now(),

  constraint tasas_de_comision_una_por_momento unique (empresa_id, medio, vigente_desde)
);

/*
  La comisión estimada de un cobro. Es un dato para conciliar con el
  proveedor: una venta anulada conserva la suya, porque el proveedor puede no
  devolverla.
*/
create table if not exists public.comisiones_de_cobro (
  cobro_id    uuid primary key references public.cobros_por_medio (id),
  empresa_id  uuid not null references public.empresas (id),
  medio       text not null,
  base        numeric(12,2) not null,
  tasa        numeric(5,2) not null,
  monto       numeric(12,2) not null,
  fecha       timestamptz not null
);

/*
  Lo que declaró el teléfono de una venta que quedó en conciliación. Espera
  aquí, sin contar en ningún reporte, hasta que la venta se aplique.
*/
create table if not exists public.cobros_por_conciliar (
  conciliacion_id  uuid primary key references public.ventas_por_conciliar (id),
  empresa_id       uuid not null references public.empresas (id),
  cobros           jsonb not null,
  creado_en        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- SOLO SE AGREGA
-- ─────────────────────────────────────────────────────────
create or replace function public.registro_de_cobro_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Un registro de cobro no se modifica ni se borra'
    using errcode = '42501';
end $$;

revoke execute on function public.registro_de_cobro_inmutable() from public, anon, authenticated;

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['cobros_por_medio', 'tasas_de_comision', 'comisiones_de_cobro', 'cobros_por_conciliar']
  loop
    execute format('drop trigger if exists %1$s_inmutable on public.%1$I', v_tabla);
    execute format(
      'create trigger %1$s_inmutable before update or delete on public.%1$I
         for each row execute function public.registro_de_cobro_inmutable()',
      v_tabla
    );

    execute format('drop trigger if exists %1$s_sin_vaciar on public.%1$I', v_tabla);
    execute format(
      'create trigger %1$s_sin_vaciar before truncate on public.%1$I
         for each statement execute function public.registro_de_cobro_inmutable()',
      v_tabla
    );

    -- El contador no escribe en ninguna tabla (0036).
    execute format('drop trigger if exists impedir_escritura_del_contador on public.%I', v_tabla);
    execute format(
      'create trigger impedir_escritura_del_contador
         before insert or update or delete or truncate on public.%I
         for each statement execute function public.impedir_escritura_del_contador()',
      v_tabla
    );

    /*
      Solo las funciones escriben. El administrador lee las de su empresa y
      nadie más: las comisiones y lo que un vendedor no necesita para vender
      se quedan fuera de su alcance. A service_role se le deja solo leer,
      como en la 0033.
    */
    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_tabla);
    execute format('grant select on public.%I to authenticated, service_role', v_tabla);

    execute format('drop policy if exists %1$s_lectura_admin on public.%1$I', v_tabla);
    execute format(
      'create policy %1$s_lectura_admin on public.%1$I
         for select to authenticated
         using (empresa_id = (select public.empresa_del_usuario()) and (select public.usuario_es_admin()))',
      v_tabla
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────
-- LA COMISIÓN
-- ─────────────────────────────────────────────────────────
/*
  Se calcula aquí, nunca en el teléfono ni en el navegador, con la tasa que
  estaba vigente en la fecha del cobro. Un cobro sin tasa, o con tasa cero, no
  lleva comisión.
*/
create or replace function public.anotar_comision_de_cobro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tasa numeric(5,2);
begin
  select t.tasa into v_tasa
    from public.tasas_de_comision t
   where t.empresa_id = new.empresa_id
     and t.medio = new.medio
     and t.vigente_desde <= new.fecha
   order by t.vigente_desde desc
   limit 1;

  if coalesce(v_tasa, 0) > 0 then
    insert into public.comisiones_de_cobro (cobro_id, empresa_id, medio, base, tasa, monto, fecha)
    values (new.id, new.empresa_id, new.medio, new.monto, v_tasa, round(new.monto * v_tasa / 100, 2), new.fecha);
  end if;

  return null;
end $$;

revoke execute on function public.anotar_comision_de_cobro() from public, anon, authenticated;

drop trigger if exists anotar_comision_de_cobro on public.cobros_por_medio;
create trigger anotar_comision_de_cobro
  after insert on public.cobros_por_medio
  for each row execute function public.anotar_comision_de_cobro();

/*
  El 7 % con el que empieza cada empresa, en tarjeta y enlace de pago. La fecha
  es anterior a cualquier venta para que también lo tome una venta sin conexión
  hecha antes de aplicar esta migración.
*/
create or replace function public.sembrar_tasas_de_comision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tasas_de_comision (empresa_id, medio, tasa, vigente_desde)
  values (new.id, 'tarjeta', 7, '2000-01-01T00:00:00Z'),
         (new.id, 'enlace', 7, '2000-01-01T00:00:00Z')
  on conflict do nothing;

  return null;
end $$;

revoke execute on function public.sembrar_tasas_de_comision() from public, anon, authenticated;

drop trigger if exists sembrar_tasas_de_comision on public.empresas;
create trigger sembrar_tasas_de_comision
  after insert on public.empresas
  for each row execute function public.sembrar_tasas_de_comision();

insert into public.tasas_de_comision (empresa_id, medio, tasa, vigente_desde)
select e.id, m.medio, 7, '2000-01-01T00:00:00Z'
  from public.empresas e
 cross join (values ('tarjeta'), ('enlace')) as m (medio)
on conflict do nothing;

/*
  Cambiar una tasa: solo el administrador, y vale de ahora en adelante. Los
  cobros que ya tienen comisión la conservan.
*/
create or replace function public.configurar_tasa_de_comision(p_medio text, p_tasa numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila tasas_de_comision;
begin
  if not coalesce(usuario_es_admin(), false) then
    raise exception 'Solo un administrador puede cambiar la tasa de comisión'
      using errcode = '42501';
  end if;

  if p_medio is null or p_medio not in ('tarjeta', 'enlace') then
    raise exception 'La comisión solo se configura para tarjeta y enlace de pago'
      using errcode = 'LM006';
  end if;

  if p_tasa is null or p_tasa < 0 or p_tasa > 100 or p_tasa <> round(p_tasa, 2) then
    raise exception 'La tasa debe estar entre 0 y 100, con dos decimales como máximo'
      using errcode = 'LM006';
  end if;

  insert into tasas_de_comision (empresa_id, medio, tasa, vigente_desde, creado_por)
  values (empresa_del_usuario(), p_medio, p_tasa, clock_timestamp(), usuario_actual())
  returning * into v_fila;

  return jsonb_build_object('medio', v_fila.medio, 'tasa', v_fila.tasa, 'vigente_desde', v_fila.vigente_desde);
end $$;

revoke execute on function public.configurar_tasa_de_comision(text, numeric) from public, anon;
grant execute on function public.configurar_tasa_de_comision(text, numeric) to authenticated;

-- ─────────────────────────────────────────────────────────
-- PIEZAS INTERNAS
-- ─────────────────────────────────────────────────────────

-- Qué tienen de mal formado los medios; null si nada. Nunca lanza.
create or replace function public.medios_de_cobro_invalidos(p_cobros jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cobro      jsonb;
  v_medio      text;
  v_monto      numeric;
  v_referencia text;
  v_vistos     text[] := '{}';
begin
  if jsonb_typeof(p_cobros) is distinct from 'array'
     or jsonb_array_length(p_cobros) not between 1 and 4 then
    return 'Indica entre uno y cuatro medios de pago';
  end if;

  for v_cobro in select * from jsonb_array_elements(p_cobros) loop
    if jsonb_typeof(v_cobro) <> 'object' then
      return 'Un medio de pago no es válido';
    end if;

    v_medio := v_cobro->>'medio';

    if v_medio is null or v_medio not in ('efectivo', 'transferencia', 'tarjeta', 'enlace') then
      return 'Un medio de pago no es válido';
    end if;

    if v_medio = any (v_vistos) then
      return 'Cada medio de pago se indica una sola vez';
    end if;

    v_vistos := v_vistos || v_medio;

    begin
      v_monto := (v_cobro->>'monto')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        return 'El importe de un medio de pago no es válido';
    end;

    if v_monto is null or v_monto <= 0 or v_monto <> round(v_monto, 2) or v_monto >= 10000000000 then
      return 'El importe de un medio de pago no es válido';
    end if;

    if jsonb_typeof(coalesce(v_cobro->'referencia', 'null'::jsonb)) not in ('string', 'null') then
      return 'La referencia de un medio de pago no es válida';
    end if;

    v_referencia := btrim(coalesce(v_cobro->>'referencia', ''));

    if v_medio = 'efectivo' and v_referencia <> '' then
      return 'El efectivo no lleva referencia';
    end if;

    if v_medio <> 'efectivo' and v_referencia = '' then
      return 'Escribe la referencia de la transferencia, la tarjeta o el enlace';
    end if;

    if char_length(v_referencia) > 120 then
      return 'La referencia es demasiado larga';
    end if;
  end loop;

  return null;
end $$;

create or replace function public.suma_de_cobros(p_cobros jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((c->>'monto')::numeric), 0) from jsonb_array_elements(p_cobros) c
$$;

-- Los medios en una forma comparable: mismo orden, misma escritura.
create or replace function public.cobros_normalizados(p_cobros jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'medio', c->>'medio',
        'monto', round((c->>'monto')::numeric, 2),
        'referencia', btrim(coalesce(c->>'referencia', ''))
      )
      order by c->>'medio'
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_cobros) c
$$;

-- Lo guardado de una venta o de un pago, en esa misma forma. [] si nada.
create or replace function public.cobros_guardados(p_venta uuid, p_pago uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('medio', x.medio, 'monto', x.monto, 'referencia', x.referencia)
      order by x.medio
    ),
    '[]'::jsonb
  )
  from (
    select c.medio, c.referencia, sum(c.monto) as monto
      from public.cobros_por_medio c
     where c.venta_id = p_venta or c.pago_id = p_pago
     group by c.medio, c.referencia
  ) x
$$;

create or replace function public.guardar_cobros_de_venta(p_venta uuid, p_cobros jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.cobros_por_medio (empresa_id, venta_id, medio, monto, referencia, ubicacion_id, usuario_id, fecha)
  select v.empresa_id, v.id, c->>'medio', (c->>'monto')::numeric, c->>'referencia', v.ubicacion_id, v.usuario_id, v.fecha
    from public.ventas v
   cross join jsonb_array_elements(public.cobros_normalizados(p_cobros)) c
   where v.id = p_venta
$$;

/*
  Los medios de un pago, por ubicación. Un vendedor cobra en su ubicación, así
  que hay un solo tramo. Un administrador puede cobrar facturas de varias: cada
  medio se asigna en orden a los tramos, de la factura más vieja a la más
  reciente, igual que el pago se reparte entre las facturas. El importe de cada
  medio y el de cada ubicación quedan exactos.
*/
create or replace function public.guardar_cobros_de_pago(p_pago uuid, p_cobros jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pago       public.pagos;
  v_ubicacion  uuid[];
  v_disponible numeric[];
  v_cobro      jsonb;
  v_resto      numeric;
  v_toma       numeric;
  v_i          integer := 1;
begin
  select p.* into v_pago from public.pagos p where p.id = p_pago;

  select array_agg(t.ubicacion order by t.primera, t.ubicacion), array_agg(t.monto order by t.primera, t.ubicacion)
    into v_ubicacion, v_disponible
    from (
      select coalesce(v_pago.ubicacion_id, v.ubicacion_id) as ubicacion, sum(a.monto) as monto, min(v.fecha) as primera
        from public.abonos a
        join public.ventas v on v.id = a.venta_id
       where a.pago_id = p_pago
       group by 1
    ) t;

  for v_cobro in select * from jsonb_array_elements(public.cobros_normalizados(p_cobros)) loop
    v_resto := (v_cobro->>'monto')::numeric;

    while v_resto > 0 loop
      v_toma := least(v_resto, v_disponible[v_i]);

      if v_toma > 0 then
        insert into public.cobros_por_medio (empresa_id, pago_id, medio, monto, referencia, ubicacion_id, usuario_id, fecha)
        values (v_pago.empresa_id, v_pago.id, v_cobro->>'medio', v_toma, v_cobro->>'referencia',
                v_ubicacion[v_i], v_pago.usuario_id, v_pago.fecha);
      end if;

      v_disponible[v_i] := v_disponible[v_i] - v_toma;
      v_resto := v_resto - v_toma;

      if v_disponible[v_i] = 0 then
        v_i := v_i + 1;
      end if;
    end loop;
  end loop;
end $$;

revoke execute on function
  public.medios_de_cobro_invalidos(jsonb),
  public.suma_de_cobros(jsonb),
  public.cobros_normalizados(jsonb),
  public.cobros_guardados(uuid, uuid),
  public.guardar_cobros_de_venta(uuid, jsonb),
  public.guardar_cobros_de_pago(uuid, jsonb)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- VENDER
-- ─────────────────────────────────────────────────────────
/*
  registrar_venta_ubicacion() con los medios, en una transacción.

  Errores propios, además de los de la venta:
  - LM001: los medios están mal formados;
  - LM002: no suman el total que calculó el servidor;
  - LM003: una venta a crédito no se cobra al venderla;
  - LM005: la clave ya se usó con otros medios.
*/
create or replace function public.registrar_venta_con_medios(
  p_items              jsonb,
  p_forma_pago         text,
  p_cobros             jsonb,
  p_cliente_id         uuid default null,
  p_nombre_cliente     text default null,
  p_rtn_comprador      text default '',
  p_fecha_vencimiento  date default null,
  p_nota               text default '',
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invalidos text;
  v_venta     jsonb;
  v_guardados jsonb;
begin
  if p_forma_pago = 'credito' then
    if coalesce(jsonb_array_length(p_cobros), 0) > 0 then
      raise exception 'Una venta a crédito no lleva medios de pago: se cobra con sus abonos'
        using errcode = 'LM003';
    end if;

    return registrar_venta_ubicacion(
      p_items, p_forma_pago, p_cliente_id, p_nombre_cliente, p_rtn_comprador,
      p_fecha_vencimiento, p_nota, p_clave_idempotencia);
  end if;

  v_invalidos := medios_de_cobro_invalidos(p_cobros);

  if v_invalidos is not null then
    raise exception '%', v_invalidos using errcode = 'LM001';
  end if;

  v_venta := registrar_venta_ubicacion(
    p_items, p_forma_pago, p_cliente_id, p_nombre_cliente, p_rtn_comprador,
    p_fecha_vencimiento, p_nota, p_clave_idempotencia);

  if suma_de_cobros(p_cobros) is distinct from (v_venta->>'total')::numeric then
    raise exception 'Los medios de pago suman %, y el total de la venta es %',
      to_char(suma_de_cobros(p_cobros), 'FM999999990.00'), to_char((v_venta->>'total')::numeric, 'FM999999990.00')
      using errcode = 'LM002';
  end if;

  if (v_venta->>'repetida')::boolean then
    v_guardados := cobros_guardados((v_venta->>'venta_id')::uuid, null);

    if v_guardados <> '[]'::jsonb and v_guardados <> cobros_normalizados(p_cobros) then
      raise exception 'La clave % ya se usó con otros medios de pago', p_clave_idempotencia
        using errcode = 'LM005';
    end if;

    return v_venta;
  end if;

  perform guardar_cobros_de_venta((v_venta->>'venta_id')::uuid, p_cobros);

  return v_venta;
end $$;

revoke execute on function public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text) from public, anon;
grant execute on function public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────
-- COBRAR
-- ─────────────────────────────────────────────────────────
-- registrar_pago_cliente() con los medios. Los mismos errores LM.
create or replace function public.registrar_pago_con_medios(
  p_cliente_id         uuid,
  p_monto              numeric,
  p_cobros             jsonb,
  p_clave_idempotencia text default null,
  p_nota               text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invalidos text;
  v_pago      jsonb;
  v_guardados jsonb;
begin
  v_invalidos := medios_de_cobro_invalidos(p_cobros);

  if v_invalidos is not null then
    raise exception '%', v_invalidos using errcode = 'LM001';
  end if;

  if p_monto is null or suma_de_cobros(p_cobros) <> round(p_monto, 2) then
    raise exception 'Los medios de pago no suman el monto del abono'
      using errcode = 'LM002';
  end if;

  v_pago := registrar_pago_cliente(p_cliente_id, p_monto, p_clave_idempotencia, p_nota);

  if (v_pago->>'repetido')::boolean then
    v_guardados := cobros_guardados(null, (v_pago->>'pago_id')::uuid);

    if v_guardados <> '[]'::jsonb and v_guardados <> cobros_normalizados(p_cobros) then
      raise exception 'La clave % ya se usó con otros medios de pago', p_clave_idempotencia
        using errcode = 'LM005';
    end if;

    return v_pago;
  end if;

  perform guardar_cobros_de_pago((v_pago->>'pago_id')::uuid, p_cobros);

  return v_pago;
end $$;

revoke execute on function public.registrar_pago_con_medios(uuid, numeric, jsonb, text, text) from public, anon;
grant execute on function public.registrar_pago_con_medios(uuid, numeric, jsonb, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────
-- VENTAS SIN CONEXIÓN
-- ─────────────────────────────────────────────────────────
/*
  ¿Están bien los medios de una venta del teléfono? Null si sí. Una a crédito
  no lleva, y las de contado deben sumar lo que se cobró.
*/
create or replace function public.medios_sin_conexion_invalidos(p_forma_pago text, p_cobros jsonb, p_total numeric)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_invalidos text;
begin
  if p_forma_pago = 'credito' then
    return case when coalesce(jsonb_array_length(p_cobros), 0) > 0
      then 'Una venta a crédito no lleva medios de pago' end;
  end if;

  v_invalidos := public.medios_de_cobro_invalidos(p_cobros);

  if v_invalidos is not null then
    return v_invalidos;
  end if;

  if public.suma_de_cobros(p_cobros) is distinct from round(p_total, 2) then
    return 'Los medios de pago no suman el total cobrado';
  end if;

  return null;
end $$;

/*
  Guarda los medios según en qué quedó la venta. Un reintento con otros medios
  responde lo que dé la comparación: falso. Si la venta ya estaba y no tiene
  medios es que entró por el camino anterior, y se queda «Sin registrar».
*/
create or replace function public.guardar_cobros_sin_conexion(p_empresa uuid, p_respuesta jsonb, p_cobros jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado    text := p_respuesta->>'estado';
  v_venta     uuid := (p_respuesta->>'venta_id')::uuid;
  v_conc      uuid := (p_respuesta->>'conciliacion_id')::uuid;
  v_guardados jsonb;
begin
  if coalesce(jsonb_array_length(p_cobros), 0) = 0 then
    return true;
  end if;

  if v_estado = 'registrada' then
    perform public.guardar_cobros_de_venta(v_venta, p_cobros);
    return true;
  end if;

  if v_estado = 'en_conciliacion' then
    insert into public.cobros_por_conciliar (conciliacion_id, empresa_id, cobros)
    values (v_conc, p_empresa, public.cobros_normalizados(p_cobros));
    return true;
  end if;

  if v_estado = 'ya_registrada' then
    v_guardados := public.cobros_guardados(v_venta, null);
  elsif v_estado = 'ya_en_conciliacion' then
    select c.cobros into v_guardados from public.cobros_por_conciliar c where c.conciliacion_id = v_conc;
  end if;

  return coalesce(v_guardados, '[]'::jsonb) = '[]'::jsonb
      or v_guardados = public.cobros_normalizados(p_cobros);
end $$;

revoke execute on function
  public.medios_sin_conexion_invalidos(text, jsonb, numeric),
  public.guardar_cobros_sin_conexion(uuid, jsonb, jsonb)
from public, anon, authenticated;

/*
  sincronizar_venta_sin_conexion() con los medios. Con medios mal formados o
  que no suman responde OF001, y con otros medios para la misma clave OF003:
  los mismos errores con los que el teléfono ya sabe conservar la venta.
*/
create or replace function public.sincronizar_venta_con_medios(
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
  p_cobros             jsonb,
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
  v_invalidos text;
  v_respuesta jsonb;
begin
  v_invalidos := medios_sin_conexion_invalidos(p_forma_pago, p_cobros, p_total_cobrado);

  if v_invalidos is not null then
    raise exception '%', v_invalidos using errcode = 'OF001';
  end if;

  v_respuesta := sincronizar_venta_sin_conexion(
    p_clave_idempotencia, p_usuario_auth, p_ubicacion_id, p_dispositivo, p_numero_provisional,
    p_registrada_en, p_reloj_dispositivo, p_tasa_isv, p_renglones, p_total_cobrado, p_forma_pago,
    p_cliente_id, p_nombre_cliente, p_rtn_comprador, p_fecha_vencimiento, p_nota);

  if not guardar_cobros_sin_conexion(
    (select u.empresa_id from usuarios u where u.auth_id = auth.uid() limit 1), v_respuesta, p_cobros
  ) then
    raise exception 'La clave % ya se usó con otros medios de pago', p_clave_idempotencia
      using errcode = 'OF003';
  end if;

  return v_respuesta;
end $$;

/*
  rescatar_venta_sin_conexion() con los medios. Igual que aquella, no lanza
  salvo que quien llama no sea administrador: responde `rechazado`, y el
  rechazo queda en auditoria_rescates.
*/
create or replace function public.rescatar_venta_con_medios(
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
  p_cobros             jsonb,
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
  v_detalle   text;
  v_codigo    text;
  v_respuesta jsonb;
begin
  v_detalle := medios_sin_conexion_invalidos(p_forma_pago, p_cobros, p_total_cobrado);
  v_codigo  := case when v_detalle is not null then 'OF001' end;

  if v_detalle is null then
    v_respuesta := rescatar_venta_sin_conexion(
      p_clave_idempotencia, p_usuario_auth, p_ubicacion_id, p_dispositivo, p_numero_provisional,
      p_registrada_en, p_reloj_dispositivo, p_tasa_isv, p_renglones, p_total_cobrado, p_forma_pago,
      p_cliente_id, p_nombre_cliente, p_rtn_comprador, p_fecha_vencimiento, p_nota, p_lote);

    if v_respuesta->>'estado' = 'rechazado'
       or guardar_cobros_sin_conexion(v_admin.empresa_id, v_respuesta, p_cobros) then
      return v_respuesta;
    end if;

    v_detalle := 'La clave ya se usó con otros medios de pago';
    v_codigo  := 'OF003';
  end if;

  insert into auditoria_rescates (
    empresa_id, administrador_id, lote, clave, usuario_auth, dispositivo, resultado, codigo, detalle
  ) values (
    v_admin.empresa_id, v_admin.id, nullif(btrim(coalesce(p_lote, '')), ''), p_clave_idempotencia,
    p_usuario_auth, p_dispositivo, 'rechazado', v_codigo, v_detalle
  );

  return jsonb_build_object('estado', 'rechazado', 'codigo', v_codigo, 'detalle', v_detalle);
end $$;

revoke execute on function
  public.sincronizar_venta_con_medios(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, jsonb, uuid, text, text, date, text),
  public.rescatar_venta_con_medios(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, jsonb, uuid, text, text, date, text, text)
from public, anon;

grant execute on function
  public.sincronizar_venta_con_medios(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, jsonb, uuid, text, text, date, text),
  public.rescatar_venta_con_medios(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, jsonb, uuid, text, text, date, text, text)
to authenticated;

/*
  Al aplicar una conciliación, lo que declaró el teléfono pasa a la venta, que
  es cuando el cobro empieza a contar. Un disparador y no un cambio en
  conciliar_venta(): esa función no se toca. Si se anula, se queda donde está.
*/
create or replace function public.aplicar_cobros_de_conciliacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cobros jsonb;
begin
  select c.cobros into v_cobros from public.cobros_por_conciliar c where c.conciliacion_id = new.id;

  if v_cobros is not null and new.venta_id is not null then
    perform public.guardar_cobros_de_venta(new.venta_id, v_cobros);
  end if;

  return null;
end $$;

revoke execute on function public.aplicar_cobros_de_conciliacion() from public, anon, authenticated;

drop trigger if exists aplicar_cobros_de_conciliacion on public.ventas_por_conciliar;
create trigger aplicar_cobros_de_conciliacion
  after update of estado on public.ventas_por_conciliar
  for each row
  when (new.estado = 'aplicada' and old.estado = 'pendiente')
  execute function public.aplicar_cobros_de_conciliacion();

-- ─────────────────────────────────────────────────────────
-- EL REPORTE
-- ─────────────────────────────────────────────────────────
/*
  Los cobros de un día de Honduras por medio y por ubicación, con su comisión.
  Solo para administradores, y corre como quien llama, igual que
  reporte_diario() (0038). No lee costos.

  Cuenta el mismo dinero que `cobros_total` de reporte_diario(): contado válido
  del día más abonos del día. Lo que no tiene medio porque se registró antes de
  esta migración, o desde una versión anterior de la aplicación, va como
  `sin_registrar`, nunca como efectivo. Así el total siempre coincide.

  Una venta anulada no cuenta en su día. Su comisión estimada se muestra aparte
  el día de la anulación, porque el proveedor puede no devolverla.
*/
create or replace function public.reporte_medios_de_pago(
  p_dia       date default null,
  p_ubicacion uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_dia     date;
  v_desde   timestamptz;
  v_hasta   timestamptz;
  v_reporte jsonb;
begin
  if not coalesce(public.usuario_es_admin(), false) then
    raise exception 'El reporte de medios de pago es solo para administradores'
      using errcode = '42501';
  end if;

  v_empresa := public.empresa_del_usuario();
  v_dia     := coalesce(p_dia, (now() at time zone 'America/Tegucigalpa')::date);
  v_desde   := v_dia::timestamp at time zone 'America/Tegucigalpa';
  v_hasta   := (v_dia + 1)::timestamp at time zone 'America/Tegucigalpa';

  with
  ventas_dia as (
    select v.id, v.ubicacion_id, v.estado, v.forma_pago, v.total
      from public.ventas v
     where v.empresa_id = v_empresa
       and v.fecha >= v_desde and v.fecha < v_hasta
       and (p_ubicacion is null or v.ubicacion_id = p_ubicacion)
  ),
  abonos_dia as (
    select a.id, a.monto, a.pago_id, coalesce(p.ubicacion_id, v.ubicacion_id) as ubicacion_id
      from public.abonos a
      join public.ventas v on v.id = a.venta_id
      left join public.pagos p on p.id = a.pago_id
     where a.empresa_id = v_empresa
       and a.fecha >= v_desde and a.fecha < v_hasta
       and (p.id is null or p.estado = 'aplicado')
       and (p_ubicacion is null or coalesce(p.ubicacion_id, v.ubicacion_id) = p_ubicacion)
  ),
  anulaciones_dia as (
    select an.id, an.venta_id
      from public.anulaciones_venta an
     where an.empresa_id = v_empresa
       and an.anulada_en >= v_desde and an.anulada_en < v_hasta
       and (p_ubicacion is null or an.ubicacion_venta = p_ubicacion)
  ),
  cobros_dia as (
    select c.id, c.medio, c.monto, v.ubicacion_id
      from public.cobros_por_medio c
      join ventas_dia v on v.id = c.venta_id
     where v.estado <> 'anulada'
    union all
    select c.id, c.medio, c.monto, c.ubicacion_id
      from public.cobros_por_medio c
      join public.pagos p on p.id = c.pago_id
     where c.empresa_id = v_empresa
       and p.estado = 'aplicado'
       and p.fecha >= v_desde and p.fecha < v_hasta
       and (p_ubicacion is null or c.ubicacion_id = p_ubicacion)
  ),
  con_comision as (
    select c.medio, c.monto, c.ubicacion_id, coalesce(k.monto, 0) as comision
      from cobros_dia c
      left join public.comisiones_de_cobro k on k.cobro_id = c.id
  ),
  sin_registrar as (
    select v.ubicacion_id, v.total as monto
      from ventas_dia v
     where v.estado <> 'anulada'
       and v.forma_pago = 'contado'
       and not exists (select 1 from public.cobros_por_medio c where c.venta_id = v.id)
    union all
    select a.ubicacion_id, a.monto
      from abonos_dia a
     where a.pago_id is null
        or not exists (select 1 from public.cobros_por_medio c where c.pago_id = a.pago_id)
  ),
  todo as (
    select medio, monto, ubicacion_id, comision from con_comision
    union all
    select 'sin_registrar', monto, ubicacion_id, 0 from sin_registrar
  ),
  medios_de_venta as (
    select c.venta_id as id,
           jsonb_agg(jsonb_build_object('medio', c.medio, 'monto', c.monto, 'referencia', c.referencia) order by c.medio) as medios
      from public.cobros_por_medio c
     where c.venta_id in (
       select id from ventas_dia union select venta_id from anulaciones_dia
     )
     group by c.venta_id
  ),
  medios_de_pago as (
    select x.pago_id as id,
           jsonb_agg(jsonb_build_object('medio', x.medio, 'monto', x.monto, 'referencia', x.referencia) order by x.medio) as medios
      from (
        select c.pago_id, c.medio, c.referencia, sum(c.monto) as monto
          from public.cobros_por_medio c
         where c.pago_id in (select pago_id from abonos_dia)
         group by c.pago_id, c.medio, c.referencia
      ) x
     group by x.pago_id
  )
  select jsonb_build_object(
    'totales', (
      select jsonb_build_object(
        'total', coalesce(sum(monto), 0),
        'registrado', coalesce(sum(monto) filter (where medio <> 'sin_registrar'), 0),
        'sin_registrar', coalesce(sum(monto) filter (where medio = 'sin_registrar'), 0),
        'comision', coalesce(sum(comision), 0),
        'neto', coalesce(sum(monto), 0) - coalesce(sum(comision), 0),
        'comision_de_anuladas', coalesce((
          select sum(k.monto)
            from anulaciones_dia an
            join public.cobros_por_medio c on c.venta_id = an.venta_id
            join public.comisiones_de_cobro k on k.cobro_id = c.id
        ), 0)
      )
      from todo
    ),

    'por_medio', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.orden)
        from (
          select medio,
                 count(*) as operaciones,
                 sum(monto) as monto,
                 sum(comision) as comision,
                 sum(monto) - sum(comision) as neto,
                 array_position(array['efectivo', 'transferencia', 'tarjeta', 'enlace', 'sin_registrar'], medio) as orden
            from todo
           group by medio
        ) x
    ), '[]'::jsonb),

    'por_ubicacion', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.total desc, x.ubicacion)
        from (
          select t.ubicacion_id,
                 coalesce(u.nombre, 'Sin ubicación') as ubicacion,
                 coalesce(sum(t.monto) filter (where t.medio = 'efectivo'), 0) as efectivo,
                 coalesce(sum(t.monto) filter (where t.medio = 'transferencia'), 0) as transferencia,
                 coalesce(sum(t.monto) filter (where t.medio = 'tarjeta'), 0) as tarjeta,
                 coalesce(sum(t.monto) filter (where t.medio = 'enlace'), 0) as enlace,
                 coalesce(sum(t.monto) filter (where t.medio = 'sin_registrar'), 0) as sin_registrar,
                 sum(t.monto) as total,
                 sum(t.comision) as comision
            from todo t
            left join public.ubicaciones u on u.id = t.ubicacion_id
           group by t.ubicacion_id, u.nombre
        ) x
    ), '[]'::jsonb),

    'por_venta', coalesce((select jsonb_object_agg(m.id, m.medios) from medios_de_venta m), '{}'::jsonb),

    'por_abono', coalesce((
      select jsonb_object_agg(a.id, m.medios)
        from abonos_dia a
        join medios_de_pago m on m.id = a.pago_id
    ), '{}'::jsonb),

    'por_anulacion', coalesce((
      select jsonb_object_agg(an.id, m.medios)
        from anulaciones_dia an
        join medios_de_venta m on m.id = an.venta_id
    ), '{}'::jsonb)
  )
  into v_reporte;

  return v_reporte;
end $$;

revoke execute on function public.reporte_medios_de_pago(date, uuid) from public, anon;
grant execute on function public.reporte_medios_de_pago(date, uuid) to authenticated;
