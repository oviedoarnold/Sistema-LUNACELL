import { supabase } from "../supabase"
import { clasificarError } from "../sinConexion/clasificar"

/*
  Pedidos interubicación (0045): una ubicación entrega y otra factura.

  Todo pasa por funciones de la base. Desde aquí viajan solo la intención
  —destino, cliente, productos, cantidades, precio negociado, medios— y la
  clave del intento. El origen, los precios, los importes y la numeración los
  decide el servidor.

  Crear, revisar y facturar necesitan conexión: no hay versión sin conexión.
*/

const MOTIVOS = {
  PI001: "datos-invalidos",
  PI002: "sin-origen",
  PI003: "destino-invalido",
  PI004: "cliente-requerido",
  PI005: "clave-reusada",
  PI006: "producto-invalido",
  PI007: "stock-insuficiente",
  PI008: "no-facturable",
  PI009: "isv-obligatorio",
  PI010: "prima-invalida",
  PI011: "clave-reusada",
  PI012: "estado-no-permite",
  PI013: "liquidacion-registrada",
  LM001: "medios-invalidos",
  LM002: "medios-no-cuadran",
  LM007: "porcentaje-cambiado",
  LN001: "precio-negociado-invalido",
  42501: "sin-permiso",
}

const MENSAJE_DEL_PAGO_PARCIAL = "El pago parcial debe ser menor que el total del pedido. Si el cliente paga todo, envíalo al contado."

export class ErrorDePedido extends Error {
  constructor(mensaje, motivo, codigo) {
    super(mensaje)

    this.name = "ErrorDePedido"
    this.motivo = motivo
    this.codigo = codigo
  }
}

/*
  Los rechazos de negocio llevan el mensaje del motor, que ya dice qué hacer.
  Sin respuesta, la operación pudo hacerse o no: reintentar con la misma
  clave es seguro.
*/
async function llamar(funcion, argumentos, queHacia) {
  const { data, error, status } = await supabase.rpc(funcion, argumentos)

  if (!error) return data

  const motivo = MOTIVOS[error.code]

  // En la base se llama «prima»; en pantalla, «pago parcial».
  if (error.code === "PI010") throw new ErrorDePedido(MENSAJE_DEL_PAGO_PARCIAL, motivo, error.code)

  if (motivo) throw new ErrorDePedido(error.message, motivo, error.code)

  if (clasificarError(error, status) === "red") {
    throw new ErrorDePedido(
      `No hubo respuesta del servidor: ${queHacia} pudo haberse registrado o no. Reintentar es seguro.`,
      "sin-respuesta",
      error.code || ""
    )
  }

  console.error(`No se pudo ${queHacia}:`, error)

  throw new ErrorDePedido(`No se pudo ${queHacia}.`, "desconocido", error.code || "")
}

const numero = (valor) => (valor === null || valor === undefined ? null : Number(valor))

export const aPedidoDeApp = (fila) => ({
  id: fila.pedido_id,
  numero: fila.numero,
  estado: fila.estado,
  origenId: fila.origen_id,
  origen: fila.origen,
  destinoId: fila.destino_id,
  destino: fila.destino,
  cliente: fila.nombre_cliente,
  formaPago: fila.forma_pago,
  total: numero(fila.total),
  cobrado: numero(fila.cobrado),
  saldo: numero(fila.saldo),
  entregadoEn: fila.entregado_en,
  entregadoPor: fila.entregado_por || "",
  facturadoEn: fila.facturado_en || null,
  numeroFactura: fila.numero_factura || null,
  ventaId: fila.venta_id || null,
  leido: Boolean(fila.leido),
  // En la campanita, el rechazo que espera decisión.
  motivo: fila.motivo || "",
  rechazadoEn: fila.rechazado_en || null,
})

const aDetalleDeApp = (fila) => ({
  ...aPedidoDeApp(fila),
  subtotal: numero(fila.subtotal),
  isv: numero(fila.isv),
  tasaIsv: numero(fila.tasa_isv),
  cargo: numero(fila.cargo),
  tasaCargo: numero(fila.tasa_cargo),
  rtn: fila.rtn_comprador || "",
  fechaVencimiento: fila.fecha_vencimiento || null,
  nota: fila.nota || "",
  facturadoPor: fila.facturado_por || "",
  destinoEmiteFiscal: Boolean(fila.destino_emite_fiscal),
  puedeFacturar: Boolean(fila.puede_facturar),
  puedeRechazar: Boolean(fila.puede_rechazar),
  puedeResolver: Boolean(fila.puede_resolver),
  puedeFacturarEnOrigen: Boolean(fila.puede_facturar_en_origen),
  facturaEnOrigen: Boolean(fila.factura_en_origen),
  bloqueoPorLiquidacion: fila.bloqueo_por_liquidacion || null,
  rechazo: fila.rechazo
    ? { motivo: fila.rechazo.motivo || "", usuario: fila.rechazo.usuario || "", ubicacion: fila.rechazo.ubicacion || "", fecha: fila.rechazo.fecha }
    : null,
  destinosParaReenviar: (fila.destinos_para_reenviar || []).map((d) => ({ id: d.id, nombre: d.nombre })),
  productos: (fila.productos || []).map((p) => ({
    id: p.producto_id,
    codigo: p.codigo || "",
    nombre: p.nombre,
    cantidad: Number(p.cantidad),
    precio: numero(p.precio),
    subtotal: numero(p.subtotal),
    precioGeneral: numero(p.precio_general),
    precioEspecial: numero(p.precio_especial),
    precioReferencia: numero(p.precio_referencia),
    motivoNegociacion: p.motivo_negociacion || null,
    negociadoPor: p.negociado_por || "",
    entregado: Number(p.entregado || 0),
  })),
  cobros: (fila.cobros || []).map((c) => ({
    medio: c.medio,
    monto: numero(c.monto),
    cargo: numero(c.cargo),
    tasa: numero(c.tasa),
    referencia: c.referencia || "",
    ubicacion: c.ubicacion || "",
    fecha: c.fecha,
  })),
  eventos: (fila.eventos || []).map((e) => ({
    tipo: e.tipo,
    usuario: e.usuario,
    motivo: e.motivo || "",
    fecha: e.fecha,
    ubicacion: e.ubicacion || "",
    rechazadoEn: e.rechazado_en || "",
    desde: e.desde || "",
    hacia: e.hacia || "",
  })),
})

