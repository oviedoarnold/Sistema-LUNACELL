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
  // Solo la cambia un administrador (0027) y solo en camiones y bodegas (0030).
  offline: fila.vende_sin_conexion === true,
  createdAt: fila.creada_en || "",
})

const aUbicacionDeBase = (ubicacion, empresaId) => ({
  empresa_id: empresaId,
  nombre: String(ubicacion.name || "").trim(),
  tipo: isValidLocationType(ubicacion.type)
    ? ubicacion.type
    : DEFAULT_LOCATION_TYPE,
})

/*
  Cuando la base levanta la mano a propósito, lo que dice sirve.

  PostgreSQL devuelve P0001 —`raise_exception`— únicamente cuando una
  función o un disparador ejecutan un RAISE EXCEPTION. Eso no es un fallo
  interno que se escapó: es un texto que alguien escribió para que lo lea
  una persona, y normalmente dice qué hacer a continuación.

  El ejemplo que motivó esto: al intentar desactivar una ubicación desde la
  que alguien opera, la base contesta «No se puede desactivar «Camión 01»:
  es la ubicación operativa de 1 usuario(s). Cámbiales la ubicación antes.»
  El administrador veía «No se pudo cambiar el estado de la ubicación.» y se
  quedaba sin saber que le faltaba reasignar al vendedor.

  Se distingue por el código y no por el texto. Un error cualquiera del
  motor no se muestra: 23505 dice «duplicate key value violates unique
  constraint "ubicaciones_nombre_unico"», que no es una frase para nadie
  —de ahí que falloAlGuardar la traduzca aparte— y además enseña el nombre
  de un índice. Comparar cadenas sería peor todavía: se rompe en cuanto
  alguien corrige una tilde en el mensaje de la migración.
*/
function mensajeParaElUsuario(error) {
  return error?.code === "P0001" ? String(error.message || "").trim() : ""
}

/*
  42501 es la base diciendo que falta permiso: `locations`, o ser
  administrador para decidir si una ubicación vende o es fiscal (SEC-3a).
*/
function fallo(error, queHacia) {
  console.error(`No se pudo ${queHacia}:`, error)

  if (error?.code === "42501") {
    throw new Error(`No tienes permiso para ${queHacia}.`)
  }

  throw new Error(mensajeParaElUsuario(error) || `No se pudo ${queHacia}.`)
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
  Lo que dice la base al rechazar un cambio de la marca de ventas sin
  conexión. 23514 es una restricción CHECK, y en esta tabla hay dos que la
  tocan: la de 0030 (solo camiones y bodegas) y la de 0027 (nunca una
  ubicación fiscal). Se distinguen por el nombre de la restricción, que es
  un identificador estable, no una frase.
*/
const RESTRICCIONES_SIN_CONEXION = {
  ubicaciones_sin_conexion_solo_camion_o_bodega: "Solo los camiones y las bodegas pueden vender sin conexión.",
  ubicaciones_sin_conexion_no_fiscal: "Una ubicación que emite factura fiscal no puede vender sin conexión.",
}

function falloAlCambiarSinConexion(error) {
  if (error.code === "42501") {
    console.error("No se pudo cambiar la venta sin conexión:", error)
    throw new Error("Solo un administrador puede cambiar si una ubicación vende sin conexión.")
  }

  if (error.code === "23514") {
    const restriccion = Object.keys(RESTRICCIONES_SIN_CONEXION).find((nombre) =>
      String(error.message || "").includes(nombre)
    )

    if (restriccion) {
      console.error("No se pudo cambiar la venta sin conexión:", error)
      throw new Error(RESTRICCIONES_SIN_CONEXION[restriccion])
    }
  }

  falloAlGuardar(error, "actualizar la ubicación")
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

/*
  `anterior` es la ubicación como estaba al abrir el formulario. Solo con
  ella se envía la marca de ventas sin conexión, y solo si cambió: así una
  edición del nombre nunca la toca, y quien no es administrador no dispara
  el rechazo de la base por un valor que ni siquiera cambió.

  Cuando la marca cambia, la escritura exige que la ubicación siga como se
  vio (marca, tipo y estado). Si otro administrador la cambió entretanto,
  no se guarda una decisión tomada sobre datos viejos.
*/
export async function actualizarUbicacion(id, ubicacion, empresaId, anterior = null) {
  const cambiaSinConexion = Boolean(anterior) && Boolean(ubicacion.offline) !== Boolean(anterior.offline)

  if (!cambiaSinConexion) {
    const { error } = await supabase
      .from("ubicaciones")
      .update(aUbicacionDeBase(ubicacion, empresaId))
      .eq("id", id)

    if (error) falloAlGuardar(error, "actualizar la ubicación")
    return
  }

  const { data, error } = await supabase
    .from("ubicaciones")
    .update({ ...aUbicacionDeBase(ubicacion, empresaId), vende_sin_conexion: Boolean(ubicacion.offline) })
    .eq("id", id)
    .eq("vende_sin_conexion", Boolean(anterior.offline))
    .eq("tipo", anterior.type)
    .eq("activa", anterior.active !== false)
    .select("id")

  if (error) falloAlCambiarSinConexion(error)

  if (!data?.length) {
    throw new Error("La ubicación cambió mientras la editabas. Cierra el formulario y vuelve a abrirla.")
  }
}

/*
  Lo que el servidor sabe de las ventas sin conexión de una ubicación, para
  el aviso antes de desactivarlas. Solo lectura.

  No dice si quedan ventas en los teléfonos: eso el servidor no lo sabe.
  Por eso, si una consulta falla, lanza en vez de devolver ceros: un cero
  sin comprobar haría creer que no hay nada pendiente.
*/
export async function resumenParaDesactivarSinConexion(ubicacionId, { ahora = new Date() } = {}) {
  const haceSieteDias = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [porConciliar, ultima, recientes, asignados] = await Promise.all([
    supabase.from("ventas_por_conciliar").select("id").eq("ubicacion_id", ubicacionId).eq("estado", "pendiente"),
    supabase
      .from("ventas")
      .select("recibida_en")
      .eq("ubicacion_id", ubicacionId)
      .eq("origen", "sin_conexion")
      .order("recibida_en", { ascending: false })
      .limit(1),
    supabase
      .from("ventas")
      .select("dispositivo")
      .eq("ubicacion_id", ubicacionId)
      .eq("origen", "sin_conexion")
      .gte("recibida_en", haceSieteDias),
    supabase.from("usuarios").select("id").eq("ubicacion_id", ubicacionId).eq("activo", true),
  ])

  const conError = [porConciliar, ultima, recientes, asignados].find((r) => r.error)

  if (conError) {
    console.error("No se pudo preparar el aviso de ventas sin conexión:", conError.error)
    throw new Error("No se pudo comprobar el estado de las ventas sin conexión de esta ubicación.")
  }

  return {
    porConciliar: porConciliar.data.length,
    ultimaRecibida: ultima.data[0]?.recibida_en || null,
    telefonosUltimos7Dias: new Set(recientes.data.map((v) => v.dispositivo).filter(Boolean)).size,
    usuariosAsignados: asignados.data.length,
  }
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
