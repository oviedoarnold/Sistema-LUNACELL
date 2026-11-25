import { supabase } from "../supabase"

/*
  El reporte diario. Todo se calcula en la base, que además comprueba que
  quien pregunta sea administrador; aquí solo viajan el día y la ubicación
  (null es «Todas»).

  Desde la 0046 se piden las versiones «de caja»: parten de reporte_diario()
  y reporte_medios_de_pago() y solo corrigen lo que es de pedidos. El cobro
  cuenta para la ubicación que recibió el dinero, el día del cobro y con su
  medio; la venta sigue siendo de quien factura. Las ventas normales quedan
  exactamente igual.
*/
export async function traerReporteDiario(dia, ubicacionId = null) {
  const argumentos = { p_dia: dia, p_ubicacion: ubicacionId }

  const [diario, medios] = await Promise.all([
    supabase.rpc("reporte_diario_de_caja", argumentos),
    supabase.rpc("reporte_medios_de_caja", argumentos),
  ])

  const error = diario.error || medios.error

  if (error) {
    console.error("No se pudo cargar el reporte:", error)

    throw new Error(
      error.code === "42501"
        ? "El reporte diario es solo para administradores."
        : "No se pudo cargar el reporte."
    )
  }

  return { ...diario.data, medios: medios.data }
}

/*
  Las regalías entregadas entre dos días (0054). La base decide quién ve qué:
  el administrador toda la empresa con el costo; el contador con «Historial»
  todas las ubicaciones, sin costo; el vendedor con «Historial», su ubicación.
*/
export async function traerReporteDeRegalias(desde, hasta, ubicacionId = null) {
  const { data, error } = await supabase.rpc("reporte_de_regalias", {
    p_desde: desde,
    p_hasta: hasta,
    p_ubicacion: ubicacionId,
  })

  if (error) {
    console.error("No se pudo cargar el reporte de regalías:", error)

    throw new Error(
      error.code === "42501"
        ? "Para consultar las regalías necesitas «Historial de facturas»."
        : error.code === "RG001"
          ? error.message
          : "No se pudo cargar el reporte de regalías."
    )
  }

  return (data || []).map((fila) => ({
    id: fila.regalia_id,
    fecha: fila.fecha,
    ventaId: fila.venta_id,
    factura: fila.numero_factura,
    estadoFactura: fila.estado_factura,
    cliente: fila.cliente,
    producto: fila.producto,
    codigo: fila.codigo || "",
    cantidad: Number(fila.cantidad),
    ubicacion: fila.ubicacion || "",
    usuario: fila.usuario || "",
    motivo: fila.motivo,
    detalleMotivo: fila.detalle_motivo || "",
    costoUnitario: fila.costo_unitario === null || fila.costo_unitario === undefined ? null : Number(fila.costo_unitario),
    costoTotal: fila.costo_total === null || fila.costo_total === undefined ? null : Number(fila.costo_total),
  }))
}
