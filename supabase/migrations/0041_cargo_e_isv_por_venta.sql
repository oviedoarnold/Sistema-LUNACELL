-- Cargo del 7 % en tarjeta y enlace de pago, ISV decidido en cada venta, y retiro
-- de la comisión interna.
--
-- El cargo lo paga el comprador y se guarda aparte: ventas.total sigue siendo
-- productos más ISV. Así no cambian el saldo de crédito, la suma exacta de los
-- medios, los correlativos ni la validación de las ventas sin conexión. Lo cobrado
-- es ventas.total más ventas.cargo_por_medio.
--
-- La casilla de ISV llega de la pantalla: quita el ISV de esa venta. Una factura
-- fiscal siempre lo lleva. registrar_venta_ubicacion() no cambia: sigue calculándolo,
-- y quien pidió la venta sin ISV lo retira en la misma transacción.
--
-- Una operación de una versión anterior no manda cargo: se registra con cargo 0,
-- que es lo que pagó ese comprador. Va antes que el frontend nuevo.
--
-- Borra las comisiones estimadas ya guardadas: no se pueden recuperar.

-- ─────────────────────────────────────────────────────────
-- COMISIÓN INTERNA: SE RETIRA
-- ─────────────────────────────────────────────────────────
drop trigger if exists anotar_comision_de_cobro on public.cobros_por_medio;
drop trigger if exists sembrar_tasas_de_comision on public.empresas;
drop function if exists public.configurar_tasa_de_comision(text, numeric);
drop function if exists public.anotar_comision_de_cobro();
drop function if exists public.sembrar_tasas_de_comision();
drop table if exists public.comisiones_de_cobro;
drop table if exists public.tasas_de_comision;

-- ─────────────────────────────────────────────────────────
-- DÓNDE VIVE EL CARGO
-- ─────────────────────────────────────────────────────────
alter table public.cobros_por_medio
  add column if not exists cargo numeric(12,2) not null default 0;

alter table public.cobros_por_medio drop constraint if exists cobros_por_medio_cargo;
alter table public.cobros_por_medio add constraint cobros_por_medio_cargo check (
  cargo >= 0 and (medio in ('tarjeta', 'enlace') or cargo = 0)
);

-- En la venta y en el pago, para que quien reimprime no necesite leer los cobros,
-- que son solo del administrador.
alter table public.ventas
  add column if not exists cargo_por_medio numeric(12,2) not null default 0 check (cargo_por_medio >= 0);

alter table public.pagos
  add column if not exists cargo_por_medio numeric(12,2) not null default 0 check (cargo_por_medio >= 0);

alter table public.anulaciones_venta
  add column if not exists cargo_a_devolver numeric(12,2) not null default 0 check (cargo_a_devolver >= 0);

-- ─────────────────────────────────────────────────────────
-- EL CÁLCULO
-- ─────────────────────────────────────────────────────────
-- El mismo que cargoDe() en src/utils/mediosDePago.js.
create or replace function public.cargo_de_cobro(p_medio text, p_monto numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_medio in ('tarjeta', 'enlace') then round(p_monto * 7 / 100, 2) else 0 end
$$;

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
  v_cargo      numeric;
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
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        return 'El importe de un medio de pago no es válido';
    end;

    if v_monto is null or v_monto <= 0 or v_monto <> round(v_monto, 2) or v_monto >= 10000000000 then
      return 'El importe de un medio de pago no es válido';
    end if;

    -- Sin cargo es una versión anterior. Si viene, tiene que ser el que da la cuenta.
    if v_cargo is not null and v_cargo <> public.cargo_de_cobro(v_medio, v_monto) then
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
        'cargo', round(coalesce((c->>'cargo')::numeric, 0), 2),
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
      jsonb_build_object('medio', x.medio, 'monto', x.monto, 'cargo', x.cargo, 'referencia', x.referencia)
      order by x.medio
    ),
    '[]'::jsonb
  )
  from (
    select c.medio, c.referencia, sum(c.monto) as monto, sum(c.cargo) as cargo
      from public.cobros_por_medio c
     where c.venta_id = p_venta or c.pago_id = p_pago
     group by c.medio, c.referencia
  ) x
$$;

