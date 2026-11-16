-- Porcentaje adicional por medio de pago, configurable por el administrador.
--
-- Tarjeta y enlace de pago suman un porcentaje a lo que paga el comprador. Hasta
-- aquí era un 7 % fijo en el código (0041); el requerimiento correcto es 1.7 %, y el
-- administrador lo cambia desde Configuración, uno por medio.
--
-- - La tasa vive en `empresas` (tasa_cargo_tarjeta, tasa_cargo_enlace), junto a la
--   tasa de ISV. Nace en 1.7 para las dos.
-- - Cada cambio queda en `cambios_de_cargo_por_medio`: quién, cuándo, la tasa
--   anterior y la nueva. Lo anota un disparador, así que también queda el que se
--   haga fuera de la aplicación. Esta migración anota el paso de 7 a 1.7.
-- - Cada cobro guarda la tasa con la que se cobró (`cobros_por_medio.tasa_cargo`),
--   y la venta y el pago la suya para el documento (`tasa_cargo`).
-- - Decide el servidor: una venta o un abono en línea con un cargo calculado con
--   otra tasa se rechaza (LM007) y no se registra. Una venta sin conexión cobrada con
--   la tasa que regía en su fecha se registra; con otra, va a conciliación y conserva
--   lo cobrado.
--
-- No cambia ningún importe guardado: las ventas, abonos y anulaciones anteriores
-- quedan con el cargo que se cobró. Las columnas nuevas nacen vacías en lo
-- existente. La anulación ya usa el cargo guardado (anotar_cargo_a_devolver).
--
-- Va antes que su frontend. Entre las dos, la versión publicada calcula el 7 % y el
-- servidor rechaza esos cobros con tarjeta o enlace (LM007), sin registrar nada;
-- efectivo, transferencia y crédito siguen igual.

-- ─────────────────────────────────────────────────────────
-- LA TASA DE CADA EMPRESA
-- ─────────────────────────────────────────────────────────
alter table public.empresas
  add column if not exists tasa_cargo_tarjeta numeric(5,2) not null default 1.7,
  add column if not exists tasa_cargo_enlace  numeric(5,2) not null default 1.7;

alter table public.empresas drop constraint if exists empresas_tasas_de_cargo;
alter table public.empresas add constraint empresas_tasas_de_cargo check (
  tasa_cargo_tarjeta between 0 and 100 and tasa_cargo_enlace between 0 and 100
);

-- ─────────────────────────────────────────────────────────
-- EL HISTORIAL DE CAMBIOS
-- ─────────────────────────────────────────────────────────
create table if not exists public.cambios_de_cargo_por_medio (
  id                  bigint generated always as identity primary key,
  empresa_id          uuid not null references public.empresas (id),
  medio               text not null check (medio in ('tarjeta', 'enlace')),
  tasa_anterior       numeric(5,2) not null check (tasa_anterior between 0 and 100),
  tasa_nueva          numeric(5,2) not null check (tasa_nueva between 0 and 100),
  cambiado_por        uuid references public.usuarios (id),
  cambiado_por_nombre text not null,
  cambiado_en         timestamptz not null default now()
);

create index if not exists idx_cambios_de_cargo_por_medio
  on public.cambios_de_cargo_por_medio (empresa_id, medio, cambiado_en);

create or replace function public.cambio_de_cargo_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El historial del porcentaje adicional no se modifica ni se borra'
    using errcode = '42501';
end $$;

revoke execute on function public.cambio_de_cargo_inmutable() from public, anon, authenticated;

drop trigger if exists cambios_de_cargo_por_medio_inmutable on public.cambios_de_cargo_por_medio;
create trigger cambios_de_cargo_por_medio_inmutable
  before update or delete on public.cambios_de_cargo_por_medio
  for each row execute function public.cambio_de_cargo_inmutable();

drop trigger if exists cambios_de_cargo_por_medio_sin_vaciar on public.cambios_de_cargo_por_medio;
create trigger cambios_de_cargo_por_medio_sin_vaciar
  before truncate on public.cambios_de_cargo_por_medio
  for each statement execute function public.cambio_de_cargo_inmutable();

