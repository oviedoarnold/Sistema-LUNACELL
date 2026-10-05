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
  Quién hizo cada traslado. La política de usuarios puede no dejar leer a
  los demás —un vendedor no ve la lista de usuarios—, y eso no es motivo
  para no mostrar el historial: el nombre queda vacío.
*/
async function nombresDeUsuarios() {
  const { data, error } = await supabase.from("usuarios").select("id, nombre")

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

/*
  Los traslados que el usuario puede ver, del más reciente al más antiguo.
  Cuáles son lo decide la base: se ve un traslado si se ve su origen o su
  destino.
*/
export async function traerTraslados() {
  const { data, error } = await supabase
    .from("traslados")
    .select(COLUMNAS)
    .order("creado_en", { ascending: false })
    .limit(50)

  if (error) fallo(error, "cargar el historial de traslados")

  const filas = data || []
  const [nombres, productos] = await Promise.all([nombresDeUsuarios(), nombresDeProductos(filas)])

  return filas
    .map((fila) => aTrasladoDeApp(fila, nombres, productos))
    .sort((a, b) => b.timestamp - a.timestamp)
}