create or replace function public.guardar_cobros_de_venta(p_venta uuid, p_cobros jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cobros_por_medio (empresa_id, venta_id, medio, monto, cargo, referencia, ubicacion_id, usuario_id, fecha)
  select v.empresa_id, v.id, c->>'medio', (c->>'monto')::numeric, (c->>'cargo')::numeric, c->>'referencia', v.ubicacion_id, v.usuario_id, v.fecha
    from public.ventas v
   cross join jsonb_array_elements(public.cobros_normalizados(p_cobros)) c
   where v.id = p_venta;

  update public.ventas
     set cargo_por_medio = (select coalesce(sum(c.cargo), 0) from public.cobros_por_medio c where c.venta_id = p_venta)
   where id = p_venta;
end $$;

/*
  Los medios de un pago, por ubicación. Un vendedor cobra en su ubicación, así
  que hay un solo tramo. Un administrador puede cobrar facturas de varias: cada
  medio se asigna en orden a los tramos, de la factura más vieja a la más
  reciente, igual que el pago se reparte entre las facturas. El cargo se reparte
  en proporción, y el último tramo de cada medio lleva lo que queda: la suma de
  los tramos es exactamente el cargo del medio.
*/
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

  for v_cobro in select * from jsonb_array_elements(public.cobros_normalizados(p_cobros)) loop
    v_monto       := (v_cobro->>'monto')::numeric;
    v_cargo       := (v_cobro->>'cargo')::numeric;
    v_resto       := v_monto;
    v_resto_cargo := v_cargo;

    while v_resto > 0 loop
      v_toma := least(v_resto, v_disponible[v_i]);

      if v_toma > 0 then
        v_toma_cargo := case when v_toma = v_resto then v_resto_cargo
                             else least(round(v_cargo * v_toma / v_monto, 2), v_resto_cargo) end;

        insert into public.cobros_por_medio (empresa_id, pago_id, medio, monto, cargo, referencia, ubicacion_id, usuario_id, fecha)
        values (v_pago.empresa_id, v_pago.id, v_cobro->>'medio', v_toma, v_toma_cargo, v_cobro->>'referencia',
                v_ubicacion[v_i], v_pago.usuario_id, v_pago.fecha);

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
     set cargo_por_medio = (select coalesce(sum(c.cargo), 0) from public.cobros_por_medio c where c.pago_id = p_pago)
   where id = p_pago;
end $$;

-- ─────────────────────────────────────────────────────────
-- EL ISV DE CADA VENTA
-- ─────────────────────────────────────────────────────────
-- Una factura fiscal lleva siempre su ISV.
create or replace function public.quitar_isv_de_venta(p_venta uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ventas
     set isv = 0, tasa_isv = 0, total = subtotal
   where id = p_venta
     and not es_fiscal;

  if not found then
    raise exception 'Una factura fiscal lleva ISV: no se puede vender sin él desde esta ubicación'
      using errcode = 'LV009';
  end if;
end $$;

revoke execute on function
  public.cargo_de_cobro(text, numeric),
  public.quitar_isv_de_venta(uuid)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- VENDER
-- ─────────────────────────────────────────────────────────
drop function if exists public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text);

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

  perform guardar_cobros_de_venta((v_venta->>'venta_id')::uuid, p_cobros);

  return v_venta;
end $$;

revoke execute on function public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text, boolean) from public, anon;
grant execute on function public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────
-- SIN CONEXIÓN
-- ─────────────────────────────────────────────────────────
/*
  La misma función de la 0027 con dos cambios: una venta con tasa 0 ya no es un
  precio distinto, y al registrarla se le quita el ISV. La tasa va en la huella,
  así que un reintento no cambia de decisión.
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
         where p.precio <> (r->>'precio_unitario')::numeric
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

-- ─────────────────────────────────────────────────────────
-- ANULAR
-- ─────────────────────────────────────────────────────────
/*
  El cargo se devuelve con el reembolso, porque el comprador lo pagó. Un disparador
  y no un cambio en anular_venta(): esa función no se toca. Si el dinero no se llegó
  a cobrar, no hay cargo que devolver.
*/
create or replace function public.anotar_cargo_a_devolver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.cargo_a_devolver := case
    when new.tratamiento_dinero = 'reembolso_pendiente' then
      coalesce((select v.cargo_por_medio from public.ventas v where v.id = new.venta_id), 0)
    else 0
  end;

  return new;
end $$;

revoke execute on function public.anotar_cargo_a_devolver() from public, anon, authenticated;

