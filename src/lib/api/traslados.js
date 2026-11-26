import { supabase } from "../supabase"

/*
  Traslados de existencia entre ubicaciones.

  Desde la 0056, en dos tiempos. Enviar es UNA llamada a
  registrar_traslado(): descuenta el origen, anota la salida y deja el
  traslado pendiente. Recibir es confirmar_recepcion_traslado(): suma al
  destino y anota la entrada, con quién recibió y cuándo. Si lo recibido no
  coincide, reportar_incidencia_traslado() lo deja con incidencia. El
  navegador solo dice qué traslado y, si hace falta, la observación:
  empresa, usuario, permisos y existencias los decide la base, y las
  tablas de traslados no se escriben desde aquí.
*/

function fallo(error, queHacia) {
  console.error(`No se pudo ${queHacia}:`, error)

  throw new Error(`No se pudo ${queHacia}.`)
}

/*
  Los códigos con los que registrar_traslado() distingue sus rechazos,
  traducidos para que la pantalla no tenga que leer SQLSTATE.
*/
const MOTIVOS_DE_TRASLADO = {
  LT001: "mismo-origen-destino",
  LT002: "ubicacion-inactiva",
  LT003: "traslado-invalido",
  LT004: "producto-invalido",
  LT005: "existencia-insuficiente",
  LT006: "clave-reusada",
  // Recepción (0056). El mensaje de la base dice qué hacer.
  LT010: "traslado-no-encontrado",
  LT011: "estado-no-admite",
  LT012: "destino-inactivo",
  LT013: "falta-observacion",
  LT014: "contenido-cambiado",
  LT015: "incidencia-repetida",
  LT016: "incidencia-invalida",
  42501: "sin-permiso",
}

export class ErrorDeTraslado extends Error {
  constructor(mensaje, motivo, codigo) {
    super(mensaje)

    this.name = "ErrorDeTraslado"
    this.motivo = motivo
    this.codigo = codigo
  }
}

/*
  Registra el traslado y devuelve su id.

  La clave identifica el intento: si la respuesta se pierde y se reintenta
  con la misma, la base devuelve el traslado que ya existía en vez de
  mover la mercadería dos veces.
*/
export async function registrarTraslado(
  { origenId, destinoId, items = [], nota = "" },
  { clave = null } = {}
) {
  const { data, error } = await supabase.rpc("registrar_traslado", {
    p_origen: origenId,
    p_destino: destinoId,
    p_items: items.map((item) => ({
      producto_id: item.productId,
      cantidad: Number(item.qty),
    })),
    p_nota: nota,
    p_clave_idempotencia: clave,
  })

  /*
    Los rechazos de negocio llevan el mensaje del motor, que ya dice qué
    hacer: cuánto hay y en qué ubicación, o que el origen no es el suyo.
  */
  if (error) rechazoDeTraslado(error, "registrar el traslado")

  return data.traslado_id
}

/*
  Un rechazo de negocio con el mensaje del motor; cualquier otro, genérico.
*/
function rechazoDeTraslado(error, queHacia) {
  const motivo = MOTIVOS_DE_TRASLADO[error.code]

  if (motivo) throw new ErrorDeTraslado(error.message, motivo, error.code)

  fallo(error, queHacia)
}

/*
  Confirma la recepción física de un traslado pendiente. La observación
  solo la pide la base en una confirmación administrativa. Reintentar es
  seguro: si ya estaba recibido responde lo mismo, sin volver a sumar.
*/
export async function confirmarRecepcion(trasladoId, observacion = null) {
  const { data, error } = await supabase.rpc("confirmar_recepcion_traslado", {
    p_traslado: trasladoId,
    p_observacion: observacion,
  })

  if (error) rechazoDeTraslado(error, "confirmar la recepción")

  return data
}

// Reporta la única incidencia del traslado; no suma ni resta nada.
export async function reportarIncidencia(trasladoId, nota) {
  const { data, error } = await supabase.rpc("reportar_incidencia_traslado", {
    p_traslado: trasladoId,
    p_nota: nota,
  })

  if (error) rechazoDeTraslado(error, "reportar la incidencia")

  return data
}

const COLUMNAS = `
  id, numero, origen_id, destino_id, usuario_id, estado, nota, creado_en, unidades,
  recibido_por, recibido_por_nombre, recibido_en, confirmacion_administrativa, observacion_recepcion,
  incidencia, incidencia_por_nombre, incidencia_en,
  traslado_detalle (*)
`