-- El contador no escribe en ninguna tabla (0036).
drop trigger if exists impedir_escritura_del_contador on public.cambios_de_cargo_por_medio;
create trigger impedir_escritura_del_contador
  before insert or update or delete or truncate on public.cambios_de_cargo_por_medio
  for each statement execute function public.impedir_escritura_del_contador();

-- Solo lo escribe el disparador. Lo lee el administrador de la empresa.
alter table public.cambios_de_cargo_por_medio enable row level security;
revoke all on public.cambios_de_cargo_por_medio from public, anon, authenticated, service_role;
grant select on public.cambios_de_cargo_por_medio to authenticated, service_role;

drop policy if exists cambios_de_cargo_por_medio_lectura_admin on public.cambios_de_cargo_por_medio;
create policy cambios_de_cargo_por_medio_lectura_admin on public.cambios_de_cargo_por_medio
  for select to authenticated
  using (empresa_id = (select public.empresa_del_usuario()) and (select public.usuario_es_admin()));

/*
  Anota cada tasa que cambia. Quién: el usuario de la sesión; fuera de la
  aplicación (SQL Editor) no hay usuario y lo dice el nombre.
*/
create or replace function public.anotar_cambio_de_cargo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario public.usuarios;
begin
  select * into v_usuario from public.usuarios u
   where u.auth_id = auth.uid() and u.empresa_id = new.id
   limit 1;

  insert into public.cambios_de_cargo_por_medio (empresa_id, medio, tasa_anterior, tasa_nueva, cambiado_por, cambiado_por_nombre)
  select new.id, x.medio, x.anterior, x.nueva, v_usuario.id, coalesce(v_usuario.nombre, 'Fuera de la aplicación')
    from (values (1, 'tarjeta', old.tasa_cargo_tarjeta, new.tasa_cargo_tarjeta),
                 (2, 'enlace', old.tasa_cargo_enlace, new.tasa_cargo_enlace)) as x(orden, medio, anterior, nueva)
   where x.anterior is distinct from x.nueva
   order by x.orden;

  return null;
end $$;

revoke execute on function public.anotar_cambio_de_cargo() from public, anon, authenticated;

drop trigger if exists anotar_cambio_de_cargo on public.empresas;
create trigger anotar_cambio_de_cargo
  after update of tasa_cargo_tarjeta, tasa_cargo_enlace on public.empresas
  for each row execute function public.anotar_cambio_de_cargo();

-- El paso del 7 % fijo de la 0041 a la tasa nueva. Una sola vez por empresa.
insert into public.cambios_de_cargo_por_medio (empresa_id, medio, tasa_anterior, tasa_nueva, cambiado_por, cambiado_por_nombre)
select e.id, m.medio, 7, case m.medio when 'tarjeta' then e.tasa_cargo_tarjeta else e.tasa_cargo_enlace end, null, 'Migración 0044'
  from public.empresas e
 cross join (values (1, 'tarjeta'), (2, 'enlace')) as m(orden, medio)
 where not exists (select 1 from public.cambios_de_cargo_por_medio c where c.empresa_id = e.id and c.medio = m.medio)
 order by e.id, m.orden;

