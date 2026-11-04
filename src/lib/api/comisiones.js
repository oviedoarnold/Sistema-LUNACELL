import { supabase } from "../supabase"

/*
  Las tasas de comisión del proveedor de pagos, que solo ve el administrador.
  Cambiar una agrega una fila: lo ya cobrado conserva la tasa que tenía.
*/
export async function traerTasasDeComision() {
  const { data, error } = await supabase
    .from("tasas_de_comision")
    .select("medio, tasa, vigente_desde")
    .order("vigente_desde", { ascending: false })

  if (error) {
    console.error("No se pudieron cargar las tasas de comisión:", error)

    throw new Error("No se pudieron cargar las tasas de comisión.")
  }

  // La más reciente de cada medio.
  const vigentes = {}

  for (const fila of data || []) {
    vigentes[fila.medio] ??= Number(fila.tasa)
  }

  return vigentes
}

export async function configurarTasaDeComision(medio, tasa) {
  const { error } = await supabase.rpc("configurar_tasa_de_comision", { p_medio: medio, p_tasa: tasa })

  if (error) {
    console.error("No se pudo cambiar la tasa de comisión:", error)

    throw new Error(error.code === "LM006" ? error.message : "No se pudo cambiar la tasa de comisión.")
  }
}
