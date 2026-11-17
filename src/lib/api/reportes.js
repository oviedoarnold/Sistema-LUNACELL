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