-- ─────────────────────────────────────────────────────────
-- CAMBIARLA
-- ─────────────────────────────────────────────────────────
/*
  Solo un administrador, para su empresa. Errores: 42501, sin permiso (también el
  contador); LM006, una tasa fuera de 0 a 100 o con más de dos decimales.
*/
create or replace function public.configurar_cargos_por_medio(p_tarjeta numeric, p_enlace numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa public.empresas;
begin
  if not public.usuario_es_admin() then
    raise exception 'Solo un administrador cambia el porcentaje adicional' using errcode = '42501';
  end if;

  if p_tarjeta is null or p_tarjeta < 0 or p_tarjeta > 100 or p_tarjeta <> round(p_tarjeta, 2)
     or p_enlace is null or p_enlace < 0 or p_enlace > 100 or p_enlace <> round(p_enlace, 2) then
    raise exception 'El porcentaje debe estar entre 0 y 100, con hasta dos decimales' using errcode = 'LM006';
  end if;

  update public.empresas
     set tasa_cargo_tarjeta = p_tarjeta,
         tasa_cargo_enlace = p_enlace
   where id = public.empresa_del_usuario()
  returning * into v_empresa;

  return jsonb_build_object('tarjeta', v_empresa.tasa_cargo_tarjeta, 'enlace', v_empresa.tasa_cargo_enlace);
end $$;

revoke execute on function public.configurar_cargos_por_medio(numeric, numeric) from public, anon;
grant execute on function public.configurar_cargos_por_medio(numeric, numeric) to authenticated;

-- ─────────────────────────────────────────────────────────
-- QUÉ TASA REGÍA
-- ─────────────────────────────────────────────────────────
/*
  La de ahora, sin fecha. Con fecha, la que regía en ese momento según el
  historial: la nueva del último cambio anterior, o la anterior del primer cambio
  posterior. Efectivo y transferencia no llevan.
*/
create or replace function public.tasa_de_cargo(p_empresa uuid, p_medio text, p_en timestamptz default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_medio is distinct from 'tarjeta' and p_medio is distinct from 'enlace' then 0::numeric else coalesce(
    (select c.tasa_nueva from public.cambios_de_cargo_por_medio c
      where p_en is not null and c.empresa_id = p_empresa and c.medio = p_medio and c.cambiado_en <= p_en
      order by c.cambiado_en desc, c.id desc
      limit 1),
    (select c.tasa_anterior from public.cambios_de_cargo_por_medio c
      where p_en is not null and c.empresa_id = p_empresa and c.medio = p_medio and c.cambiado_en > p_en
      order by c.cambiado_en, c.id
      limit 1),
    (select case p_medio when 'tarjeta' then e.tasa_cargo_tarjeta else e.tasa_cargo_enlace end
       from public.empresas e
      where e.id = p_empresa)
  ) end
$$;

-- El mismo cálculo que cargoDe() en src/utils/mediosDePago.js.
create or replace function public.cargo_de_cobro(p_medio text, p_monto numeric, p_tasa numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_medio in ('tarjeta', 'enlace') then round(p_monto * p_tasa / 100, 2) else 0 end
$$;

-- La de la 0041 tenía el 7 % escrito.
drop function if exists public.cargo_de_cobro(text, numeric);

revoke execute on function
  public.tasa_de_cargo(uuid, text, timestamptz),
  public.cargo_de_cobro(text, numeric, numeric)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- LA TASA DE CADA COBRO
-- ─────────────────────────────────────────────────────────
-- Vacía en lo anterior a esta migración: no se rellena hacia atrás.
alter table public.cobros_por_medio
  add column if not exists tasa_cargo numeric(5,2);

alter table public.cobros_por_medio drop constraint if exists cobros_por_medio_tasa_cargo;
alter table public.cobros_por_medio add constraint cobros_por_medio_tasa_cargo check (
  tasa_cargo is null or (tasa_cargo between 0 and 100 and (medio in ('tarjeta', 'enlace') or tasa_cargo = 0))
);

-- La del documento: la de tarjeta y enlace si fue una sola; si no, vacía.
alter table public.ventas
  add column if not exists tasa_cargo numeric(5,2) check (tasa_cargo between 0 and 100);

alter table public.pagos
  add column if not exists tasa_cargo numeric(5,2) check (tasa_cargo between 0 and 100);

/*
  Qué tienen de mal formado los medios; null si nada. Nunca lanza. Como en la 0041,
  más la tasa: si viene, el cargo tiene que ser el que da con ella. Si no viene, si
  es la que rige lo decide cargo_de_cobros_distinto().
*/
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
  v_cargo      numeric;
  v_tasa       numeric;
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
      v_cargo := (v_cobro->>'cargo')::numeric;
      v_tasa  := (v_cobro->>'tasa')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        return 'El importe de un medio de pago no es válido';
    end;

    if v_monto is null or v_monto <= 0 or v_monto <> round(v_monto, 2) or v_monto >= 10000000000 then
      return 'El importe de un medio de pago no es válido';
    end if;

    if v_tasa is not null and (v_tasa < 0 or v_tasa > 100 or v_tasa <> round(v_tasa, 2)
                               or (v_medio not in ('tarjeta', 'enlace') and v_tasa <> 0)) then
      return 'El porcentaje adicional de un medio de pago no es válido';
    end if;

    if v_cargo is not null and (v_cargo < 0 or v_cargo <> round(v_cargo, 2)
                                or (v_medio not in ('tarjeta', 'enlace') and v_cargo <> 0)) then
      return 'El cargo de un medio de pago no coincide con su importe';
    end if;

    if v_tasa is not null and v_cargo is distinct from public.cargo_de_cobro(v_medio, v_monto, v_tasa) then
      return 'El cargo de un medio de pago no coincide con su importe';
    end if;

    if jsonb_typeof(coalesce(v_cobro->'referencia', 'null'::jsonb)) not in ('string', 'null') then
      return 'La referencia de un medio de pago no es válida';
    end if;

    v_referencia := btrim(coalesce(v_cobro->>'referencia', ''));

    if v_medio = 'efectivo' and v_referencia <> '' then
      return 'El efectivo no lleva referencia';
    end if;

    if char_length(v_referencia) > 120 then
      return 'La referencia es demasiado larga';
    end if;
  end loop;

  return null;
end $$;

/*
  ¿Se cobró con la tasa que rige? Null si sí. Sin fecha, la de ahora (en línea);
  con fecha, la que regía entonces (sin conexión). Un cobro sin cargo ni tasa es de
  una versión anterior y queda con cargo 0, como en la 0041.
*/
create or replace function public.cargo_de_cobros_distinto(p_cobros jsonb, p_empresa uuid, p_en timestamptz default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cobro    jsonb;
  v_medio    text;
  v_tasa     numeric;
  v_cargo    numeric;
  v_rige     numeric;
  v_etiqueta text;
begin
  for v_cobro in select * from jsonb_array_elements(p_cobros) loop
    v_medio := v_cobro->>'medio';

    continue when v_medio not in ('tarjeta', 'enlace');

    v_tasa  := round((v_cobro->>'tasa')::numeric, 2);
    v_cargo := (v_cobro->>'cargo')::numeric;

    continue when v_tasa is null and v_cargo is null;

    v_rige := public.tasa_de_cargo(p_empresa, v_medio, p_en);

    if coalesce(v_tasa, v_rige) <> v_rige
       or (v_cargo is not null and v_cargo <> public.cargo_de_cobro(v_medio, (v_cobro->>'monto')::numeric, v_rige)) then
      v_etiqueta := case v_medio when 'tarjeta' then 'Tarjeta' else 'Enlace de pago' end;

      if p_en is null then
        return format('El porcentaje adicional de %s es %s %%. Revisa el total y vuelve a confirmar.',
          v_etiqueta, trim_scale(v_rige));
      end if;

      return format('%s se cobró con %s, y en la fecha de la venta regía %s %%',
        v_etiqueta, coalesce(trim_scale(v_tasa)::text || ' %', 'otro porcentaje'), trim_scale(v_rige));
    end if;
  end loop;

  return null;
end $$;

/*
  Los medios como los compara cobros_normalizados(), más la tasa con la que se
  cobró: la declarada; sin ella, la que rige si el cargo coincide; vacía si no se
  sabe. Sin cargo ni tasa (versión anterior) es 0, que es lo que se cobró.
*/
create or replace function public.cobros_con_tasa(p_cobros jsonb, p_empresa uuid, p_en timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'medio', c->>'medio',
        'monto', round((c->>'monto')::numeric, 2),
        'cargo', round(coalesce((c->>'cargo')::numeric, 0), 2),
        'referencia', btrim(coalesce(c->>'referencia', '')),
        'tasa', case
          when c->>'medio' not in ('tarjeta', 'enlace') then 0
          when c->>'tasa' is not null then round((c->>'tasa')::numeric, 2)
          when c->>'cargo' is null then 0
          when (c->>'cargo')::numeric = public.cargo_de_cobro(
                 c->>'medio', (c->>'monto')::numeric, public.tasa_de_cargo(p_empresa, c->>'medio', p_en))
            then public.tasa_de_cargo(p_empresa, c->>'medio', p_en)
        end
      )
      order by c->>'medio'
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(p_cobros) c
$$;

-- La tasa de tarjeta y enlace de una venta o un pago, si fue una sola.
create or replace function public.tasa_de_cargo_de(p_venta uuid, p_pago uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when count(*) > 0 and count(c.tasa_cargo) = count(*) and count(distinct c.tasa_cargo) = 1
           then min(c.tasa_cargo)
         end
    from public.cobros_por_medio c
   where (c.venta_id = p_venta or c.pago_id = p_pago)
     and c.medio in ('tarjeta', 'enlace')
$$;

revoke execute on function
  public.cargo_de_cobros_distinto(jsonb, uuid, timestamptz),
  public.cobros_con_tasa(jsonb, uuid, timestamptz),
  public.tasa_de_cargo_de(uuid, uuid)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- GUARDAR CON LA TASA
-- ─────────────────────────────────────────────────────────
-- Como en la 0041, con la tasa de cada medio si viene (cobros_con_tasa()).
create or replace function public.guardar_cobros_de_venta(p_venta uuid, p_cobros jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cobros_por_medio (empresa_id, venta_id, medio, monto, cargo, tasa_cargo, referencia, ubicacion_id, usuario_id, fecha)
  select v.empresa_id, v.id, c->>'medio', round((c->>'monto')::numeric, 2), round(coalesce((c->>'cargo')::numeric, 0), 2),
         round((c->>'tasa')::numeric, 2), btrim(coalesce(c->>'referencia', '')), v.ubicacion_id, v.usuario_id, v.fecha
    from public.ventas v
   cross join jsonb_array_elements(p_cobros) c
   where v.id = p_venta;

  update public.ventas
     set cargo_por_medio = (select coalesce(sum(c.cargo), 0) from public.cobros_por_medio c where c.venta_id = p_venta),
         tasa_cargo = public.tasa_de_cargo_de(p_venta, null)
   where id = p_venta;
end $$;

-- Como en la 0041, con la tasa de cada medio en cada tramo.
create or replace function public.guardar_cobros_de_pago(p_pago uuid, p_cobros jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pago        public.pagos;
  v_ubicacion   uuid[];
  v_disponible  numeric[];
  v_cobro       jsonb;
  v_monto       numeric;
  v_cargo       numeric;
  v_tasa        numeric;
  v_resto       numeric;
  v_resto_cargo numeric;
  v_toma        numeric;
  v_toma_cargo  numeric;
  v_i           integer := 1;
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

  for v_cobro in select c from jsonb_array_elements(p_cobros) c order by c->>'medio' loop
    v_monto       := round((v_cobro->>'monto')::numeric, 2);
    v_cargo       := round(coalesce((v_cobro->>'cargo')::numeric, 0), 2);
    v_tasa        := round((v_cobro->>'tasa')::numeric, 2);
    v_resto       := v_monto;
    v_resto_cargo := v_cargo;

    while v_resto > 0 loop
      v_toma := least(v_resto, v_disponible[v_i]);

      if v_toma > 0 then
        v_toma_cargo := case when v_toma = v_resto then v_resto_cargo
                             else least(round(v_cargo * v_toma / v_monto, 2), v_resto_cargo) end;

        insert into public.cobros_por_medio (empresa_id, pago_id, medio, monto, cargo, tasa_cargo, referencia, ubicacion_id, usuario_id, fecha)
        values (v_pago.empresa_id, v_pago.id, v_cobro->>'medio', v_toma, v_toma_cargo, v_tasa,
                btrim(coalesce(v_cobro->>'referencia', '')), v_ubicacion[v_i], v_pago.usuario_id, v_pago.fecha);

        v_resto_cargo := v_resto_cargo - v_toma_cargo;
      end if;

      v_disponible[v_i] := v_disponible[v_i] - v_toma;
      v_resto := v_resto - v_toma;

      if v_disponible[v_i] = 0 then
        v_i := v_i + 1;
      end if;
    end loop;
  end loop;

  update public.pagos
     set cargo_por_medio = (select coalesce(sum(c.cargo), 0) from public.cobros_por_medio c where c.pago_id = p_pago),
         tasa_cargo = public.tasa_de_cargo_de(null, p_pago)
   where id = p_pago;
end $$;

-- ─────────────────────────────────────────────────────────
-- VENDER Y COBRAR EN LÍNEA
-- ─────────────────────────────────────────────────────────
/*
  La de la 0043 con un cambio al final: antes de guardar los medios de una venta
  nueva, el cargo tiene que ser el de la tasa de ahora. Un reintento devuelve la
  venta que ya existe aunque la tasa haya cambiado después.
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
  p_clave_idempotencia text default null,
  p_con_isv            boolean default true
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
  v_credito   boolean := p_forma_pago = 'credito';
  v_empresa   uuid;
begin
  if v_credito then
    if coalesce(jsonb_array_length(p_cobros), 0) > 0 then
      raise exception 'Una venta a crédito no lleva medios de pago: se cobra con sus abonos'
        using errcode = 'LM003';
    end if;
  else
    v_invalidos := medios_de_cobro_invalidos(p_cobros);

    if v_invalidos is not null then
      raise exception '%', v_invalidos using errcode = 'LM001';
    end if;
  end if;

  v_venta := registrar_venta_ubicacion(
    p_items, p_forma_pago, p_cliente_id, p_nombre_cliente, p_rtn_comprador,
    p_fecha_vencimiento, p_nota, p_clave_idempotencia);

  -- El precio negociado va antes que el ISV y los medios, que se calculan sobre él.
  if (v_venta->>'repetida')::boolean then
    if negociacion_distinta((v_venta->>'venta_id')::uuid, p_items) then
      raise exception 'La clave % ya se usó con otros precios negociados', p_clave_idempotencia
        using errcode = 'LM005';
    end if;
  else
    v_venta := v_venta || aplicar_precios_negociados((v_venta->>'venta_id')::uuid, p_items);
  end if;

  if (v_venta->>'repetida')::boolean then
    -- Un reintento trae la misma casilla: si no, es otra venta con la misma clave.
    if exists (
      select 1 from ventas v join empresas e on e.id = v.empresa_id
       where v.id = (v_venta->>'venta_id')::uuid
         and coalesce(e.tasa_isv, 15) > 0
         and (v.tasa_isv > 0) <> coalesce(p_con_isv, true)
    ) then
      raise exception 'La clave % ya se usó con otra decisión de ISV', p_clave_idempotencia
        using errcode = 'LM005';
    end if;
  elsif not coalesce(p_con_isv, true) then
    perform quitar_isv_de_venta((v_venta->>'venta_id')::uuid);
    v_venta := v_venta || jsonb_build_object('total', v_venta->'subtotal', 'isv', 0);
  end if;

  if v_credito then
    return v_venta;
  end if;

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

  select v.empresa_id into v_empresa from ventas v where v.id = (v_venta->>'venta_id')::uuid;

  v_invalidos := cargo_de_cobros_distinto(p_cobros, v_empresa);

  if v_invalidos is not null then
    raise exception '%', v_invalidos using errcode = 'LM007';
  end if;

  perform guardar_cobros_de_venta((v_venta->>'venta_id')::uuid, cobros_con_tasa(p_cobros, v_empresa));

  return v_venta;
end $$;

-- La de la 0039 con el mismo cambio.
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
  v_empresa   uuid;
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

  select p.empresa_id into v_empresa from pagos p where p.id = (v_pago->>'pago_id')::uuid;

  v_invalidos := cargo_de_cobros_distinto(p_cobros, v_empresa);

  if v_invalidos is not null then
    raise exception '%', v_invalidos using errcode = 'LM007';
  end if;

  perform guardar_cobros_de_pago((v_pago->>'pago_id')::uuid, cobros_con_tasa(p_cobros, v_empresa));

  return v_pago;
end $$;

-- ─────────────────────────────────────────────────────────
-- SIN CONEXIÓN
-- ─────────────────────────────────────────────────────────
/*
  La sincronización de la 0043, ahora interna, con un dato más: si los medios se
  cobraron con otra tasa que la que regía en la fecha de la venta. Entonces la venta
  va a conciliación, como un precio distinto, y conserva lo cobrado.
*/
create or replace function public.recibir_venta_sin_conexion(
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
  p_cargo_distinto     text default null
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
  v_negociados jsonb;
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
         where coalesce(r->>'negociado', '') <> 'true'
           and precio_de_venta(v_usuario.empresa_id, p_cliente_id, p.id) <> (r->>'precio_unitario')::numeric
      ) then 'precio-distinto'
  end;

  -- Cobrada con otro porcentaje adicional que el de su fecha: lo resuelve conciliación.
  if v_motivo is null and p_cargo_distinto is not null then
    v_motivo  := 'precio-distinto';
    v_detalle := p_cargo_distinto;
  end if;

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

      -- Lo negociado, con el precio de referencia que vio el vendedor y la hora de la venta.
      select jsonb_agg(jsonb_build_object(
               'producto_id', r->'producto_id', 'precio_negociado', r->'precio_unitario',
               'motivo_negociacion', r->'motivo_negociacion', 'precio_referencia', r->'precio_referencia'))
        into v_negociados
        from jsonb_array_elements(p_renglones) r
       where r->>'negociado' = 'true';

      if v_negociados is not null then
        v_resultado := v_resultado || aplicar_precios_negociados(
          (v_resultado->>'venta_id')::uuid, v_negociados, true, p_registrada_en);
      end if;

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
      when sqlstate 'OF009' or sqlstate 'LN001' then
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

revoke execute on function public.recibir_venta_sin_conexion(
  text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, uuid, text, text, date, text, text
) from public, anon, authenticated;

-- La de siempre, para lo que no lleva medios (crédito, versiones anteriores).
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
language sql
security definer
set search_path = public
as $$
  select recibir_venta_sin_conexion(
    p_clave_idempotencia, p_usuario_auth, p_ubicacion_id, p_dispositivo, p_numero_provisional,
    p_registrada_en, p_reloj_dispositivo, p_tasa_isv, p_renglones, p_total_cobrado, p_forma_pago,
    p_cliente_id, p_nombre_cliente, p_rtn_comprador, p_fecha_vencimiento, p_nota, null)
$$;

/*
  La de la 0039 con lo que guarda: los medios llegan con su tasa
  (cobros_con_tasa()), y se comparan sin ella.
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
    values (v_conc, p_empresa, p_cobros);
    return true;
  end if;

  if v_estado = 'ya_registrada' then
    v_guardados := public.cobros_guardados(v_venta, null);
  elsif v_estado = 'ya_en_conciliacion' then
    select public.cobros_normalizados(c.cobros) into v_guardados
      from public.cobros_por_conciliar c where c.conciliacion_id = v_conc;
  end if;

  return coalesce(v_guardados, '[]'::jsonb) = '[]'::jsonb
      or v_guardados = public.cobros_normalizados(p_cobros);
end $$;

-- La de la 0039, con la tasa que regía en la fecha de la venta.
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
  v_empresa   uuid := (select u.empresa_id from usuarios u where u.auth_id = auth.uid() limit 1);
begin
  v_invalidos := medios_sin_conexion_invalidos(p_forma_pago, p_cobros, p_total_cobrado);

  if v_invalidos is not null then
    raise exception '%', v_invalidos using errcode = 'OF001';
  end if;

  v_respuesta := recibir_venta_sin_conexion(
    p_clave_idempotencia, p_usuario_auth, p_ubicacion_id, p_dispositivo, p_numero_provisional,
    p_registrada_en, p_reloj_dispositivo, p_tasa_isv, p_renglones, p_total_cobrado, p_forma_pago,
    p_cliente_id, p_nombre_cliente, p_rtn_comprador, p_fecha_vencimiento, p_nota,
    case when coalesce(jsonb_array_length(p_cobros), 0) > 0
         then cargo_de_cobros_distinto(p_cobros, v_empresa, p_registrada_en) end);

  if not guardar_cobros_sin_conexion(v_empresa, v_respuesta, cobros_con_tasa(coalesce(p_cobros, '[]'::jsonb), v_empresa, p_registrada_en)) then
    raise exception 'La clave % ya se usó con otros medios de pago', p_clave_idempotencia
      using errcode = 'OF003';
  end if;

  return v_respuesta;
end $$;

-- La de la 0039: un rescate siempre va a conciliación, y conserva la tasa declarada.
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
       or guardar_cobros_sin_conexion(
            v_admin.empresa_id, v_respuesta,
            cobros_con_tasa(coalesce(p_cobros, '[]'::jsonb), v_admin.empresa_id, p_registrada_en)) then
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

-- ─────────────────────────────────────────────────────────
-- EL REPORTE
-- ─────────────────────────────────────────────────────────
-- El de la 0041 con la tasa de cada medio en cada venta y cada abono.
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
    select an.id, an.venta_id, an.cargo_a_devolver
      from public.anulaciones_venta an
     where an.empresa_id = v_empresa
       and an.anulada_en >= v_desde and an.anulada_en < v_hasta
       and (p_ubicacion is null or an.ubicacion_venta = p_ubicacion)
  ),
  cobros_dia as (
    select c.id, c.medio, c.monto, c.cargo, v.ubicacion_id
      from public.cobros_por_medio c
      join ventas_dia v on v.id = c.venta_id
     where v.estado <> 'anulada'
    union all
    select c.id, c.medio, c.monto, c.cargo, c.ubicacion_id
      from public.cobros_por_medio c
      join public.pagos p on p.id = c.pago_id
     where c.empresa_id = v_empresa
       and p.estado = 'aplicado'
       and p.fecha >= v_desde and p.fecha < v_hasta
       and (p_ubicacion is null or c.ubicacion_id = p_ubicacion)
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
    select medio, monto, ubicacion_id, cargo from cobros_dia
    union all
    select 'sin_registrar', monto, ubicacion_id, 0 from sin_registrar
  ),
  medios_de_venta as (
    select c.venta_id as id,
           jsonb_agg(jsonb_build_object('medio', c.medio, 'monto', c.monto, 'cargo', c.cargo, 'tasa', c.tasa_cargo, 'referencia', c.referencia) order by c.medio) as medios
      from public.cobros_por_medio c
     where c.venta_id in (
       select id from ventas_dia union select venta_id from anulaciones_dia
     )
     group by c.venta_id
  ),
  medios_de_pago as (
    select x.pago_id as id,
           jsonb_agg(jsonb_build_object('medio', x.medio, 'monto', x.monto, 'cargo', x.cargo, 'tasa', x.tasa, 'referencia', x.referencia) order by x.medio) as medios
      from (
        select c.pago_id, c.medio, c.referencia, c.tasa_cargo as tasa, sum(c.monto) as monto, sum(c.cargo) as cargo
          from public.cobros_por_medio c
         where c.pago_id in (select pago_id from abonos_dia)
         group by c.pago_id, c.medio, c.referencia, c.tasa_cargo
      ) x
     group by x.pago_id
  )
  select jsonb_build_object(
    'totales', (
      select jsonb_build_object(
        'total', coalesce(sum(monto), 0),
        'registrado', coalesce(sum(monto) filter (where medio <> 'sin_registrar'), 0),
        'sin_registrar', coalesce(sum(monto) filter (where medio = 'sin_registrar'), 0),
        'cargos', coalesce(sum(cargo), 0),
        'total_cobrado', coalesce(sum(monto), 0) + coalesce(sum(cargo), 0),
        'cargos_a_devolver', coalesce((select sum(cargo_a_devolver) from anulaciones_dia), 0)
      )
      from todo
    ),

    'por_medio', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.orden)
        from (
          select medio,
                 count(*) as operaciones,
                 sum(monto) as monto,
                 sum(cargo) as cargo,
                 sum(monto) + sum(cargo) as total_cobrado,
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
                 sum(t.cargo) as cargo
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
