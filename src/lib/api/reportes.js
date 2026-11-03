import { supabase } from "../supabase"

/*
  El reporte diario. Todo se calcula en reporte_diario(), que además
  comprueba que quien pregunta sea administrador; aquí solo viajan el día y
  la ubicación (null es «Todas»).
*/
export async function traerReporteDiario(dia, ubicacionId = null) {
  const { data, error } = await supabase.rpc("reporte_diario", {
    p_dia: dia,
    p_ubicacion: ubicacionId,
  })

  if (error) {
    console.error("No se pudo cargar el reporte:", error)

    throw new Error(
      error.code === "42501"
        ? "El reporte diario es solo para administradores."
        : "No se pudo cargar el reporte."
    )
  }

  return data
}
