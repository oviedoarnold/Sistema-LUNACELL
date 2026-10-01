-- La venta deja de ser cuatro viajes del navegador y pasa a ser una
-- operación del motor.
--
-- Hasta hoy facturar era: pedir correlativo, insertar la cabecera,
-- insertar el detalle y escribir los movimientos, cada cosa por su cuenta
-- desde el navegador, y con la existencia comprobada únicamente en React
-- contra un número global de toda la empresa. Eso tiene tres agujeros que
-- no se tapan por partes:
--
--   1. Nadie en el servidor comprueba que haya stock. Una petición
--      fabricada vende lo que no existe.
--   2. No hay candado. Dos vendedores con la última unidad la venden los
--      dos, y el stock queda en negativo.
--   3. No hay transacción. Si falla el detalle se intenta borrar la
--      cabecera con otra llamada; si ese borrado también falla, queda una
--      factura sin renglones, sin descuento y con un correlativo quemado.
--
-- Esta función los cierra a la vez, porque son el mismo agujero visto
-- desde tres sitios: la venta no era una operación.
--
-- Lo que NO trae: medios de pago (efectivo, transferencia, POS, link),
-- banco, traslados, ni la regla de qué ubicaciones pueden facturar. Cada
-- una tiene su fase.

-- ─────────────────────────────────────────────────────────
-- EL NÚMERO DE FACTURA, DEL LADO QUE MANDA
-- ─────────────────────────────────────────────────────────
/*
  Quita lo que no sea dígito; si no queda nada devuelve el valor por
  omisión; si queda, toma los ÚLTIMOS p_largo y rellena con ceros a la
  izquierda. Es exactamente lo que hace soloDigitos() en utils/fiscal.js,
  incluido el detalle de quedarse con los últimos y no con los primeros.
*/
create or replace function solo_digitos(
  p_valor text,
  p_largo integer,
  p_por_omision text
)
returns text
language sql
immutable
as $$
  select case
    when regexp_replace(coalesce(p_valor, ''), '\D', '', 'g') = ''
    then p_por_omision
    else lpad(
      right(regexp_replace(coalesce(p_valor, ''), '\D', '', 'g'), p_largo),
      p_largo,
      '0'
    )
  end
$$;

