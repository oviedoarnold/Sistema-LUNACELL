-- Conciliación administrativa de ventas sin conexión (OFF-1.1).
--
-- Una venta en ventas_por_conciliar ya se cobró y se entregó. Conciliar es
-- decidir cómo queda en los libros, nunca hacerla desaparecer ni cambiar lo
-- cobrado:
-- - aplicar: se registra con el vendedor, la ubicación, la fecha y el
--   precio que de verdad se cobraron;
-- - aplicar_con_ajuste: si falta existencia, primero un ajuste explícito
--   con la justificación del administrador y después la venta, sin dejar
--   nunca existencias negativas;
-- - anular: el registro se conserva con su motivo.
--
-- Por qué no usa registrar_venta_ubicacion(): esa función toma el
-- usuario, la ubicación y el precio de quien llama y del momento, y aquí
-- quien llama es el administrador y la venta ya ocurrió. Se registra con
-- los datos originales, en una sola transacción, sin tocar aquella.
--
-- Lo que NO hace: no toca ningún dato existente; solo crea la función.

create or replace function public.conciliar_venta(
  p_conciliacion uuid,
  p_accion       text,
  p_motivo       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin       usuarios := acceso_administrador(auth.uid());
  v_motivo      text := btrim(coalesce(p_motivo, ''));
  v_c           ventas_por_conciliar;
  v_item        record;
  v_disponible  integer;
  v_faltan      integer;
  v_movimiento  bigint;
  v_ajustes     jsonb := '[]'::jsonb;
  v_cliente     uuid;
  v_credito     boolean;
  v_subtotal    numeric(12,2);
  v_isv         numeric(12,2);
  v_total       numeric(12,2);
  v_correlativo bigint;
  v_numero      text;
  v_venta       uuid;
begin
  if p_accion is null or p_accion not in ('aplicar', 'aplicar_con_ajuste', 'anular') then
    raise exception 'Acción de conciliación desconocida: %', coalesce(p_accion, '(vacía)')
      using errcode = 'CV001';
  end if;

  if v_motivo = '' then
    raise exception 'Escribe el motivo de la conciliación' using errcode = 'CV001';
  end if;

  /*
    El candado de la fila serializa a dos administradores: el segundo
    espera y, al entrar, ya la encuentra resuelta.
  */
  select * into v_c
    from ventas_por_conciliar
   where id = p_conciliacion and empresa_id = v_admin.empresa_id
     for update;

  if v_c.id is null then
    raise exception 'Esa venta por conciliar no existe en tu empresa' using errcode = '42501';
  end if;

  if v_c.estado = 'aplicada' then
    if p_accion = 'anular' then
      raise exception 'Esa venta ya se aplicó: no se puede anular desde aquí' using errcode = 'CV002';
    end if;

    return jsonb_build_object('estado', 'ya_aplicada', 'conciliacion_id', v_c.id, 'venta_id', v_c.venta_id);
  end if;

  if v_c.estado = 'anulada' then
    if p_accion <> 'anular' then
      raise exception 'Esa venta ya se anuló: no se puede aplicar' using errcode = 'CV002';
    end if;

    return jsonb_build_object('estado', 'ya_anulada', 'conciliacion_id', v_c.id);
  end if;

  if p_accion = 'anular' then
    update ventas_por_conciliar
       set estado = 'anulada', resuelta_en = now(), resuelta_por = v_admin.id,
           resolucion_accion = 'anular', resolucion_motivo = v_motivo
     where id = v_c.id;

    return jsonb_build_object('estado', 'anulada', 'conciliacion_id', v_c.id);
  end if;

  -- ── aplicar ──
  if exists (
    select 1 from ventas where empresa_id = v_c.empresa_id and clave_idempotencia = v_c.clave_idempotencia
  ) then
    raise exception 'Ya existe una venta con la clave de esta conciliación' using errcode = 'CV002';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_c.renglones) r
     where not exists (
       select 1 from productos p where p.id = (r->>'producto_id')::uuid and p.empresa_id = v_c.empresa_id)
  ) then
    raise exception 'Uno de los productos de la venta ya no existe en la empresa: anúlala'
      using errcode = 'CV003';
  end if;

  /*
    Una ubicación fiscal emite factura con numeración autorizada, y un
    número fiscal no se emite a posteriori desde aquí. La conciliación
    registra documentos internos, así que esa venta se anula y se emite
    por el procedimiento fiscal que corresponda.
  */
  if exists (select 1 from ubicaciones where id = v_c.ubicacion_id and emite_fiscal) then
    raise exception 'La venta es de una ubicación fiscal: no se registra como documento interno. Anúlala y emítela por el procedimiento fiscal'
      using errcode = 'CV007';
  end if;

  v_credito := v_c.forma_pago = 'credito';

  select c.id into v_cliente from clientes c
   where c.id = v_c.cliente_id and c.empresa_id = v_c.empresa_id;

  if v_credito and v_cliente is null then
    raise exception 'El cliente de esta venta a crédito no existe: anúlala o regístrala de nuevo'
      using errcode = 'CV004';
  end if;

  /*
    Las celdas de la ubicación de la venta, bajo candado y en orden de
    producto (el mismo orden que la venta en línea, para no bloquearse
    mutuamente). Lo que falte solo se repone con «aplicar con ajuste», y
    exactamente lo que falta: nunca queda una existencia negativa.
  */
  for v_item in
    select (r->>'producto_id')::uuid as producto_id, sum((r->>'cantidad')::int)::int as cantidad
      from jsonb_array_elements(v_c.renglones) r
     group by 1
     order by 1
  loop
    insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
    values (v_c.empresa_id, v_c.ubicacion_id, v_item.producto_id, 0)
    on conflict (ubicacion_id, producto_id) do nothing;

    select cantidad into v_disponible
      from inventario_ubicacion
     where ubicacion_id = v_c.ubicacion_id and producto_id = v_item.producto_id
       for update;

    v_faltan := v_item.cantidad - v_disponible;

    if v_faltan > 0 then
      if p_accion = 'aplicar' then
        raise exception 'Faltan % de «%» en la ubicación: usa «aplicar con ajuste» con la justificación',
          v_faltan, (select nombre from productos where id = v_item.producto_id)
          using errcode = 'CV005';
      end if;

      update inventario_ubicacion
         set cantidad = cantidad + v_faltan, actualizado_en = now()
       where ubicacion_id = v_c.ubicacion_id and producto_id = v_item.producto_id;

      insert into movimientos_inventario (
        empresa_id, producto_id, usuario_id, venta_id, ubicacion_id, tipo, cantidad, motivo
      ) values (
        v_c.empresa_id, v_item.producto_id, v_admin.id, null, v_c.ubicacion_id, 'ajuste', v_faltan,
        'Ajuste por conciliación de ' || v_c.numero_provisional || ': ' || v_motivo
      )
      returning id into v_movimiento;

      v_ajustes := v_ajustes || to_jsonb(v_movimiento);
    end if;
  end loop;

  /*
    Los importes, con lo que se cobró, agrupados por producto y precio como
    los agrupa registrar_venta_ubicacion(): mismo redondeo por línea, mismo
    ISV sobre el subtotal. Deben dar el total cobrado.
  */
  select coalesce(sum(l.subtotal), 0)
    into v_subtotal
    from (
      select round((r->>'precio_unitario')::numeric * sum((r->>'cantidad')::int), 2) as subtotal
        from jsonb_array_elements(v_c.renglones) r
       group by r->>'producto_id', (r->>'precio_unitario')::numeric
    ) l;

  v_isv   := round(v_subtotal * v_c.tasa_isv / 100, 2);
  v_total := v_subtotal + v_isv;

  if v_total <> v_c.total_cobrado then
    raise exception 'Los renglones no dan el total cobrado (% frente a %)', v_total, v_c.total_cobrado
      using errcode = 'CV006';
  end if;

  -- Siempre documento interno: un número fiscal no se emite a posteriori.
  v_correlativo := siguiente_correlativo('interno');
  v_numero      := numero_interno(v_correlativo);

  insert into ventas (
    empresa_id, cliente_id, usuario_id, ubicacion_id,
    numero_factura, correlativo, es_fiscal, fecha,
    nombre_cliente, rtn_comprador,
    subtotal, isv, tasa_isv, total,
    forma_pago, fecha_vencimiento, estado,
    cai_emision, rango_desde_emision, rango_hasta_emision, fecha_limite_emision_emision,
    nota, clave_idempotencia,
    origen, dispositivo, numero_provisional, registrada_en, recibida_en,
    reloj_dispositivo, desfase_segundos, huella_origen
  ) values (
    v_c.empresa_id, v_cliente, v_c.usuario_id, v_c.ubicacion_id,
    v_numero, v_correlativo, false, v_c.registrada_en,
    coalesce(nullif(v_c.nombre_cliente, ''), 'Consumidor Final'), v_c.rtn_comprador,
    v_subtotal, v_isv, v_c.tasa_isv, v_total,
    v_c.forma_pago, case when v_credito then v_c.fecha_vencimiento end,
    case when v_credito then 'pendiente' else 'pagada' end,
    '', null, null, null,
    v_c.nota, v_c.clave_idempotencia,
    'conciliacion', v_c.dispositivo, v_c.numero_provisional, v_c.registrada_en, v_c.recibida_en,
    v_c.reloj_dispositivo, v_c.desfase_segundos, v_c.huella
  )
  returning id into v_venta;

  -- Una línea por producto y precio, como en la venta en línea.
  insert into detalle_venta (empresa_id, venta_id, producto_id, nombre, codigo, cantidad, precio, subtotal)
  select v_c.empresa_id, v_venta, p.id,
         coalesce(nullif(min(r->>'nombre'), ''), p.nombre), coalesce(min(r->>'codigo'), ''),
         sum((r->>'cantidad')::int), (r->>'precio_unitario')::numeric,
         round((r->>'precio_unitario')::numeric * sum((r->>'cantidad')::int), 2)
    from jsonb_array_elements(v_c.renglones) r
    join productos p on p.id = (r->>'producto_id')::uuid
   group by p.id, p.nombre, (r->>'precio_unitario')::numeric;

  for v_item in
    select (r->>'producto_id')::uuid as producto_id, sum((r->>'cantidad')::int)::int as cantidad
      from jsonb_array_elements(v_c.renglones) r
     group by 1
     order by 1
  loop
    update inventario_ubicacion
       set cantidad = cantidad - v_item.cantidad, actualizado_en = now()
     where ubicacion_id = v_c.ubicacion_id and producto_id = v_item.producto_id;

    insert into movimientos_inventario (
      empresa_id, producto_id, usuario_id, venta_id, ubicacion_id, tipo, cantidad, motivo
    ) values (
      v_c.empresa_id, v_item.producto_id, v_c.usuario_id, v_venta, v_c.ubicacion_id,
      'salida', -v_item.cantidad, 'Venta (conciliación)'
    );
  end loop;

  update ventas_por_conciliar
     set estado = 'aplicada', venta_id = v_venta, resuelta_en = now(), resuelta_por = v_admin.id,
         resolucion_accion = p_accion, resolucion_motivo = v_motivo, ajuste_movimientos = v_ajustes
   where id = v_c.id;

  return jsonb_build_object(
    'estado', 'aplicada', 'conciliacion_id', v_c.id, 'venta_id', v_venta,
    'numero_factura', v_numero, 'total', v_total, 'ajustes', v_ajustes);
end $$;

revoke execute on function public.conciliar_venta(uuid, text, text) from public, anon;
grant execute on function public.conciliar_venta(uuid, text, text) to authenticated;