/*
  Quién hizo cada traslado, en UNA llamada por página. No sale de la tabla
  usuarios: su política deja a un vendedor ver solo su propia fila, y
  abrirla expondría correo, rol y el resto. nombres_de_usuarios() (0022)
  entrega solo id y nombre de los pedidos, y solo de la propia empresa.
  Si falla, el historial se muestra igual y el nombre queda vacío.
*/
async function nombresDeUsuarios(filas) {
  const ids = [...new Set(filas.map((f) => f.usuario_id).filter(Boolean))]

  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.rpc("nombres_de_usuarios", { p_ids: ids })

  if (error) return new Map()

  return new Map((data || []).map((u) => [u.id, u.nombre]))
}

/*
  Cómo se llama cada producto de los traslados, en UNA consulta por carga
  del historial. No sale del catálogo de la pantalla porque ese solo trae
  los activos, y un traslado de un producto que después se desactivó
  quedaba como "Producto". La política de productos deja leer los de la
  propia empresa, activos o no; si aun así falla, el historial se muestra
  igual y el nombre queda vacío.
*/
async function nombresDeProductos(filas) {
  const ids = [
    ...new Set(filas.flatMap((f) => (f.traslado_detalle || []).map((d) => d.producto_id))),
  ]

  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from("productos").select("id, nombre, codigo").in("id", ids)

  if (error) return new Map()

  return new Map((data || []).map((p) => [p.id, { nombre: p.nombre, codigo: p.codigo || "" }]))
}

// El producto puede llegar como nombre suelto o como { nombre, codigo }.
const datosDelProducto = (valor) => (typeof valor === "string" ? { nombre: valor, codigo: "" } : valor || { nombre: "", codigo: "" })

export const aTrasladoDeApp = (fila, nombres = new Map(), productos = new Map()) => ({
  id: fila.id,
  // TR-000001: lo da la base al registrar el traslado (0053).
  numero: fila.numero || "",
  originId: fila.origen_id,
  destinationId: fila.destino_id,
  userId: fila.usuario_id,
  userName: nombres.get(fila.usuario_id) || "",
  status: fila.estado,
  note: fila.nota || "",
  isoDate: fila.creado_en,
  timestamp: new Date(fila.creado_en).getTime(),
  items: (fila.traslado_detalle || []).map((d) => ({
    productId: d.producto_id,
    productName: datosDelProducto(productos.get(d.producto_id)).nombre,
    productCode: datosDelProducto(productos.get(d.producto_id)).codigo,
    qty: Number(d.cantidad),
  })),
  // Recepción (0056). Un traslado «aplicado» es de antes del control: no tiene.
  units: fila.unidades ?? (fila.traslado_detalle || []).reduce((suma, d) => suma + Number(d.cantidad), 0),
  receivedById: fila.recibido_por || null,
  receivedBy: fila.recibido_por_nombre || "",
  receivedAt: fila.recibido_en || null,
  administrative: Boolean(fila.confirmacion_administrativa),
  receptionNote: fila.observacion_recepcion || "",
  incident: fila.incidencia || "",
  incidentBy: fila.incidencia_por_nombre || "",
  incidentAt: fila.incidencia_en || null,
})

// Los estados que esperan una recepción.
export const ESTADOS_POR_RECIBIR = ["pendiente", "con_incidencia"]

/*
  Los traslados que este usuario puede recibir, del más antiguo al más
  reciente. El administrador, todos los de su empresa; los demás, los que
  van a su ubicación operativa y no envió él. La base lo vuelve a comprobar
  al confirmar: esto solo decide qué se le muestra.
*/
export async function traerPorRecibir({ esAdmin = false, ubicacionId = "", usuarioId = "" } = {}) {
  if (!esAdmin && (!ubicacionId || !IDENTIFICADOR.test(ubicacionId))) return []

  let consulta = supabase.from("traslados").select(COLUMNAS).in("estado", ESTADOS_POR_RECIBIR)

  if (!esAdmin) consulta = consulta.eq("destino_id", ubicacionId)

  const { data, error } = await consulta.order("creado_en", { ascending: true }).order("id", { ascending: true })

  if (error) fallo(error, "cargar los traslados por recibir")

  // Lo que envió él mismo no es suyo para recibir (salvo el administrador).
  const filas = (data || []).filter((fila) => esAdmin || !usuarioId || fila.usuario_id !== usuarioId)

  if (filas.length === 0) return []

  const [nombres, productos] = await Promise.all([nombresDeUsuarios(filas), nombresDeProductos(filas)])

  return filas.map((fila) => aTrasladoDeApp(fila, nombres, productos))
}

