import { supabase } from "../supabase"

import { DEFAULT_LOCATION_TYPE, isValidLocationType } from "../../utils/locations"

/*
  Acceso a las ubicaciones.

  Mismo reparto que en catalogos.js: aquí viven la traducción entre los
  nombres de la base, en español, y los que usan las pantallas, más las
  consultas. La empresa no viaja en el filtro porque la resuelven las
  políticas de la base; se envía al escribir porque la columna es
  obligatoria.
*/

export const aUbicacionDeApp = (fila) => ({
  id: fila.id,
  name: fila.nombre,
  type: fila.tipo,
  active: fila.activa,
  createdAt: fila.creada_en || "",
})

const aUbicacionDeBase = (ubicacion, empresaId) => ({
  empresa_id: empresaId,
  nombre: String(ubicacion.name || "").trim(),
  tipo: isValidLocationType(ubicacion.type)
    ? ubicacion.type
    : DEFAULT_LOCATION_TYPE,
})

function fallo(error, queHacia) {
  console.error(`No se pudo ${queHacia}:`, error)

  throw new Error(`No se pudo ${queHacia}.`)
}

/*
  23505 es la violación de unicidad, y en esta tabla solo la puede provocar
  el nombre repetido. El aviso menciona las desactivadas porque el índice
  las alcanza y, si no, el usuario ve un choque contra algo que no aparece
  en pantalla.
*/
function falloAlGuardar(error, queHacia) {
  if (error.code === "23505") {
    throw new Error(
      "Ya existe una ubicación con ese nombre. Revisa también las desactivadas."
    )
  }

  fallo(error, queHacia)
}

/*
  Trae también las desactivadas: la pantalla necesita poder volver a
  encenderlas, y esconderlas dejaría un nombre ocupado por algo invisible.
*/
export async function traerUbicaciones() {
  const { data, error } = await supabase
    .from("ubicaciones")
    .select("*")
    .order("nombre")

  if (error) fallo(error, "cargar las ubicaciones")

  return (data || []).map(aUbicacionDeApp)
}

export async function crearUbicacion(ubicacion, empresaId) {
  const { data, error } = await supabase
    .from("ubicaciones")
    .insert(aUbicacionDeBase(ubicacion, empresaId))
    .select("*")
    .single()

  if (error) falloAlGuardar(error, "crear la ubicación")

  return aUbicacionDeApp(data)
}

export async function actualizarUbicacion(id, ubicacion, empresaId) {
  const { error } = await supabase
    .from("ubicaciones")
    .update(aUbicacionDeBase(ubicacion, empresaId))
    .eq("id", id)

  if (error) falloAlGuardar(error, "actualizar la ubicación")
}

/*
  No hay borrado. Una ubicación que movió mercadería tiene que seguir
  existiendo para que su historial siga teniendo sentido, igual que un
  producto se desactiva en vez de borrarse.
*/
export async function cambiarEstadoUbicacion(id, activa) {
  const { error } = await supabase
    .from("ubicaciones")
    .update({ activa })
    .eq("id", id)

  if (error) fallo(error, "cambiar el estado de la ubicación")
}
