/*
  Un reporte como el que devuelve reporte_diario(), para las pruebas de la
  pantalla y de las exportaciones. Datos inventados.
*/
export const REPORTE = {
  dia: "2026-03-10",
  ubicacion_id: null,
  empresa: "Ferretería de prueba",
  moneda: "L",
  indicadores: {
    ventas_total: 345.1,
    ventas_cantidad: 2,
    ticket_promedio: 172.55,
    contado_total: 115,
    contado_cantidad: 1,
    credito_total: 230.1,
    credito_cantidad: 1,
    abonos_total: 50,
    abonos_cantidad: 1,
    cobros_total: 165,
    anuladas_total: 80,
    anuladas_cantidad: 1,
    reembolsos_pendientes: 80,
    por_conciliar: 1,
  },
  por_ubicacion: [
    {
      ubicacion_id: "camion-1", ubicacion: "Camión 01", ventas_total: 345.1, ventas_cantidad: 2, ticket_promedio: 172.55,
      contado_total: 115, credito_total: 230.1, abonos_total: 50, cobros_total: 165, anuladas_total: 80,
    },
    {
      ubicacion_id: null, ubicacion: "Sin ubicación", ventas_total: 0, ventas_cantidad: 0, ticket_promedio: 0,
      contado_total: 0, credito_total: 0, abonos_total: 0, cobros_total: 0, anuladas_total: 0,
    },
  ],
  por_vendedor: [
    {
      usuario_id: "u-1", vendedor: "Chofer Uno", ventas_total: 345.1, ventas_cantidad: 2, ticket_promedio: 172.55,
      contado_total: 115, credito_total: 230.1, abonos_total: 50,
    },
  ],
  ventas: [
    {
      id: "v-1", fecha: "2026-03-11T05:59:00.000Z", numero: "INT-00001", ubicacion: "Camión 01", vendedor: "Chofer Uno",
      cliente: "=SUMA(A1), \"Ferremax\"", forma_pago: "contado", total: 115, estado: "pagada", origen: "sin_conexion",
      productos: [{ nombre: "Cargador", codigo: "C-1", cantidad: 1 }, { nombre: "Cubo", codigo: "C-2", cantidad: 2 }],
    },
    {
      id: "v-2", fecha: "2026-03-10T18:00:00.000Z", numero: "INT-00002", ubicacion: "Camión 01", vendedor: "Chofer Uno",
      cliente: "Consumidor Final", forma_pago: "contado", total: 80, estado: "anulada", origen: "en_linea",
      productos: [{ nombre: "Cargador", codigo: "C-1", cantidad: 1 }],
    },
  ],
  abonos: [
    {
      id: "a-1", fecha: "2026-03-10T20:00:00.000Z", numero: "INT-00000", fecha_venta: "2026-02-01T18:00:00.000Z",
      ubicacion: "Camión 01", cobrador: "Chofer Uno", cliente: "Ferremax", monto: 50,
    },
  ],
  anulaciones: [
    {
      id: "an-1", fecha: "2026-03-10T21:00:00.000Z", numero: "INT-00002", fecha_venta: "2026-03-10T18:00:00.000Z",
      ubicacion: "Camión 01", anulada_por: "Administradora", cliente: "Consumidor Final", forma_pago: "contado",
      total: 80, tratamiento_dinero: "reembolso_pendiente", motivo: "Error al registrar la venta",
    },
  ],
  movimientos_resumen: [
    { clase: "traslado_salida", movimientos: 1, unidades: -3 },
    { clase: "venta", movimientos: 2, unidades: -4 },
  ],
  movimientos: [
    {
      id: 1, fecha: "2026-03-10T18:00:00.000Z", clase: "venta", codigo: "C-1", producto: "Cargador", cantidad: -1,
      ubicacion: "Camión 01", usuario: "Chofer Uno", documento: "INT-00001", origen: null, destino: null, motivo: "Venta",
    },
    {
      id: 2, fecha: "2026-03-10T19:00:00.000Z", clase: "traslado_salida", codigo: "C-1", producto: "Cargador", cantidad: -3,
      ubicacion: "Camión 01", usuario: "Administradora", documento: null, origen: "Camión 01", destino: "Camión 02", motivo: "",
    },
  ],
}

REPORTE.medios = {
  totales: { total: 165, registrado: 115, sin_registrar: 50, comision: 7, neto: 158, comision_de_anuladas: 5.6 },
  por_medio: [
    { medio: "efectivo", operaciones: 1, monto: 15, comision: 0, neto: 15 },
    { medio: "tarjeta", operaciones: 1, monto: 100, comision: 7, neto: 93 },
    { medio: "sin_registrar", operaciones: 1, monto: 50, comision: 0, neto: 50 },
  ],
  por_ubicacion: [
    { ubicacion_id: "camion-1", ubicacion: "Camión 01", efectivo: 15, transferencia: 0, tarjeta: 100, enlace: 0, sin_registrar: 50, total: 165, comision: 7 },
  ],
  por_venta: {
    "v-1": [{ medio: "efectivo", monto: 15, referencia: "" }, { medio: "tarjeta", monto: 100, referencia: "AUT-9" }],
    "v-2": [{ medio: "tarjeta", monto: 80, referencia: "AUT-8" }],
  },
  por_abono: {},
  por_anulacion: { "an-1": [{ medio: "tarjeta", monto: 80, referencia: "AUT-8" }] },
}

export const REPORTE_VACIO = {
  ...REPORTE,
  medios: {
    totales: { total: 0, registrado: 0, sin_registrar: 0, comision: 0, neto: 0, comision_de_anuladas: 0 },
    por_medio: [], por_ubicacion: [], por_venta: {}, por_abono: {}, por_anulacion: {},
  },
  indicadores: Object.fromEntries(Object.keys(REPORTE.indicadores).map((k) => [k, 0])),
  por_ubicacion: [],
  por_vendedor: [],
  ventas: [],
  abonos: [],
  anulaciones: [],
  movimientos_resumen: [],
  movimientos: [],
}
