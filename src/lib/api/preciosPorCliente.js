import { supabase } from "../supabase"

/*
  Precios especiales por cliente (0042). Los lee cualquiera de la empresa, y los
  cambia un administrador con guardar_precios_de_cliente(), que reemplaza la lista
  completa en una transacción. El precio de cada venta lo decide el servidor.
*/

const FILAS_POR_PAGINA = 1000

function fallo(error, queHacia) {
  console.error(`No se pudo ${queHacia}:`, error)

  throw new Error(`No se pudo ${queHacia}.`)
}

/* Un objeto { productoId: precio }. */
export async function traerPreciosDeCliente(clienteId) {
  const { data, error } = await supabase
    .from("precios_por_cliente")
    .select("producto_id, precio")
    .eq("cliente_id", clienteId)

  if (error) fallo(error, "cargar los precios del cliente")

  return Object.fromEntries((data || []).map((f) => [f.producto_id, Number(f.precio)]))
}

/* Para la copia sin conexión: { clienteId: { productoId: precio } }, sin límite de filas. */
export async function traerTodosLosPrecios() {
  const porCliente = {}

  for (let desde = 0; ; desde += FILAS_POR_PAGINA) {
    const { data, error } = await supabase
      .from("precios_por_cliente")
      .select("cliente_id, producto_id, precio")
      .order("id")
      .range(desde, desde + FILAS_POR_PAGINA - 1)

    if (error) fallo(error, "cargar los precios por cliente")

    for (const fila of data || []) {
      porCliente[fila.cliente_id] = { ...porCliente[fila.cliente_id], [fila.producto_id]: Number(fila.precio) }
    }

    if ((data || []).length < FILAS_POR_PAGINA) return porCliente
  }
}

/* `filas`: [{ productoId, precio }]. Lo que no venga se quita de la lista del cliente. */
export async function guardarPreciosDeCliente(clienteId, filas) {
  const { error } = await supabase.rpc("guardar_precios_de_cliente", {
    p_cliente: clienteId,
    p_precios: filas.map((f) => ({ producto_id: f.productoId, precio: Number(f.precio) })),
  })

  if (error) {
    throw new Error(
      error.code === "42501" || error.code === "LP001"
        ? error.message
        : "No se pudieron guardar los precios especiales."
    )
  }
}