drop trigger if exists anotar_cargo_a_devolver on public.anulaciones_venta;
create trigger anotar_cargo_a_devolver
  before insert on public.anulaciones_venta
  for each row execute function public.anotar_cargo_a_devolver();

-- ─────────────────────────────────────────────────────────
-- LOS REPORTES
-- ─────────────────────────────────────────────────────────
/*
  cobros_total sigue siendo lo mismo en los dos reportes, sin cargos, y por eso
  siguen coincidiendo. El dinero que entró es total_cobrado.
*/
create or replace function public.reporte_diario(
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
    raise exception 'El reporte diario es solo para administradores'
      using errcode = '42501';
  end if;

  v_empresa := public.empresa_del_usuario();
  v_dia     := coalesce(p_dia, (now() at time zone 'America/Tegucigalpa')::date);
  v_desde   := v_dia::timestamp at time zone 'America/Tegucigalpa';
  v_hasta   := (v_dia + 1)::timestamp at time zone 'America/Tegucigalpa';

  with
  ventas_dia as (
    select v.id, v.fecha, v.numero_factura, v.correlativo, v.ubicacion_id, v.usuario_id,
           v.nombre_cliente, v.forma_pago, v.total, v.cargo_por_medio, v.estado, v.origen
      from public.ventas v
     where v.empresa_id = v_empresa
       and v.fecha >= v_desde and v.fecha < v_hasta
       and (p_ubicacion is null or v.ubicacion_id = p_ubicacion)
  ),
  validas as (
    select * from ventas_dia where estado <> 'anulada'
  ),
  abonos_dia as (
    select a.id, a.fecha, a.monto, a.usuario_id, a.pago_id,
           v.numero_factura, v.fecha as fecha_venta, v.nombre_cliente,
           coalesce(p.ubicacion_id, v.ubicacion_id) as ubicacion_id
      from public.abonos a
      join public.ventas v on v.id = a.venta_id
      left join public.pagos p on p.id = a.pago_id
     where a.empresa_id = v_empresa
       and a.fecha >= v_desde and a.fecha < v_hasta
       and (p.id is null or p.estado = 'aplicado')
       and (p_ubicacion is null or coalesce(p.ubicacion_id, v.ubicacion_id) = p_ubicacion)
  ),
  anulaciones_dia as (
    select an.id, an.anulada_en, an.numero_documento, an.ubicacion_venta as ubicacion_id,
           an.forma_pago, an.total, an.cargo_a_devolver, an.saldo_cancelado, an.usuario_nombre, an.motivo,
           an.tratamiento_dinero, v.fecha as fecha_venta, v.nombre_cliente
      from public.anulaciones_venta an
      join public.ventas v on v.id = an.venta_id
     where an.empresa_id = v_empresa
       and an.anulada_en >= v_desde and an.anulada_en < v_hasta
       and (p_ubicacion is null or an.ubicacion_venta = p_ubicacion)
  ),
  movimientos_dia as (
    select m.id, m.fecha, m.tipo, m.cantidad, m.motivo, m.ubicacion_id, m.usuario_id,
           m.venta_id, m.traslado_id, pr.codigo, pr.nombre as producto,
           case
             when m.tipo = 'salida' and m.venta_id is not null then 'venta'
             else m.tipo
           end as clase
      from public.movimientos_inventario m
      join public.productos pr on pr.id = m.producto_id
     where m.empresa_id = v_empresa
       and m.fecha >= v_desde and m.fecha < v_hasta
       and (p_ubicacion is null or m.ubicacion_id = p_ubicacion)
  ),
  ubicaciones_reporte as (
    select ubicacion_id from validas
    union select ubicacion_id from abonos_dia
    union select ubicacion_id from anulaciones_dia
    union
    select u.id from public.ubicaciones u
     where u.empresa_id = v_empresa and u.activa
       and (p_ubicacion is null or u.id = p_ubicacion)
  ),
  por_ubicacion as (
    select r.ubicacion_id,
           coalesce(u.nombre, 'Sin ubicación') as ubicacion,
           coalesce(ve.total, 0) as ventas_total,
           coalesce(ve.cantidad, 0) as ventas_cantidad,
           coalesce(ve.ticket, 0) as ticket_promedio,
           coalesce(ve.contado, 0) as contado_total,
           coalesce(ve.credito, 0) as credito_total,
           coalesce(ab.total, 0) as abonos_total,
           coalesce(ve.contado, 0) + coalesce(ab.total, 0) as cobros_total,
           coalesce(an.total, 0) as anuladas_total
      from ubicaciones_reporte r
      left join public.ubicaciones u on u.id = r.ubicacion_id
      left join lateral (
        select sum(total) as total, count(*) as cantidad, round(avg(total), 2) as ticket,
               sum(total) filter (where forma_pago = 'contado') as contado,
               sum(total) filter (where forma_pago = 'credito') as credito
          from validas x where x.ubicacion_id is not distinct from r.ubicacion_id
      ) ve on true
      left join lateral (
        select sum(monto) as total from abonos_dia x where x.ubicacion_id is not distinct from r.ubicacion_id
      ) ab on true
      left join lateral (
        select sum(total) as total from anulaciones_dia x where x.ubicacion_id is not distinct from r.ubicacion_id
      ) an on true
  ),
  vendedores_reporte as (
    select usuario_id from validas
    union select usuario_id from abonos_dia
  ),
  por_vendedor as (
    select r.usuario_id,
           coalesce(us.nombre, 'Sin usuario') as vendedor,
           coalesce(ve.total, 0) as ventas_total,
           coalesce(ve.cantidad, 0) as ventas_cantidad,
           coalesce(ve.ticket, 0) as ticket_promedio,
           coalesce(ve.contado, 0) as contado_total,
           coalesce(ve.credito, 0) as credito_total,
           coalesce(ab.total, 0) as abonos_total
      from vendedores_reporte r
      left join public.usuarios us on us.id = r.usuario_id
      left join lateral (
        select sum(total) as total, count(*) as cantidad, round(avg(total), 2) as ticket,
               sum(total) filter (where forma_pago = 'contado') as contado,
               sum(total) filter (where forma_pago = 'credito') as credito
          from validas x where x.usuario_id is not distinct from r.usuario_id
      ) ve on true
      left join lateral (
        select sum(monto) as total from abonos_dia x where x.usuario_id is not distinct from r.usuario_id
      ) ab on true
  )
  select jsonb_build_object(
    'dia', v_dia,
    'ubicacion_id', p_ubicacion,
    'empresa', (select e.nombre from public.empresas e where e.id = v_empresa),
    'moneda', (select e.moneda from public.empresas e where e.id = v_empresa),

    'indicadores', (
      select jsonb_build_object(
        'ventas_total', coalesce((select sum(total) from validas), 0),
        'ventas_cantidad', (select count(*) from validas),
        'ticket_promedio', coalesce((select round(avg(total), 2) from validas), 0),
        'contado_total', coalesce((select sum(total) from validas where forma_pago = 'contado'), 0),
        'contado_cantidad', (select count(*) from validas where forma_pago = 'contado'),
        'credito_total', coalesce((select sum(total) from validas where forma_pago = 'credito'), 0),
        'credito_cantidad', (select count(*) from validas where forma_pago = 'credito'),
        'abonos_total', coalesce((select sum(monto) from abonos_dia), 0),
        'abonos_cantidad', (select count(*) from abonos_dia),
        'cobros_total',
          coalesce((select sum(total) from validas where forma_pago = 'contado'), 0)
          + coalesce((select sum(monto) from abonos_dia), 0),
        'cargos_total',
          coalesce((select sum(cargo_por_medio) from validas where forma_pago = 'contado'), 0)
          + coalesce((select sum(p.cargo_por_medio) from public.pagos p where p.id in (select pago_id from abonos_dia)), 0),
        'total_cobrado',
          coalesce((select sum(total + cargo_por_medio) from validas where forma_pago = 'contado'), 0)
          + coalesce((select sum(monto) from abonos_dia), 0)
          + coalesce((select sum(p.cargo_por_medio) from public.pagos p where p.id in (select pago_id from abonos_dia)), 0),
        'anuladas_total', coalesce((select sum(total) from anulaciones_dia), 0),
        'anuladas_cantidad', (select count(*) from anulaciones_dia),
        'reembolsos_pendientes',
          coalesce((select sum(total + cargo_a_devolver) from anulaciones_dia where tratamiento_dinero = 'reembolso_pendiente'), 0),
        'por_conciliar', (
          select count(*) from public.ventas_por_conciliar c
           where c.empresa_id = v_empresa
             and c.estado = 'pendiente'
             and c.registrada_en >= v_desde and c.registrada_en < v_hasta
             and (p_ubicacion is null or c.ubicacion_id = p_ubicacion)
        )
      )
    ),

    'por_ubicacion', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.ventas_total desc, x.ubicacion) from por_ubicacion x
    ), '[]'::jsonb),

    'por_vendedor', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.ventas_total desc, x.vendedor) from por_vendedor x
    ), '[]'::jsonb),

    'ventas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'fecha', v.fecha,
          'numero', v.numero_factura,
          'ubicacion', coalesce(u.nombre, 'Sin ubicación'),
          'vendedor', coalesce(us.nombre, 'Sin usuario'),
          'cliente', v.nombre_cliente,
          'forma_pago', v.forma_pago,
          'total', v.total,
          'estado', v.estado,
          'origen', v.origen,
          'productos', coalesce((
            select jsonb_agg(
              jsonb_build_object('nombre', d.nombre, 'codigo', d.codigo, 'cantidad', d.cantidad)
              order by d.nombre, d.id
            )
              from public.detalle_venta d where d.venta_id = v.id
          ), '[]'::jsonb)
        )
        order by v.fecha, v.correlativo, v.id
      )
        from ventas_dia v
        left join public.ubicaciones u on u.id = v.ubicacion_id
        left join public.usuarios us on us.id = v.usuario_id
    ), '[]'::jsonb),

    'abonos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'fecha', a.fecha,
          'numero', a.numero_factura,
          'fecha_venta', a.fecha_venta,
          'ubicacion', coalesce(u.nombre, 'Sin ubicación'),
          'cobrador', coalesce(us.nombre, 'Sin usuario'),
          'cliente', a.nombre_cliente,
          'monto', a.monto
        )
        order by a.fecha, a.id
      )
        from abonos_dia a
        left join public.ubicaciones u on u.id = a.ubicacion_id
        left join public.usuarios us on us.id = a.usuario_id
    ), '[]'::jsonb),

    'anulaciones', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'fecha', a.anulada_en,
          'numero', a.numero_documento,
          'fecha_venta', a.fecha_venta,
          'ubicacion', coalesce(u.nombre, 'Sin ubicación'),
          'anulada_por', a.usuario_nombre,
          'cliente', a.nombre_cliente,
          'forma_pago', a.forma_pago,
          'total', a.total,
          'tratamiento_dinero', a.tratamiento_dinero,
          'motivo', a.motivo
        )
        order by a.anulada_en, a.id
      )
        from anulaciones_dia a
        left join public.ubicaciones u on u.id = a.ubicacion_id
    ), '[]'::jsonb),

    'movimientos_resumen', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.clase)
        from (
          select clase, count(*) as movimientos, sum(cantidad) as unidades
            from movimientos_dia
           group by clase
        ) x
    ), '[]'::jsonb),

    'movimientos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'fecha', m.fecha,
          'clase', m.clase,
          'codigo', m.codigo,
          'producto', m.producto,
          'cantidad', m.cantidad,
          'ubicacion', coalesce(u.nombre, 'Sin ubicación'),
          'usuario', coalesce(us.nombre, 'Sin usuario'),
          'documento', v.numero_factura,
          'origen', uo.nombre,
          'destino', ud.nombre,
          'motivo', m.motivo
        )
        order by m.fecha, m.id
      )
        from movimientos_dia m
        left join public.ubicaciones u on u.id = m.ubicacion_id
        left join public.usuarios us on us.id = m.usuario_id
        left join public.ventas v on v.id = m.venta_id
        left join public.traslados t on t.id = m.traslado_id
        left join public.ubicaciones uo on uo.id = t.origen_id
        left join public.ubicaciones ud on ud.id = t.destino_id
    ), '[]'::jsonb)
  )
  into v_reporte;

  return v_reporte;
end $$;

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
           jsonb_agg(jsonb_build_object('medio', c.medio, 'monto', c.monto, 'cargo', c.cargo, 'referencia', c.referencia) order by c.medio) as medios
      from public.cobros_por_medio c
     where c.venta_id in (
       select id from ventas_dia union select venta_id from anulaciones_dia
     )
     group by c.venta_id
  ),
  medios_de_pago as (
    select x.pago_id as id,
           jsonb_agg(jsonb_build_object('medio', x.medio, 'monto', x.monto, 'cargo', x.cargo, 'referencia', x.referencia) order by x.medio) as medios
      from (
        select c.pago_id, c.medio, c.referencia, sum(c.monto) as monto, sum(c.cargo) as cargo
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
