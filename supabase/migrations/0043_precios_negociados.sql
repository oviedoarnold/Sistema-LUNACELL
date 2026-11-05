-- Precios negociados durante una venta.
--
-- El vendedor puede cambiar el precio de un producto solo para la venta actual. No
-- cambia el precio general, el especial del cliente, el costo ni otras ventas.
--
-- Orden del precio: negociado, especial del cliente, general.
--
-- registrar_venta_ubicacion() sigue igual: registra con su precio, y después
-- aplicar_precios_negociados() cambia el renglón y recalcula la venta con la misma
-- fórmula, en la misma transacción, como quitar_isv_de_venta(). Por eso un precio
-- enviado directo a registrar_venta_ubicacion() se ignora.
--
-- No existe un precio mínimo de venta: esta migración no inventa uno.
--
-- Va antes que su frontend. La versión publicada sigue funcionando igual, porque
-- nunca envía un precio negociado. No cambia datos existentes.

-- ─────────────────────────────────────────────────────────
-- LA TRAZABILIDAD DE CADA RENGLÓN
-- ─────────────────────────────────────────────────────────
alter table public.detalle_venta
  add column if not exists precio_referencia    numeric(12,2),
  add column if not exists negociado_por        uuid references public.usuarios (id) on delete set null,
  add column if not exists negociado_por_nombre text,
  add column if not exists negociado_en         timestamptz,
  add column if not exists motivo_negociacion   text;

alter table public.detalle_venta drop constraint if exists detalle_venta_motivo_negociacion;
alter table public.detalle_venta add constraint detalle_venta_motivo_negociacion
  check (motivo_negociacion is null or motivo_negociacion in ('mayoreo', 'cliente_frecuente', 'promocion', 'otro'));

alter table public.detalle_venta drop constraint if exists detalle_venta_negociacion_completa;
alter table public.detalle_venta add constraint detalle_venta_negociacion_completa
  check ((precio_referencia is null) = (negociado_en is null));

create index if not exists idx_detalle_venta_negociado
  on public.detalle_venta (empresa_id, negociado_en)
  where negociado_en is not null;