// Cuántos traslados trae cada página del historial.
export const TAMANO_PAGINA = 25

// Supabase responde como mucho 1000 filas por consulta; el refresco pide menos.
export const MAXIMO_POR_CONSULTA = 500

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

/*
  El primer instante de un día AAAA-MM-DD en la hora de quien usa la
  pantalla —la misma en que se le muestran las fechas—, como instante UTC
  para comparar con creado_en. `dias` corre ese día hacia adelante.
*/
function inicioDelDia(texto, dias = 0) {
  const partes = FECHA.exec(texto)

  if (!partes) throw new Error("Fecha no válida.")

  const [, anio, mes, dia] = partes.map(Number)

  return new Date(anio, mes - 1, dia + dias).toISOString()
}

/*
  La ubicación se mete dentro de la expresión de or(), así que solo se
  acepta algo con forma de identificador: una coma, un punto o un
  paréntesis cambiarían el filtro en vez de nombrar una ubicación.
*/
const IDENTIFICADOR = /^[\w-]+$/

/*
  Los traslados que el usuario puede ver, del más reciente al más antiguo,
  de a una página. Cuáles puede ver lo decide la base —se ve un traslado
  si se ve su origen o su destino—; qué ubicación y qué fechas, la
  consulta, para no traer todo al navegador.

  - Ubicación: el traslado aparece si es su origen O su destino.
  - Fechas: desde el primer instante de `desde` hasta antes del primer
    instante del día siguiente a `hasta`, para que ese día entre completo.
  - Orden: fecha y, para dos con la misma, el id. Sin el desempate, dos
    páginas podrían repetir uno y perder otro.
  - Página: se pide una fila más de las que se muestran; si llega, hay más.
*/
export async function traerTraslados(
  { ubicacionId = "", desde = "", hasta = "" } = {},
  { inicio = 0, cantidad = TAMANO_PAGINA } = {}
) {
  if (ubicacionId && !IDENTIFICADOR.test(ubicacionId)) {
    throw new Error("Ubicación no válida.")
  }

  // `cantidad` deja volver a pedir de una vez las filas ya cargadas (el refresco).
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAXIMO_POR_CONSULTA) {
    throw new Error("Cantidad de traslados no válida.")
  }

  const limiteInferior = desde ? inicioDelDia(desde) : null
  const limiteSuperior = hasta ? inicioDelDia(hasta, 1) : null

  if (limiteInferior && limiteSuperior && limiteInferior >= limiteSuperior) {
    throw new Error("La fecha desde no puede ser posterior a la fecha hasta.")
  }

  let consulta = supabase.from("traslados").select(COLUMNAS)

  if (ubicacionId) consulta = consulta.or(`origen_id.eq.${ubicacionId},destino_id.eq.${ubicacionId}`)
  if (limiteInferior) consulta = consulta.gte("creado_en", limiteInferior)
  if (limiteSuperior) consulta = consulta.lt("creado_en", limiteSuperior)

  const { data, error } = await consulta
    .order("creado_en", { ascending: false })
    .order("id", { ascending: false })
    .range(inicio, inicio + cantidad)

  if (error) fallo(error, "cargar el historial de traslados")

  const filas = (data || []).slice(0, cantidad)

  if (filas.length === 0) return { traslados: [], hayMas: false }

  const [nombres, productos] = await Promise.all([nombresDeUsuarios(filas), nombresDeProductos(filas)])

  return {
    traslados: filas.map((fila) => aTrasladoDeApp(fila, nombres, productos)),
    hayMas: (data || []).length > cantidad,
  }
}

/*
  Un traslado por su id, con lo que el usuario puede ver (RLS). Sirve para
  mantener al día un detalle abierto que ya no está en las listas de la
  pantalla, por ejemplo por un filtro. Si no lo puede ver, null.
*/
export async function traerTraslado(id) {
  if (!id || !IDENTIFICADOR.test(String(id))) return null

  const { data, error } = await supabase.from("traslados").select(COLUMNAS).eq("id", id).limit(1)

  if (error) fallo(error, "cargar el traslado")

  const filas = data || []

  if (filas.length === 0) return null

  const [nombres, productos] = await Promise.all([nombresDeUsuarios(filas), nombresDeProductos(filas)])

  return aTrasladoDeApp(filas[0], nombres, productos)
}