/*
  Entrega en la ubicación del usuario y envía el pedido. `cobros`: al contado,
  los medios del total; a crédito, el pago parcial («prima» en la base) o nada.
*/
export async function entregarPedido(pedido, clave) {
  const data = await llamar(
    "entregar_pedido",
    {
      p_destino: pedido.destinoId,
      p_cliente_id: pedido.clienteId,
      p_items: pedido.items.map((item) => ({
        producto_id: item.productId,
        cantidad: Number(item.qty),
        ...(item.precioNegociado === undefined
          ? {}
          : { precio_negociado: item.precioNegociado, motivo_negociacion: item.motivoNegociacion || null }),
      })),
      p_forma_pago: pedido.formaPago,
      p_cobros: pedido.cobros || [],
      p_con_isv: pedido.conIsv !== false,
      p_fecha_vencimiento: pedido.formaPago === "credito" ? pedido.fechaVencimiento || null : null,
      p_rtn_comprador: pedido.rtn || null,
      p_nota: pedido.nota || "",
      p_clave_idempotencia: clave,
    },
    "entregar el pedido"
  )

  return { ...aPedidoDeApp(data), repetido: Boolean(data.repetido) }
}

export async function facturarPedido(pedidoId) {
  const data = await llamar("facturar_pedido", { p_pedido: pedidoId }, "facturar el pedido")

  return { ...aPedidoDeApp(data), yaFacturado: Boolean(data.ya_facturado), esFiscal: Boolean(data.es_fiscal) }
}

/*
  Rechazar (destino) y resolver (origen), etapa C1: antes de facturar, sin tocar
  inventario, cobros ni liquidaciones. La clave es la del intento: un reintento
  sin respuesta con la misma clave devuelve lo que ya se hizo.
*/
export async function rechazarPedido(pedidoId, motivo, clave) {
  const data = await llamar("rechazar_pedido", { p_pedido: pedidoId, p_motivo: motivo, p_clave_idempotencia: clave }, "rechazar el pedido")

  return { ...aPedidoDeApp(data), repetido: Boolean(data.repetido) }
}

// `decision`: "reenviar" (con `destinoId`) o "facturar_en_origen", que emite la factura en la misma operación.
export async function resolverPedido(pedidoId, { decision, destinoId = null, nota = "" }, clave) {
  const data = await llamar(
    "resolver_pedido",
    {
      p_pedido: pedidoId,
      p_decision: decision,
      p_destino: decision === "reenviar" ? destinoId : null,
      p_nota: nota,
      p_clave_idempotencia: clave,
    },
    decision === "reenviar" ? "enviar el pedido a otra ubicación" : "facturar el pedido"
  )

  return { ...aPedidoDeApp(data), repetido: Boolean(data.repetido) }
}

export async function traerBandeja({ vista = "recibidos", estado = "pendiente" } = {}) {
  const data = await llamar("bandeja_de_pedidos", { p_vista: vista, p_estado: estado }, "cargar los pedidos")

  return (data || []).map(aPedidoDeApp)
}

export async function traerDetalleDePedido(pedidoId) {
  return aDetalleDeApp(await llamar("detalle_de_pedido", { p_pedido: pedidoId }, "cargar el pedido"))
}

export async function marcarPedidoLeido(pedidoId) {
  await llamar("marcar_pedido_leido", { p_pedido: pedidoId }, "marcar el aviso como leído")
}

export async function traerAvisosDePedidos() {
  const data = await llamar("avisos_de_pedidos", {}, "consultar los avisos")

  return {
    pendientes: Number(data?.pendientes || 0),
    sinLeer: Number(data?.sin_leer || 0),
    porResolver: Number(data?.por_resolver || 0),
    porResolverSinLeer: Number(data?.por_resolver_sin_leer || 0),
    ultimos: (data?.ultimos || []).map(aPedidoDeApp),
  }
}

export const ESTADOS_DE_PEDIDO = {
  pendiente: "Pendiente de facturar",
  facturado: "Facturado",
  por_resolver: "Por resolver",
  cancelado: "Cancelado",
}
