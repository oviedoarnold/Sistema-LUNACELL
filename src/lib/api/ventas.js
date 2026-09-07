import { supabase } from "../supabase"

import { formatDocumentNumber, isFiscalConfigured } from "../../utils/fiscal"

/*
  Acceso a facturas y abonos.

  La factura guarda su propia copia de los datos fiscales y del nombre de
  cada producto: lo emitido no puede cambiar porque después se renueve el
  CAI o se corrija el catálogo.
*/

const COLUMNAS_VENTA = `
  *,
  detalle_venta (*),
  abonos (*)
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

const aAbonoDeApp = (fila) => ({
  id: fila.id,
  amount: Number(fila.monto),
  date: aFechaLocal(fila.fecha),
  isoDate: fila.fecha,
  timestamp: new Date(fila.fecha).getTime(),
  note: fila.nota || "",
})

export function aVentaDeApp(fila, empresa) {
  const nombreCliente = fila.nombre_cliente || "Consumidor Final"

  return {
    id: fila.id,
    invoiceNumber: fila.numero_factura,
    correlativo: Number(fila.correlativo),

    date: aFechaLocal(fila.fecha),
    isoDate: fila.fecha,
    timestamp: new Date(fila.fecha).getTime(),

    clientId: fila.cliente_id,
    clientName: nombreCliente,
    customerName: nombreCliente,
    customer: nombreCliente,
    rtn: fila.rtn_comprador || "",

    items: (fila.detalle_venta || []).map(aRenglonDeApp),
    payments: (fila.abonos || [])
      .map(aAbonoDeApp)
      .sort((a, b) => a.timestamp - b.timestamp),

    subtotal: Number(fila.subtotal),
    tax: Number(fila.isv),
    taxRate: Number(fila.tasa_isv),
    total: Number(fila.total),

    paymentType: fila.forma_pago,
    type: fila.forma_pago,
    dueDate: fila.fecha_vencimiento,
    status: fila.estado,
    note: fila.nota || "",

    fiscal: {
      cai: fila.cai_emision || "",
      rangoDesde: fila.rango_desde_emision ?? "",
      rangoHasta: fila.rango_hasta_emision ?? "",
      fechaLimiteEmision: fila.fecha_limite_emision_emision || "",
      correlativo: Number(fila.correlativo),
      numero: fila.numero_factura,
    },

    company: {
      name: empresa?.name || "",
      address: empresa?.address || "",
      phone: empresa?.phone || "",
      currency: empresa?.currency || "L",
      taxRate: Number(fila.tasa_isv),
    },
  }
}

/*
  Devuelve las filas tal como vienen. Darles la forma que espera la
  pantalla necesita los datos de la empresa, y ese es un dato de
  presentación: mezclarlo aquí obligaría a recargar el historial completo
  cada vez que cambia el encabezado de la factura.
*/
export async function traerVentas() {
  const { data, error } = await supabase
    .from("ventas")
    .select(COLUMNAS_VENTA)
    .order("fecha", { ascending: false })

  if (error) fallo(error, "cargar el historial de facturas")

  return data || []
}

export const conFormaDeApp = (filas, empresa) =>
  filas
    .map((fila) => aVentaDeApp(fila, empresa))
    .sort((a, b) => b.timestamp - a.timestamp)

export async function pedirCorrelativo(tipo) {
  const { data, error } = await supabase.rpc("siguiente_correlativo", {
    p_tipo: tipo,
  })

  if (error) fallo(error, "obtener el número de documento")

  return Number(data)
}

const numeroDeFactura = (correlativo, fiscal) =>
  isFiscalConfigured(fiscal)
    ? formatDocumentNumber(correlativo, fiscal)
    : `FAC-${String(correlativo).padStart(5, "0")}`

/*
  Guarda la factura, sus renglones y la salida de inventario. Si algo
  falla después de crear la cabecera se borra: una factura sin renglones
  descuadraría el reporte de ventas.
*/
/*
  Devuelve el documento que ya se emitio con esa clave, si lo hay.

  Es lo que convierte a la operacion en idempotente: el segundo intento no
  crea nada, encuentra el primero.
*/
async function ventaConClave(clave, empresaId) {
  if (!clave) return null

  const { data } = await supabase
    .from("ventas")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("clave_idempotencia", clave)
    .maybeSingle()

  return data?.id || null
}

export async function crearVenta(
  venta,
  { empresaId, usuarioId, empresa, clave = null }
) {
  /*
    Antes de pedir correlativo: si esta venta ya se emitio, pedir otro
    numero quemaria un correlativo de la numeracion autorizada para nada.
  */
  const yaEmitida = await ventaConClave(clave, empresaId)

  if (yaEmitida) return yaEmitida

  const fiscal = empresa?.fiscal
  const correlativo = await pedirCorrelativo("factura")
  const esCredito = venta.paymentType === "credito"

  const { data: cabecera, error } = await supabase
    .from("ventas")
    .insert({
      empresa_id: empresaId,
      cliente_id: venta.clientId || null,
      usuario_id: usuarioId || null,

      numero_factura: numeroDeFactura(correlativo, fiscal),
      correlativo,

      nombre_cliente: venta.customerName || "Consumidor Final",
      rtn_comprador: venta.rtn || "",

      subtotal: venta.subtotal,
      isv: venta.tax,
      tasa_isv: venta.taxRate,
      total: venta.total,

      forma_pago: venta.paymentType,
      fecha_vencimiento: esCredito ? venta.dueDate || null : null,
      estado: esCredito ? "pendiente" : "pagada",

      cai_emision: fiscal?.cai || "",
      rango_desde_emision: fiscal?.rangoDesde || null,
      rango_hasta_emision: fiscal?.rangoHasta || null,
      fecha_limite_emision_emision: fiscal?.fechaLimiteEmision || null,

      nota: venta.note || "",
      clave_idempotencia: clave,
    })
    .select("id")
    .single()

  /*
    23505 es la violacion de unicidad. Con clave, significa que otro
    intento de esta misma venta gano la carrera: se devuelve el suyo.
  */
  if (error?.code === "23505" && clave) {
    const emitidaPorOtroIntento = await ventaConClave(clave, empresaId)

    if (emitidaPorOtroIntento) return emitidaPorOtroIntento
  }

  if (error) fallo(error, "registrar la venta")

  try {
    await guardarRenglones(cabecera.id, venta.items, empresaId)
    await descargarInventario(cabecera.id, venta.items, empresaId, usuarioId)
  } catch (problema) {
    await supabase.from("ventas").delete().eq("id", cabecera.id)

    throw problema
  }

  return cabecera.id
}

async function guardarRenglones(ventaId, items, empresaId) {
  const { error } = await supabase.from("detalle_venta").insert(
    items.map((item) => ({
      empresa_id: empresaId,
      venta_id: ventaId,
      producto_id: item.productId,
      nombre: item.name,
      codigo: item.code || "",
      cantidad: item.qty,
      precio: item.price,
      subtotal: item.subtotal,
    }))
  )

  if (error) fallo(error, "guardar el detalle de la venta")
}

/*
  La salida se anota como movimiento negativo: el stock es la suma del
  libro, nunca una columna que se sobrescribe.
*/
async function descargarInventario(ventaId, items, empresaId, usuarioId) {
  const { error } = await supabase.from("movimientos_inventario").insert(
    items.map((item) => ({
      empresa_id: empresaId,
      producto_id: item.productId,
      usuario_id: usuarioId || null,
      venta_id: ventaId,
      tipo: "salida",
      cantidad: -Math.abs(item.qty),
      motivo: "Venta",
    }))
  )

  if (error) fallo(error, "descargar el inventario de la venta")
}

// ── ABONOS ─────────────────────────────────────────────────

async function abonoConClave(clave, empresaId) {
  if (!clave) return null

  const { data } = await supabase
    .from("abonos")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("clave_idempotencia", clave)
    .maybeSingle()

  return data || null
}

export async function crearAbono(
  ventaId,
  { amount, note },
  { empresaId, usuarioId, clave = null }
) {
  const yaRegistrado = await abonoConClave(clave, empresaId)

  if (yaRegistrado) return aAbonoDeApp(yaRegistrado)

  const { data, error } = await supabase
    .from("abonos")
    .insert({
      empresa_id: empresaId,
      venta_id: ventaId,
      usuario_id: usuarioId || null,
      monto: amount,
      nota: note || "",
      clave_idempotencia: clave,
    })
    .select("*")
    .single()

  if (error?.code === "23505" && clave) {
    const registradoPorOtroIntento = await abonoConClave(clave, empresaId)

    if (registradoPorOtroIntento) return aAbonoDeApp(registradoPorOtroIntento)
  }

  if (error) fallo(error, "registrar el abono")

  return aAbonoDeApp(data)
}

export async function eliminarAbono(abonoId) {
  const { error } = await supabase.from("abonos").delete().eq("id", abonoId)

  if (error) fallo(error, "eliminar el abono")
}

/*
  El estado de la factura lo decide el saldo, no el usuario. Se recalcula
  después de cada abono para que "cancelada" nunca dependa de que la
  pantalla se acuerde de actualizarlo.
*/
export async function ajustarEstadoPorSaldo(ventaId, saldoPendiente) {
  const { error } = await supabase
    .from("ventas")
    .update({ estado: saldoPendiente <= 0 ? "pagada" : "pendiente" })
    .eq("id", ventaId)

  if (error) fallo(error, "actualizar el estado de la factura")
}