-- ─────────────────────────────────────────────────────────
-- APLICAR EL PRECIO
-- ─────────────────────────────────────────────────────────
/*
  Pieza interna: solo la llaman las funciones de venta y sincronización.
  Devuelve los importes nuevos, o nada si no hay precios negociados.

  El precio de referencia es el que había en el renglón. Solo una venta sin conexión
  declara el suyo, porque es el que vio el vendedor al vender.

  Bajar el precio exige un motivo. Errores: LN001, datos no válidos; 42501, sin permiso.
*/
create or replace function public.aplicar_precios_negociados(
  p_venta               uuid,
  p_items               jsonb,
  p_referencia_declarada boolean default false,
  p_en                  timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario    public.usuarios;
  v_item       jsonb;
  v_precio     numeric;
  v_referencia numeric;
  v_motivo     text;
  v_fila       public.detalle_venta;
  v_venta      public.ventas;
begin
  if not exists (select 1 from jsonb_array_elements(p_items) e where e->>'precio_negociado' is not null) then
    return '{}'::jsonb;
  end if;

  if public.usuario_es_contador() or not public.usuario_tiene_permiso('pos') then
    raise exception 'No tienes permiso para negociar precios' using errcode = '42501';
  end if;

  select * into v_usuario from public.usuarios u where u.auth_id = auth.uid() limit 1;

  for v_item in
    select e from jsonb_array_elements(p_items) e where e->>'precio_negociado' is not null
  loop
    begin
      v_precio := (v_item->>'precio_negociado')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'El precio negociado no es un número' using errcode = 'LN001';
    end;

    if v_precio <= 0 or v_precio <> round(v_precio, 2) or v_precio >= 10000000000 then
      raise exception 'El precio negociado debe ser mayor que cero y tener hasta dos decimales'
        using errcode = 'LN001';
    end if;

    if (select count(*) from jsonb_array_elements(p_items) o where o->>'producto_id' = v_item->>'producto_id') > 1 then
      raise exception 'Un producto con precio negociado no puede ir en dos renglones' using errcode = 'LN001';
    end if;

    select * into v_fila from public.detalle_venta d
     where d.venta_id = p_venta and d.producto_id = (v_item->>'producto_id')::uuid;

    if v_fila.id is null then
      raise exception 'El producto del precio negociado no está en la venta' using errcode = 'LN001';
    end if;

    v_referencia := v_fila.precio;

    if p_referencia_declarada and coalesce(v_item->>'precio_referencia', '') ~ '^[0-9]{1,10}([.][0-9]{1,2})?$'
       and (v_item->>'precio_referencia')::numeric > 0 then
      v_referencia := (v_item->>'precio_referencia')::numeric;
    end if;

    -- Igual a lo que ya valía: no hubo negociación.
    continue when v_precio = v_fila.precio and v_precio = v_referencia;

    v_motivo := nullif(btrim(coalesce(v_item->>'motivo_negociacion', '')), '');

    if v_motivo is not null and v_motivo not in ('mayoreo', 'cliente_frecuente', 'promocion', 'otro') then
      raise exception 'El motivo de la negociación no es válido' using errcode = 'LN001';
    end if;

    if v_motivo is null and v_precio < v_referencia then
      raise exception 'Bajar el precio necesita un motivo' using errcode = 'LN001';
    end if;

    update public.detalle_venta
       set precio = v_precio,
           subtotal = round(v_precio * cantidad, 2),
           precio_referencia = v_referencia,
           negociado_por = v_usuario.id,
           negociado_por_nombre = v_usuario.nombre,
           negociado_en = p_en,
           motivo_negociacion = v_motivo
     where id = v_fila.id;
  end loop;

  update public.ventas v
     set subtotal = s.subtotal,
         isv = round(s.subtotal * v.tasa_isv / 100, 2),
         total = s.subtotal + round(s.subtotal * v.tasa_isv / 100, 2)
    from (select coalesce(sum(d.subtotal), 0) as subtotal from public.detalle_venta d where d.venta_id = p_venta) s
   where v.id = p_venta
  returning v.* into v_venta;

  return jsonb_build_object('subtotal', v_venta.subtotal, 'isv', v_venta.isv, 'total', v_venta.total);
end $$;

-- Un reintento con la misma clave tiene que traer los mismos precios.
create or replace function public.negociacion_distinta(p_venta uuid, p_items jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from jsonb_array_elements(p_items) e
      join public.detalle_venta d on d.venta_id = p_venta and d.producto_id = (e->>'producto_id')::uuid
     where case
             when e->>'precio_negociado' is null then d.negociado_en is not null
             else d.precio <> (e->>'precio_negociado')::numeric
           end
  )
$$;

revoke execute on function
  public.aplicar_precios_negociados(uuid, jsonb, boolean, timestamptz),
  public.negociacion_distinta(uuid, jsonb)
from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- VENDER
-- ─────────────────────────────────────────────────────────
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

  perform guardar_cobros_de_venta((v_venta->>'venta_id')::uuid, p_cobros);

  return v_venta;
end $$;

-- ─────────────────────────────────────────────────────────
-- SIN CONEXIÓN
-- ─────────────────────────────────────────────────────────
/*
  La misma función de la 0042 con dos cambios: un renglón negociado no se compara con
  el precio vigente, y al registrarlo se aplica lo cobrado. Si no es válido, va a
  conciliación y conserva lo cobrado.
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

/*
  Al aplicar una conciliación, la venta ya lleva el precio cobrado: aquí se agrega su
  trazabilidad. Un disparador y no un cambio en conciliar_venta(), como los cobros.
  Lo que no sea válido no se guarda: nunca impide conciliar una venta ya cobrada.
*/
create or replace function public.aplicar_negociacion_de_conciliacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.venta_id is null then
    return null;
  end if;

  update public.detalle_venta d
     set precio_referencia = case
           when coalesce(r.valor->>'precio_referencia', '') ~ '^[0-9]{1,10}([.][0-9]{1,2})?$'
            and (r.valor->>'precio_referencia')::numeric > 0
           then (r.valor->>'precio_referencia')::numeric
           else d.precio
         end,
         negociado_por = new.usuario_id,
         negociado_por_nombre = (select u.nombre from public.usuarios u where u.id = new.usuario_id),
         negociado_en = new.registrada_en,
         motivo_negociacion = case
           when r.valor->>'motivo_negociacion' in ('mayoreo', 'cliente_frecuente', 'promocion', 'otro')
           then r.valor->>'motivo_negociacion'
         end
    from jsonb_array_elements(new.renglones) as r(valor)
   where d.venta_id = new.venta_id
     and r.valor->>'negociado' = 'true'
     and d.producto_id = (r.valor->>'producto_id')::uuid
     and d.precio = (r.valor->>'precio_unitario')::numeric;

  return null;
end $$;

revoke execute on function public.aplicar_negociacion_de_conciliacion() from public, anon, authenticated;

drop trigger if exists aplicar_negociacion_de_conciliacion on public.ventas_por_conciliar;
create trigger aplicar_negociacion_de_conciliacion
  after update of estado on public.ventas_por_conciliar
  for each row
  when (new.estado = 'aplicada' and old.estado = 'pendiente')
  execute function public.aplicar_negociacion_de_conciliacion();
