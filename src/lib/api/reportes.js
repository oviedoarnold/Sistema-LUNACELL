import { supabase } from "../supabase"

/*
  El reporte diario. Todo se calcula en reporte_diario() y
  reporte_medios_de_pago(), que además comprueban que quien pregunta sea
  administrador; aquí solo viajan el día y la ubicación (null es «Todas»).
*/
export async function traerReporteDiario(dia, ubicacionId = null) {
  const argumentos = { p_dia: dia, p_ubicacion: ubicacionId }

  const [diario, medios] = await Promise.all([
    supabase.rpc("reporte_diario", argumentos),
    supabase.rpc("reporte_medios_de_pago", argumentos),
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
