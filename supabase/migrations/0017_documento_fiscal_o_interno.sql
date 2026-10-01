-- Qué ubicaciones venden, cuál emite factura fiscal, y con qué numeración.
--
-- La 0016 dejó la venta atómica y por ubicación, pero armaba el documento
-- como si solo hubiera un emisor: pedía el correlativo de `empresas` y
-- sellaba el CAI de `empresas`, mirara de donde mirara la venta.
--
-- Hoy eso no se nota, porque no hay CAI configurado y todas las ventas
-- salen con numeración interna. Pero el día que se configure el CAI de la
-- tienda, una venta desde un camión se emitiría con ESE CAI y consumiría
-- ESE rango autorizado. No porque alguien lo decidiera: porque el sistema
-- no tenía dónde guardar otra respuesta.
--
-- Esta migración le da ese sitio, separando tres cosas que no son la
-- misma:
--
--   vender          -> ¿puede salir mercadería de aquí por una venta?
--   emitir fiscal   -> ¿lo que emite es factura autorizada o documento interno?
--   configuración   -> ¿con qué CAI, qué rango y qué contador?
--
-- Lo que NO trae: medios de pago, bancos, link de pago, traslados, ni la
-- conexión del punto de venta con el RPC. Cada una tiene su fase.

-- ─────────────────────────────────────────────────────────
-- QUÉ PUEDE HACER CADA UBICACIÓN
-- ─────────────────────────────────────────────────────────
/*
  Dos marcas y no una, porque son dos preguntas distintas y el caso de la
  bodega lo demuestra: el dueño quiere dejarla preparada para vender algún
  día sin que por ello emita factura fiscal. Con una sola marca habría que
  elegir entre las dos cosas.

  `vende` nace en VERDADERO y `emite_fiscal` en FALSO, y esa asimetría es
  deliberada:

  - `vende` en verdadero conserva lo que el sistema hace hoy, donde
    ninguna ubicación está marcada y todas son igual de capaces. Poner
    falso dejaría a la tienda y a los camiones sin poder facturar hasta
    que alguien se acordara de encenderlos.

  - `emite_fiscal` en falso es la respuesta segura, y es lo que hace que
    la invariante se cumpla POR OMISIÓN y no por configuración: ninguna
    ubicación puede consumir el rango autorizado mientras nadie diga
    expresamente cuál lo emite. Si esta migración se aplicara y nadie
    tocara nada más, sería imposible gastar el CAI de la tienda por
    accidente.

  Esta migración NO marca a ninguna ubicación como fiscal. Hacerlo
  buscándola por nombre es exactamente lo que no se debe hacer, y además
  es una decisión de negocio sobre datos reales: la toma el dueño desde
  Configuración.
*/
alter table ubicaciones
  add column if not exists vende boolean not null default true;

alter table ubicaciones
  add column if not exists emite_fiscal boolean not null default false;

/*
  No se puede emitir factura desde donde no se vende. Es la única relación
  entre las dos marcas, y conviene que la imponga la base: un formulario
  que ofrezca las dos casillas sueltas permitiría guardar la combinación
  imposible.
*/
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ubicacion_fiscal_tambien_vende'
       and conrelid = 'ubicaciones'::regclass
  ) then
    alter table ubicaciones
      add constraint ubicacion_fiscal_tambien_vende
      check (not emite_fiscal or vende);
  end if;
end $$;

/*
  Y como mucho UNA ubicación fiscal por empresa.

  Es la pieza que convierte «qué ubicación usa la configuración fiscal» en
  una pregunta con una sola respuesta. La configuración vive en `empresas`
  —un CAI, un rango, un contador— así que dos ubicaciones marcadas
  compartirían el mismo rango autorizado y nadie podría decir cuál lo
  gastó. El índice lo vuelve imposible en vez de dejarlo a la disciplina.

  Parcial, sobre las marcadas: las no fiscales son muchas y no compiten
  entre sí.
*/
create unique index if not exists ubicaciones_una_fiscal_por_empresa
  on ubicaciones (empresa_id)
  where emite_fiscal;

-- ─────────────────────────────────────────────────────────
-- EL CONTADOR DE LA NUMERACIÓN INTERNA
-- ─────────────────────────────────────────────────────────
/*
  Separado del fiscal, que es el punto de toda la migración.

  Mismo sitio y misma forma que los otros dos contadores de la empresa, y
  por la misma razón escrita en la 0001: dos empresas no comparten
  numeración. Lo que cambia es que ahora tampoco la comparten el documento
  autorizado y el interno.
*/
alter table empresas
  add column if not exists proximo_correlativo_interno bigint not null default 1;

