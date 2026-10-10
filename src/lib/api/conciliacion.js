import { supabase } from "../supabase"

/*
  Conciliación administrativa (0027 y 0028).

  ventas_por_conciliar guarda tal cual las ventas sin conexión que no se
  pudieron aplicar. Un administrador decide con conciliar_venta(): aplicar,
  aplicar con ajuste (repone exactamente lo que falta, con su motivo) o
  anular. La base solo deja hacerlo a un administrador y una sola vez por
  venta; aquí solo se traduce.
*/

export const ACCIONES_DE_CONCILIACION = ["aplicar", "aplicar_con_ajuste", "anular"]

const MOTIVOS = {
  CV001: "accion-invalida",
  CV002: "ya-resuelta",
  CV003: "producto-inexistente",
  CV004: "cliente-inexistente",
  CV005: "falta-existencia",
  CV006: "total-distinto",
  CV007: "ubicacion-fiscal",
  42501: "sin-permiso",
}

export class ErrorDeConciliacion extends Error {
  constructor(mensaje, motivo, codigo) {
    super(mensaje)
    this.name = "ErrorDeConciliacion"
    this.motivo = motivo
    this.codigo = codigo
  }
}

const aRenglon = (r) => ({
  productoId: r.producto_id,
  codigo: r.codigo || "",
  nombre: r.nombre || "",
  cantidad: Number(r.cantidad),
  precio: Number(r.precio_unitario),
})

export const aVentaPorConciliar = (f) => ({
  id: f.id,
  clave: f.clave_idempotencia,
  usuarioId: f.usuario_id,
  usuarioAuth: f.usuario_auth,
  ubicacionId: f.ubicacion_id,
  dispositivo: f.dispositivo,
  numeroProvisional: f.numero_provisional,
  registradaEn: f.registrada_en,
  recibidaEn: f.recibida_en,
  desfaseSegundos: f.desfase_segundos,
  formaPago: f.forma_pago,
  clienteId: f.cliente_id,
  nombreCliente: f.nombre_cliente || "",
  rtnComprador: f.rtn_comprador || "",
  fechaVencimiento: f.fecha_vencimiento,
  nota: f.nota || "",
  renglones: (f.renglones || []).map(aRenglon),
  tasaIsv: Number(f.tasa_isv),
  totalCobrado: Number(f.total_cobrado),
  motivo: f.motivo,
  codigo: f.codigo,
  detalle: f.detalle || "",
  recibidaPor: f.recibida_por,
  estado: f.estado,
  resueltaEn: f.resuelta_en,
  resolucionAccion: f.resolucion_accion,
  resolucionMotivo: f.resolucion_motivo || "",
  ventaId: f.venta_id,
  ajustes: Array.isArray(f.ajuste_movimientos) ? f.ajuste_movimientos : [],
})

export async function traerVentasPorConciliar() {
  const { data, error } = await supabase
    .from("ventas_por_conciliar")
    .select("*")
    .order("recibida_en", { ascending: false })

  if (error) {
    console.error("No se pudieron cargar las ventas por conciliar:", error)
    throw new Error("No se pudieron cargar las ventas por conciliar.")
  }

  return (data || []).map(aVentaPorConciliar)
}

export async function conciliarVenta(id, accion, motivo) {
  if (!ACCIONES_DE_CONCILIACION.includes(accion)) {
    throw new ErrorDeConciliacion("Acción de conciliación desconocida.", "accion-invalida", "")
  }

  const motivoLimpio = String(motivo || "").trim()

  if (!motivoLimpio) {
    throw new ErrorDeConciliacion("Escribe el motivo de la conciliación.", "accion-invalida", "")
  }

  const { data, error } = await supabase.rpc("conciliar_venta", {
    p_conciliacion: id,
    p_accion: accion,
    p_motivo: motivoLimpio,
  })

  if (error) {
    const motivoDelError = MOTIVOS[error.code]

    if (motivoDelError) throw new ErrorDeConciliacion(error.message, motivoDelError, error.code)

    console.error("No se pudo conciliar la venta:", error)
    throw new ErrorDeConciliacion("No se pudo conciliar la venta. Intenta de nuevo.", "desconocido", error.code || "")
  }

  return data
}

export async function traerAuditoriaRescates() {
  const { data, error } = await supabase
    .from("auditoria_rescates")
    .select("id, lote, clave, usuario_auth, dispositivo, resultado, codigo, detalle, conciliacion_id, venta_id, creado_en")
    .order("creado_en", { ascending: false })
    .limit(200)

  if (error) {
    console.error("No se pudo cargar la auditoría de rescates:", error)
    throw new Error("No se pudo cargar la auditoría de rescates.")
  }

  return (data || []).map((f) => ({
    id: f.id,
    lote: f.lote || "",
    clave: f.clave || "",
    usuarioAuth: f.usuario_auth,
    dispositivo: f.dispositivo || "",
    resultado: f.resultado,
    codigo: f.codigo || "",
    detalle: f.detalle || "",
    conciliacionId: f.conciliacion_id,
    ventaId: f.venta_id,
    creadoEn: f.creado_en,
  }))
}
