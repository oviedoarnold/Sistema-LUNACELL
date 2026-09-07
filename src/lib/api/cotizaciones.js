import { supabase } from "../supabase"

import { pedirCorrelativo } from "./ventas"

/*
  Acceso a cotizaciones.

  Una cotización no toca el inventario: es una oferta con fecha de
  vencimiento, no una salida de mercadería. Por eso aquí no hay
  movimientos, a diferencia de las ventas.
*/

const COLUMNAS = `
  *,
  detalle_cotizacion (*)
`

function fallo(error, queHacia) {
  console.error(`No se pudo ${queHacia}:`, error)

  throw new Error(`No se pudo ${queHacia}.`)
}

const aFechaLocal = (iso) =>
  new Date(iso).toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })

const aRenglonDeApp = (fila) => ({
  productId: fila.producto_id,
  id: fila.producto_id,
  code: fila.codigo || "",
  name: fila.nombre,
  category: "",
  qty: Number(fila.cantidad),
  quantity: Number(fila.cantidad),
  price: Number(fila.precio),
  subtotal: Number(fila.subtotal),
})

export const numeroDeCotizacion = (correlativo) =>
  `COT-${String(correlativo).padStart(5, "0")}`

export function aCotizacionDeApp(fila, empresa) {
  const nombreCliente = fila.nombre_cliente || "Cliente General"

  return {
    id: fila.id,
    quoteNumber: fila.numero,
    correlativo: Number(fila.correlativo),

    date: aFechaLocal(fila.fecha),
    isoDate: fila.fecha,
    timestamp: new Date(fila.fecha).getTime(),

    clientId: fila.cliente_id,
    clientName: nombreCliente,
    clientPhone: "",
    clientAddress: "",
    rtn: fila.rtn_cliente || "",

    validity: fila.valida_hasta || "",
    notes: fila.notas || "",

    includeTax: fila.incluye_isv,
    taxRate: Number(fila.tasa_isv),
    subtotal: Number(fila.subtotal),
    tax: Number(fila.isv),
    total: Number(fila.total),

    items: (fila.detalle_cotizacion || []).map(aRenglonDeApp),

    saleId: fila.venta_id,

    company: {
      name: empresa?.name || "",
      address: empresa?.address || "",
      phone: empresa?.phone || "",
      currency: empresa?.currency || "L",
      taxRate: Number(fila.tasa_isv),
    },
  }
}

export async function traerCotizaciones() {
  const { data, error } = await supabase
    .from("cotizaciones")
    .select(COLUMNAS)
    .order("fecha", { ascending: false })

  if (error) fallo(error, "cargar las cotizaciones")

  return data || []
}

export const conFormaDeApp = (filas, empresa) =>
  filas
    .map((fila) => aCotizacionDeApp(fila, empresa))
    .sort((a, b) => b.timestamp - a.timestamp)

async function cotizacionConClave(clave, empresaId) {
  if (!clave) return null

  const { data } = await supabase
    .from("cotizaciones")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("clave_idempotencia", clave)
    .maybeSingle()

  return data?.id || null
}

export async function crearCotizacion(
  cotizacion,
  { empresaId, usuarioId, clave = null }
) {
  // Antes de pedir correlativo: repetirlo quemaria un numero para nada.
  const yaGuardada = await cotizacionConClave(clave, empresaId)

  if (yaGuardada) return yaGuardada

  const correlativo = await pedirCorrelativo("cotizacion")

  const { data: cabecera, error } = await supabase
    .from("cotizaciones")
    .insert({
      empresa_id: empresaId,
      cliente_id: cotizacion.clientId || null,
      usuario_id: usuarioId || null,

      numero: numeroDeCotizacion(correlativo),
      correlativo,

      valida_hasta: cotizacion.validity || null,

      nombre_cliente: cotizacion.clientName || "Cliente General",
      rtn_cliente: cotizacion.rtn || "",

      incluye_isv: cotizacion.includeTax !== false,
      subtotal: cotizacion.subtotal,
      isv: cotizacion.tax,
      tasa_isv: cotizacion.taxRate,
      total: cotizacion.total,

      notas: cotizacion.notes || "",
      clave_idempotencia: clave,
    })
    .select("id")
    .single()

  if (error?.code === "23505" && clave) {
    const guardadaPorOtroIntento = await cotizacionConClave(clave, empresaId)

    if (guardadaPorOtroIntento) return guardadaPorOtroIntento
  }

  if (error) fallo(error, "guardar la cotización")

  try {
    await guardarRenglones(cabecera.id, cotizacion.items, empresaId)
  } catch (problema) {
    await supabase.from("cotizaciones").delete().eq("id", cabecera.id)

    throw problema
  }

  return cabecera.id
}

async function guardarRenglones(cotizacionId, items, empresaId) {
  const { error } = await supabase.from("detalle_cotizacion").insert(
    items.map((item) => ({
      empresa_id: empresaId,
      cotizacion_id: cotizacionId,
      producto_id: item.productId,
      nombre: item.name,
      codigo: item.code || "",
      cantidad: item.qty ?? item.quantity,
      precio: item.price,
      subtotal: item.subtotal,
    }))
  )

  if (error) fallo(error, "guardar el detalle de la cotización")
}

export async function eliminarCotizacion(id) {
  const { error } = await supabase.from("cotizaciones").delete().eq("id", id)

  if (error) fallo(error, "eliminar la cotización")
}

/*
  Deja anotado que la cotización terminó en venta, para poder distinguir
  las que se cerraron de las que solo vencieron.
*/
export async function marcarComoVendida(cotizacionId, ventaId) {
  const { error } = await supabase
    .from("cotizaciones")
    .update({ venta_id: ventaId })
    .eq("id", cotizacionId)

  if (error) fallo(error, "enlazar la cotización con la venta")
}