/*
  La empresa ya tiene ventas con numeración interna «FAC-xxxxx» de antes
  de esta separación. El contador arranca después de la última para que un
  documento interno nuevo no choque visualmente con uno viejo, igual que
  hizo la 0005 con el correlativo fiscal.

  No renumera nada: las ventas viejas se quedan como están.

  El `where` no es decorativo y no es solo para contentar a un analizador:
  `empresas` es multiempresa, y sin él esta sentencia reescribiría la fila
  de cada empresa del sistema, incluidas las que no tienen ventas y las que
  ya están donde deben. Esas escrituras no cambiarían ningún valor, pero sí
  toman el candado de la fila y gastan WAL. Así solo se toca la fila que de
  verdad se mueve, y el `greatest` sobra porque la condición ya garantiza
  que el contador nunca va hacia atrás.

  La marca de abajo la lee la prueba «arranque del contador interno», que
  extrae esta sentencia del archivo y la ejecuta: así comprueba el SQL que
  se despliega y no una copia suya.
*/
-- «arranque-contador-interno» inicio
update empresas e
   set proximo_correlativo_interno = ultima.siguiente
  from (
         select v.empresa_id, max(v.correlativo) + 1 as siguiente
           from ventas v
          group by v.empresa_id
       ) as ultima
 where ultima.empresa_id = e.id
   and ultima.siguiente > e.proximo_correlativo_interno;
-- «arranque-contador-interno» fin

