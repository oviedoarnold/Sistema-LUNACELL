-- Datos de demostración — Sistema Ferretería
-- Ejecutar DESPUÉS de 0001_esquema_inicial.sql
--
-- La ferretería, los clientes y las ventas son ficticios. No corresponden
-- a ningún cliente real.
--
-- Los usuarios quedan invitados por correo. Al registrarse en Supabase
-- con esa misma dirección, un trigger los vincula a la empresa.

do $$
declare
  v_empresa      uuid;
  v_admin        uuid;
  v_vendedor     uuid;
  v_prov_valle   uuid;
  v_prov_norte   uuid;
  v_cliente_sula uuid;
  v_cliente_taller uuid;
  v_cliente_josue uuid;
  v_venta        uuid;
  v_cotizacion   uuid;

  -- Quedan invitados por correo. Al registrarse en Supabase con esta
  -- misma dirección, el trigger los vincula a la empresa.
  correo_admin text := 'thebigmaza@hotmail.com';
  correo_demo  text := 'demo@oviedoarnold.lat';

  p_cemento uuid; p_martillo uuid; p_tornillo uuid; p_pintura  uuid;
  p_cable   uuid; p_cinta    uuid; p_candado  uuid; p_tubo     uuid;
begin

  /*
    Sembrar dos veces duplicaria la ferreteria entera: otra empresa, otros
    ocho productos, otras cuatro ventas. Se reconoce por el correo del
    administrador invitado, que es lo unico que esta migracion crea y que
    nada mas modifica despues.
  */
  if exists (select 1 from usuarios where email = correo_admin) then
    raise notice 'Los datos de demostración ya estaban cargados; no se hace nada.';
    return;
  end if;

  -- EMPRESA ────────────────────────────────────────────────
  insert into empresas (
    nombre, direccion, telefono, moneda, tasa_isv,
    rtn, proximo_correlativo_factura, proximo_correlativo_cotizacion, es_demo
  ) values (
    'Ferretería El Yunque',
    'Bulevar del Norte, San Pedro Sula',
    '2555-0100',
    'L', 15,
    '05019099887766', 1206, 2103, true
  ) returning id into v_empresa;

  -- USUARIOS ───────────────────────────────────────────────
  -- Quedan invitados. Al entrar con Google o con correo, el trigger
  -- los vincula por su dirección.
  insert into usuarios (empresa_id, email, nombre, rol)
  values (v_empresa, correo_admin, 'Administrador', 'admin')
  returning id into v_admin;

  insert into usuarios (empresa_id, email, nombre, rol)
  values (v_empresa, correo_demo, 'Vendedor de mostrador', 'vendedor')
  returning id into v_vendedor;

  insert into permisos_usuario (usuario_id, empresa_id, seccion)
  select v_admin, v_empresa, unnest(array[
    'dashboard','pos','quotes','products','clients','suppliers','sales-history','settings'
  ]);

  -- A propósito sin inventario, proveedores ni configuración: así se ve
  -- el control de permisos funcionando.
  insert into permisos_usuario (usuario_id, empresa_id, seccion)
  select v_vendedor, v_empresa, unnest(array[
    'dashboard','pos','quotes','clients','sales-history'
  ]);

  -- PROVEEDORES ────────────────────────────────────────────
  insert into proveedores (empresa_id, nombre, contacto, telefono, email, notas)
  values (v_empresa, 'Distribuidora Ferretera del Valle', 'Carlos Mejía',
          '2550-1234', 'ventas@dfvalle.hn', 'Cemento, varilla y block')
  returning id into v_prov_valle;

  insert into proveedores (empresa_id, nombre, contacto, telefono, email, notas)
  values (v_empresa, 'Pinturas del Norte', 'Ana López',
          '2558-7788', '', 'Pinturas y accesorios')
  returning id into v_prov_norte;

  -- CLIENTES ───────────────────────────────────────────────
  insert into clientes (empresa_id, nombre, rtn, telefono, direccion, email)
  values (v_empresa, 'Constructora Sula', '05019012345678', '9988-1122',
          'Col. Trejo, San Pedro Sula', 'compras@csula.hn')
  returning id into v_cliente_sula;

  insert into clientes (empresa_id, nombre, rtn, telefono, direccion, email)
  values (v_empresa, 'Taller Mecánico Rivera', '05019087654321', '9877-3344',
          'Barrio Guamilito', '')
  returning id into v_cliente_taller;

  insert into clientes (empresa_id, nombre, rtn, telefono, direccion, email)
  values (v_empresa, 'Josué Andino', '', '9755-6677', 'Col. Fesitranh', '')
  returning id into v_cliente_josue;

  -- PRODUCTOS ──────────────────────────────────────────────
  insert into productos (empresa_id, proveedor_id, codigo, nombre, categoria, precio, costo, stock_minimo)
  values (v_empresa, v_prov_valle, 'CEM-001', 'Cemento gris 42.5 kg', 'Construcción', 245, 198, 15)
  returning id into p_cemento;

  insert into productos (empresa_id, codigo, nombre, categoria, precio, costo, stock_minimo)
  values (v_empresa, 'HER-001', 'Martillo de uña 16 oz', 'Herramientas', 185, 120, 6)
  returning id into p_martillo;

  insert into productos (empresa_id, codigo, nombre, categoria, precio, costo, stock_minimo)
  values (v_empresa, 'TOR-001', 'Tornillo para madera 1" (caja 100 u)', 'Tornillería', 42, 26, 10)
  returning id into p_tornillo;

  insert into productos (empresa_id, proveedor_id, codigo, nombre, categoria, precio, costo, stock_minimo)
  values (v_empresa, v_prov_norte, 'PIN-001', 'Pintura acrílica blanca 1 galón', 'Pinturas', 385, 280, 5)
  returning id into p_pintura;

  insert into productos (empresa_id, codigo, nombre, categoria, precio, costo, stock_minimo)
  values (v_empresa, 'ELE-001', 'Cable THHN #12 (rollo 100 m)', 'Eléctrico', 1150, 890, 4)
  returning id into p_cable;

  insert into productos (empresa_id, codigo, nombre, categoria, precio, costo, stock_minimo)
  values (v_empresa, 'HER-002', 'Cinta métrica 5 m', 'Herramientas', 78, 45, 8)
  returning id into p_cinta;

  insert into productos (empresa_id, codigo, nombre, categoria, precio, costo, stock_minimo)
  values (v_empresa, 'CER-001', 'Candado de bronce 40 mm', 'Cerrajería', 145, 92, 5)
  returning id into p_candado;

  insert into productos (empresa_id, proveedor_id, codigo, nombre, categoria, precio, costo, stock_minimo)
  values (v_empresa, v_prov_valle, 'PLO-001', 'Tubo PVC 1/2" x 6 m', 'Plomería', 96, 61, 12)
  returning id into p_tubo;

  -- EXISTENCIAS INICIALES ──────────────────────────────────
  -- El stock no es una columna: entra como movimiento para que quede
  -- rastro desde el primer día.
  insert into movimientos_inventario (empresa_id, producto_id, usuario_id, tipo, cantidad, motivo)
  values
    (v_empresa, p_cemento,  v_admin, 'entrada', 100, 'Inventario inicial'),
    (v_empresa, p_martillo, v_admin, 'entrada',  25, 'Inventario inicial'),
    (v_empresa, p_tornillo, v_admin, 'entrada',   4, 'Inventario inicial'),
    (v_empresa, p_pintura,  v_admin, 'entrada',  22, 'Inventario inicial'),
    (v_empresa, p_cable,    v_admin, 'entrada',   6, 'Inventario inicial'),
    (v_empresa, p_cinta,    v_admin, 'entrada',  35, 'Inventario inicial'),
    (v_empresa, p_candado,  v_admin, 'entrada',  12, 'Inventario inicial'),
    (v_empresa, p_tubo,     v_admin, 'entrada',  57, 'Inventario inicial');

  -- El cable queda agotado y el tornillo bajo: así el panel muestra
  -- ambas alertas desde el arranque.
  insert into movimientos_inventario (empresa_id, producto_id, usuario_id, tipo, cantidad, motivo)
  values (v_empresa, p_cable, v_admin, 'salida', -6, 'Venta mostrador anterior');

  -- VENTA 1 · contado, hoy ─────────────────────────────────
  insert into ventas (empresa_id, usuario_id, numero_factura, correlativo, fecha,
                      nombre_cliente, subtotal, isv, tasa_isv, total, forma_pago, estado)
  values (v_empresa, v_vendedor, 'FAC-01201', 1201, now(),
          'Consumidor Final', 341.00, 51.15, 15, 392.15, 'contado', 'pagada')
  returning id into v_venta;

  insert into detalle_venta (empresa_id, venta_id, producto_id, nombre, codigo, cantidad, precio, subtotal)
  values
    (v_empresa, v_venta, p_martillo, 'Martillo de uña 16 oz', 'HER-001', 1, 185, 185),
    (v_empresa, v_venta, p_cinta,    'Cinta métrica 5 m',     'HER-002', 2,  78, 156);

  insert into movimientos_inventario (empresa_id, producto_id, usuario_id, venta_id, tipo, cantidad, motivo)
  values
    (v_empresa, p_martillo, v_vendedor, v_venta, 'salida', -1, 'FAC-01201'),
    (v_empresa, p_cinta,    v_vendedor, v_venta, 'salida', -2, 'FAC-01201');

  -- VENTA 2 · contado, hoy ─────────────────────────────────
  insert into ventas (empresa_id, cliente_id, usuario_id, numero_factura, correlativo, fecha,
                      nombre_cliente, subtotal, isv, tasa_isv, total, forma_pago, estado)
  values (v_empresa, v_cliente_josue, v_vendedor, 'FAC-01202', 1202, now(),
          'Josué Andino', 435.00, 65.25, 15, 500.25, 'contado', 'pagada')
  returning id into v_venta;

  insert into detalle_venta (empresa_id, venta_id, producto_id, nombre, codigo, cantidad, precio, subtotal)
  values (v_empresa, v_venta, p_candado, 'Candado de bronce 40 mm', 'CER-001', 3, 145, 435);

  insert into movimientos_inventario (empresa_id, producto_id, usuario_id, venta_id, tipo, cantidad, motivo)
  values (v_empresa, p_candado, v_vendedor, v_venta, 'salida', -3, 'FAC-01202');

  -- VENTA 3 · crédito con abono parcial ────────────────────
  insert into ventas (empresa_id, cliente_id, usuario_id, numero_factura, correlativo, fecha,
                      nombre_cliente, rtn_comprador, subtotal, isv, tasa_isv, total,
                      forma_pago, fecha_vencimiento, estado)
  values (v_empresa, v_cliente_sula, v_vendedor, 'FAC-01203', 1203, now() - interval '3 days',
          'Constructora Sula', '05019012345678', 10952.00, 1642.80, 15, 12594.80,
          'credito', (current_date + 27), 'pendiente')
  returning id into v_venta;

  insert into detalle_venta (empresa_id, venta_id, producto_id, nombre, codigo, cantidad, precio, subtotal)
  values
    (v_empresa, v_venta, p_cemento, 'Cemento gris 42.5 kg', 'CEM-001', 40, 245, 9800),
    (v_empresa, v_venta, p_tubo,    'Tubo PVC 1/2" x 6 m',  'PLO-001', 12,  96, 1152);

  insert into abonos (empresa_id, venta_id, usuario_id, monto, fecha, nota)
  values (v_empresa, v_venta, v_vendedor, 4000, now() - interval '1 day', 'Efectivo');

  insert into movimientos_inventario (empresa_id, producto_id, usuario_id, venta_id, tipo, cantidad, motivo)
  values
    (v_empresa, p_cemento, v_vendedor, v_venta, 'salida', -40, 'FAC-01203'),
    (v_empresa, p_tubo,    v_vendedor, v_venta, 'salida', -12, 'FAC-01203');

  -- VENTA 4 · crédito vencido ──────────────────────────────
  insert into ventas (empresa_id, cliente_id, usuario_id, numero_factura, correlativo, fecha,
                      nombre_cliente, subtotal, isv, tasa_isv, total,
                      forma_pago, fecha_vencimiento, estado)
  values (v_empresa, v_cliente_taller, v_vendedor, 'FAC-01204', 1204, now() - interval '40 days',
          'Taller Mecánico Rivera', 1540.00, 231.00, 15, 1771.00,
          'credito', (current_date - 10), 'pendiente')
  returning id into v_venta;

  insert into detalle_venta (empresa_id, venta_id, producto_id, nombre, codigo, cantidad, precio, subtotal)
  values (v_empresa, v_venta, p_pintura, 'Pintura acrílica blanca 1 galón', 'PIN-001', 4, 385, 1540);

  insert into movimientos_inventario (empresa_id, producto_id, usuario_id, venta_id, tipo, cantidad, motivo)
  values (v_empresa, p_pintura, v_vendedor, v_venta, 'salida', -4, 'FAC-01204');

  -- COTIZACIONES ───────────────────────────────────────────
  insert into cotizaciones (empresa_id, cliente_id, usuario_id, numero, correlativo,
                            valida_hasta, nombre_cliente, rtn_cliente,
                            incluye_isv, subtotal, isv, tasa_isv, total)
  values (v_empresa, v_cliente_sula, v_vendedor, 'COT-02101', 2101,
          (current_date + 12), 'Constructora Sula', '05019012345678',
          true, 6125.00, 918.75, 15, 7043.75)
  returning id into v_cotizacion;

  insert into detalle_cotizacion (empresa_id, cotizacion_id, producto_id, nombre, codigo, cantidad, precio, subtotal)
  values (v_empresa, v_cotizacion, p_cemento, 'Cemento gris 42.5 kg', 'CEM-001', 25, 245, 6125);

  -- Vencida, para que se vea el estado en la lista.
  insert into cotizaciones (empresa_id, cliente_id, usuario_id, numero, correlativo,
                            valida_hasta, nombre_cliente,
                            incluye_isv, subtotal, isv, tasa_isv, total)
  values (v_empresa, v_cliente_taller, v_vendedor, 'COT-02102', 2102,
          (current_date - 4), 'Taller Mecánico Rivera',
          true, 2310.00, 346.50, 15, 2656.50)
  returning id into v_cotizacion;

  insert into detalle_cotizacion (empresa_id, cotizacion_id, producto_id, nombre, codigo, cantidad, precio, subtotal)
  values (v_empresa, v_cotizacion, p_pintura, 'Pintura acrílica blanca 1 galón', 'PIN-001', 6, 385, 2310);

  raise notice 'Datos demo cargados. Empresa: %', v_empresa;
  raise notice 'Administrador invitado: %', correo_admin;
  raise notice 'Vendedor demo invitado: %', correo_demo;
end $$;
