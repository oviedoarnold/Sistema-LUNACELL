import { supabase } from "../supabase"

/*
  Traslados de existencia entre ubicaciones.

  Escribir es UNA llamada a registrar_traslado(), que en una sola
  transacción descuenta el origen, suma al destino y deja la salida y la
  entrada en el libro. El navegador solo dice de dónde, hacia dónde, qué
  productos y cuántos: empresa, usuario y existencias los decide la base,
  y las tablas de traslados no se escriben desde aquí.
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

  if (error) {
    const motivo = MOTIVOS_DE_TRASLADO[error.code]

    /*
      Los rechazos de negocio llevan el mensaje del motor, que ya dice qué
      hacer: cuánto hay y en qué ubicación, o que el origen no es el suyo.
    */
    if (motivo) {
      throw new ErrorDeTraslado(error.message, motivo, error.code)
    }

    fallo(error, "registrar el traslado")
  }

  return data.traslado_id
}

const COLUMNAS = `
  id, origen_id, destino_id, usuario_id, estado, nota, creado_en,
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

  const { data, error } = await supabase.from("productos").select("id, nombre").in("id", ids)

  if (error) return new Map()

  return new Map((data || []).map((p) => [p.id, p.nombre]))
}

export const aTrasladoDeApp = (fila, nombres = new Map(), productos = new Map()) => ({
  id: fila.id,
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
    productName: productos.get(d.producto_id) || "",
    qty: Number(d.cantidad),
  })),
})

// Cuántos traslados trae cada página del historial.
export const TAMANO_PAGINA = 25

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
  { inicio = 0 } = {}
) {
  if (ubicacionId && !IDENTIFICADOR.test(ubicacionId)) {
    throw new Error("Ubicación no válida.")
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
    .range(inicio, inicio + TAMANO_PAGINA)

  if (error) fallo(error, "cargar el historial de traslados")

  const filas = (data || []).slice(0, TAMANO_PAGINA)

  if (filas.length === 0) return { traslados: [], hayMas: false }

  const [nombres, productos] = await Promise.all([nombresDeUsuarios(filas), nombresDeProductos(filas)])

  return {
    traslados: filas.map((fila) => aTrasladoDeApp(fila, nombres, productos)),
    hayMas: (data || []).length > TAMANO_PAGINA,
  }
}