/*
  El reparto de correlativos aprende el tercer tipo.

  Se reescribe entera porque PostgreSQL no deja añadirle una rama a una
  función: es la misma de la 0005 con un `elsif` más. El candado sigue
  siendo el mismo —el UPDATE ... RETURNING toma el de la fila de la
  empresa— así que dos ventas internas simultáneas tampoco pueden recibir
  el mismo número.
*/
create or replace function siguiente_correlativo(p_tipo text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid := empresa_del_usuario();
  v_numero  bigint;
begin
  if v_empresa is null then
    raise exception 'El usuario no pertenece a ninguna empresa';
  end if;

  if p_tipo = 'factura' then
    update empresas
      set proximo_correlativo_factura = proximo_correlativo_factura + 1
      where id = v_empresa
      returning proximo_correlativo_factura - 1 into v_numero;

  elsif p_tipo = 'cotizacion' then
    update empresas
      set proximo_correlativo_cotizacion = proximo_correlativo_cotizacion + 1
      where id = v_empresa
      returning proximo_correlativo_cotizacion - 1 into v_numero;

  elsif p_tipo = 'interno' then
    update empresas
      set proximo_correlativo_interno = proximo_correlativo_interno + 1
      where id = v_empresa
      returning proximo_correlativo_interno - 1 into v_numero;

  else
    raise exception 'Tipo de correlativo desconocido: %', p_tipo;
  end if;

  return v_numero;
end;
$$;

-- ─────────────────────────────────────────────────────────
-- EL NÚMERO INTERNO
-- ─────────────────────────────────────────────────────────
/*
  Tiene que distinguirse de un vistazo de una factura autorizada, porque
  quien lo lee decide cosas con eso.

  Se cambia el prefijo a VTA y no se conserva FAC: «FAC» es factura, y
  llamar factura a un documento que no lo es invita exactamente a la
  confusión que esta migración viene a evitar. Son además tres formas
  distinguibles entre sí:

    000-001-01-00000009   factura autorizada (ocho dígitos, cuatro bloques)
    VTA-000009            documento interno nuevo (seis dígitos)
    FAC-00009             numeración interna anterior a esta separación

  La tercera solo existe hacia atrás: las ocho ventas que ya están. No se
  renumeran, y por eso hay tres formas y no dos.
*/
create or replace function numero_interno(p_correlativo bigint)
returns text
language sql
immutable
as $$
  select 'VTA-' || lpad(greatest(coalesce(p_correlativo, 0), 0)::text, 6, '0')
$$;

-- ─────────────────────────────────────────────────────────
-- LA VENTA RECUERDA QUÉ FUE
-- ─────────────────────────────────────────────────────────
/*
  Esta columna NO guarda ninguna invariante: lo que impide que una venta
  interna gaste el rango fiscal son las marcas de arriba y la lógica del
  RPC. Guarda un hecho.

  Se añade porque deducirlo de `cai_emision <> ''` es frágil, y ya se
  demostró: así es exactamente como InvoiceTemplate acabó imprimiendo un
  bloque «CAI» vacío en documentos que no son facturas. Una regla que
  depende de que una cadena esté vacía se rompe en cuanto alguien guarda
  un espacio.

  Y es copia y no referencia, igual que `cai_emision`, por el motivo que
  ya está escrito en ventas.js: si mañana la tienda deja de ser fiscal,
  las facturas que emitió siguen siendo facturas.

  Nace en falso, que es lo correcto para las ocho ventas anteriores: no
  llevan CAI y nunca fueron fiscales. No se les inventa nada.
*/
alter table ventas
  add column if not exists es_fiscal boolean not null default false;

-- ─────────────────────────────────────────────────────────
-- EL RPC APRENDE A DISTINGUIR
-- ─────────────────────────────────────────────────────────
/*
  Se reemplaza entero porque PostgreSQL no permite parchear el cuerpo de
  una función, pero los cambios respecto a la 0016 son cuatro y están
  marcados con «INV-3.2» en el sitio donde ocurren:

    1. rechaza una ubicación que no vende;
    2. decide si la venta es fiscal;
    3. pide el correlativo del contador que corresponde;
    4. sella los datos fiscales solo si lo es.

  Todo lo demás —derivar empresa, usuario y ubicación; el candado por
  celda en orden por producto; el rechazo por existencia; el cálculo de
  importes; la idempotencia por huella; la atomicidad— queda igual.
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
  v_fiscal       boolean;
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

  select id, nombre, tipo, activa, vende, emite_fiscal into v_ubic
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
    INV-3.2 (1): la ubicación tiene que poder vender.

    Es la regla que la 0016 dejó señalada y sin implementar porque no
    existía dónde expresarla. Ahora existe, y no se decide por tipo ni por
    nombre: se lee la marca.
  */
  if not v_ubic.vende then
    raise exception
      'La ubicación «%» no está habilitada para vender.',
      v_ubic.nombre
      using errcode = 'LV008';
  end if;

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
        'es_fiscal',      v_venta.es_fiscal,
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
  */
  select * into v_emp from empresas where id = v_empresa;

  v_tasa     := coalesce(v_emp.tasa_isv, 15);
  v_subtotal := round(v_subtotal, 2);
  v_isv      := round(v_subtotal * v_tasa / 100, 2);
  v_total    := round(v_subtotal + v_isv, 2);

  -- ── ¿factura autorizada o documento interno? ──
  /*
    INV-3.2 (2): la decisión, y no la toma quien llama.

    No hay ningún parámetro con el que pedir que una venta sea fiscal: se
    deduce de dónde sale y de si la empresa tiene la numeración autorizada
    configurada. Las dos condiciones, no una:

    - la ubicación tiene que estar marcada como emisora. Como mucho hay
      una por empresa, y nace sin marcar.

    - la configuración tiene que estar completa. Son las mismas tres
      condiciones que isFiscalConfigured() en el frontend —CAI, rango y
      fecha límite— y están aquí para que una marca puesta antes de tener
      el CAI no produzca una factura con el CAI vacío.

    Hoy, sin CAI configurado, esto da falso siempre: todas las ventas
    salen internas, incluida la de la tienda. Es lo correcto, y es también
    lo que hace que esta migración no cambie el comportamiento actual.
  */
  v_fiscal := v_ubic.emite_fiscal
          and coalesce(btrim(coalesce(v_emp.cai, '')), '') <> ''
          and coalesce(v_emp.rango_hasta, 0) > 0
          and v_emp.fecha_limite_emision is not null;

  /*
    INV-3.2 (3): cada documento pide su número a su propio contador.

    Aquí vive la invariante: una venta interna llama a
    siguiente_correlativo('interno'), que toca otra columna. No existe un
    camino por el que una venta no fiscal avance el contador autorizado,
    porque no lo nombra.

    Los dos se piden DENTRO de la transacción, así que un fallo posterior
    devuelve también el contador, igual que en la 0016.
  */
  if v_fiscal then
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
  else
    v_correlativo := siguiente_correlativo('interno');
    v_numero      := numero_interno(v_correlativo);
  end if;

  -- ── la factura ──
  /*
    INV-3.2 (4): los datos fiscales solo se sellan si la venta lo es.

    Un documento interno guarda CAI vacío y rangos nulos, que es lo que
    de verdad ocurrió. La 0016 los copiaba siempre.
  */
  insert into ventas (
    empresa_id, cliente_id, usuario_id, ubicacion_id,
    numero_factura, correlativo, es_fiscal,
    nombre_cliente, rtn_comprador,
    subtotal, isv, tasa_isv, total,
    forma_pago, fecha_vencimiento, estado,
    cai_emision, rango_desde_emision, rango_hasta_emision,
    fecha_limite_emision_emision,
    nota, clave_idempotencia
  ) values (
    v_empresa, p_cliente_id, v_usuario, v_ubicacion,
    v_numero, v_correlativo, v_fiscal,
    coalesce(nullif(btrim(coalesce(p_nombre_cliente, '')), ''), 'Consumidor Final'),
    coalesce(p_rtn_comprador, ''),
    v_subtotal, v_isv, v_tasa, v_total,
    v_forma,
    case when v_credito then p_fecha_vencimiento else null end,
    case when v_credito then 'pendiente' else 'pagada' end,
    case when v_fiscal then coalesce(v_emp.cai, '') else '' end,
    case when v_fiscal then v_emp.rango_desde else null end,
    case when v_fiscal then v_emp.rango_hasta else null end,
    case when v_fiscal then v_emp.fecha_limite_emision else null end,
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
    'es_fiscal',      v_fiscal,
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
  Se repiten porque `create or replace` sobre una función conserva sus
  privilegios, pero dejarlo escrito cuesta tres líneas y evita que un
  futuro `drop function` los pierda en silencio.
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