/*
  El formato lo decidía utils/fiscal.js en el navegador. Para una venta
  pasa a decidirlo el motor, porque es un dato fiscal y quien lo emite no
  puede ser quien lo pide.

  Si la empresa no tiene la numeración autorizada configurada —CAI, rango
  y fecha límite— el documento no es fiscal y sale como FAC-00001, igual
  que antes. El correlativo fiscal va a ocho dígitos.

  Esto duplica una lógica que también vive en JavaScript, y es a
  propósito: el navegador la sigue necesitando para la vista previa y para
  las cotizaciones, que no pasan por aquí. Las dos tienen que dar lo
  mismo, y por eso las pruebas fijan cadenas concretas en vez de comparar
  una implementación con la otra.
*/
create or replace function numero_de_factura(
  p_correlativo bigint,
  p_cai text,
  p_rango_hasta bigint,
  p_fecha_limite date,
  p_establecimiento text,
  p_punto_emision text,
  p_tipo_documento text
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(btrim(coalesce(p_cai, '')), '') <> ''
     and coalesce(p_rango_hasta, 0) > 0
     and p_fecha_limite is not null
    then
      solo_digitos(p_establecimiento, 3, '000') || '-' ||
      solo_digitos(p_punto_emision, 3, '001')   || '-' ||
      solo_digitos(p_tipo_documento, 2, '01')   || '-' ||
      lpad(greatest(coalesce(p_correlativo, 0), 0)::text, 8, '0')
    else
      'FAC-' || lpad(greatest(coalesce(p_correlativo, 0), 0)::text, 5, '0')
  end
$$;

-- ─────────────────────────────────────────────────────────
-- LA VENTA
-- ─────────────────────────────────────────────────────────
/*
  Qué recibe y, sobre todo, qué NO recibe.

  No acepta empresa, ni usuario, ni ubicación, ni importes. No es una
  simplificación del contrato: es el contrato. Si el navegador pudiera
  decir desde qué ubicación sale la mercadería, bastaría una llamada
  falsificada para vaciar el camión de otro; si pudiera decir el total,
  bastaría para cobrar de menos. Lo que manda es la intención —qué
  productos, cuántos, a quién, contado o crédito— y nada que decida
  autorización ni dinero.

  Los renglones llegan como jsonb porque son una lista de longitud
  variable. Cada uno:

    { "producto_id": uuid, "cantidad": entero > 0 }

  El precio NO viaja. Se lee de productos dentro de la transacción, que es
  lo único que impide vender a un precio enviado por quien compra.
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

  select id, nombre, tipo, activa into v_ubic
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
    Aquí irá la comprobación de si la ubicación puede facturar —la bodega
    no emite factura legal—. Hoy no existe la columna que lo expresa y no
    se inventa una regla por tipo: «bodega» describe qué ES el sitio, no
    qué PUEDE hacer, y codificarlo aquí dejaría sin salida el día que haya
    un segundo almacén que sí venda. Queda para INV-3.2, que es donde se
    decidió que entra `ubicaciones.vende`.

    No es imprescindible para la atomicidad: la venta ya es atómica,
    segura y aislada sin esa regla. Lo que falta es una política de
    negocio sobre qué sitios facturan, no una garantía técnica.
  */

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
    El precio sale de productos y la tasa de empresas. Ninguno de los dos
    llega del navegador, así que manipular el payload no abarata nada.
    Las mismas reglas que calculaba SalesContext, del lado que manda.
  */
  select * into v_emp from empresas where id = v_empresa;

  v_tasa     := coalesce(v_emp.tasa_isv, 15);
  v_subtotal := round(v_subtotal, 2);
  v_isv      := round(v_subtotal * v_tasa / 100, 2);
  v_total    := round(v_subtotal + v_isv, 2);

  -- ── el correlativo ──
  /*
    Se pide DENTRO de la transacción, que es la diferencia con el flujo
    anterior: allí se pedía antes de insertar nada y un fallo posterior
    quemaba el número. Aquí, si algo falla después, el rollback devuelve
    también el contador.

    siguiente_correlativo() ya toma el candado de la fila de la empresa
    con su UPDATE ... RETURNING, así que dos ventas simultáneas no pueden
    recibir el mismo número.
  */
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

  -- ── la factura ──
  insert into ventas (
    empresa_id, cliente_id, usuario_id, ubicacion_id,
    numero_factura, correlativo,
    nombre_cliente, rtn_comprador,
    subtotal, isv, tasa_isv, total,
    forma_pago, fecha_vencimiento, estado,
    cai_emision, rango_desde_emision, rango_hasta_emision,
    fecha_limite_emision_emision,
    nota, clave_idempotencia
  ) values (
    v_empresa, p_cliente_id, v_usuario, v_ubicacion,
    v_numero, v_correlativo,
    coalesce(nullif(btrim(coalesce(p_nombre_cliente, '')), ''), 'Consumidor Final'),
    coalesce(p_rtn_comprador, ''),
    v_subtotal, v_isv, v_tasa, v_total,
    v_forma,
    case when v_credito then p_fecha_vencimiento else null end,
    case when v_credito then 'pendiente' else 'pagada' end,
    coalesce(v_emp.cai, ''),
    v_emp.rango_desde, v_emp.rango_hasta, v_emp.fecha_limite_emision,
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

    /*
      Y queda el movimiento, ahora CON ubicación, que es lo que permitirá
      preguntar de dónde salió cada unidad.
    */
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
    'subtotal',       v_subtotal,
    'isv',            v_isv,
    'total',          v_total,
    'repetida',       false
  );
end $$;

-- ─────────────────────────────────────────────────────────
-- QUIÉN PUEDE EJECUTARLA
-- ─────────────────────────────────────────────────────────
/*
  Mismo criterio que registrar_pago_cliente(): nadie por omisión, y
  después solo quien debe. `anon` no factura; `authenticated` sí, y la
  función ya comprueba por dentro que tenga empresa y ubicación.
  service_role se conserva por el mismo motivo aceptado en CxC-2: es el
  rol de las tareas del servidor, que no pasan por RLS en ningún caso.
*/
revoke execute on function registrar_venta_ubicacion(
  jsonb, text, uuid, text, text, date, text, text
) from public;

revoke execute on function registrar_venta_ubicacion(
  jsonb, text, uuid, text, text, date, text, text
) from anon;

grant execute on function registrar_venta_ubicacion(
  jsonb, text, uuid, text, text, date, text, text
) to authenticated, service_role;
