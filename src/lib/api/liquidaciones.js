import { supabase } from "../supabase"
import { clasificarError } from "../sinConexion/clasificar"

export { ESTADO_DE_LIQUIDACION, ESTADO_DEL_PEDIDO, METODOS } from "../../utils/liquidaciones"

/*
  Liquidaciones entre ubicaciones (0046).

  En un pedido, la ubicación que entrega cobra y otra factura. El efectivo que
  cobró para la otra se le entrega en dos pasos: quien entrega registra la
  entrega y quien recibe la confirma (o la rechaza). Lo electrónico y su cargo
  llegan a la cuenta de la empresa y no se liquidan.

  Una liquidación no es venta, cobro ni abono. Los saldos, los repartos entre
  pedidos y los permisos los decide la base; desde aquí solo viaja la
  intención y la clave del intento, que hace seguro reintentar.
*/

const MOTIVOS = {
  LQ001: "datos-invalidos",
  LQ002: "monto-excedido",
  LQ003: "clave-reusada",
  LQ004: "ya-resuelta",
  42501: "sin-permiso",
}

export class ErrorDeLiquidacion extends Error {
  constructor(mensaje, motivo, codigo) {
    super(mensaje)

    this.name = "ErrorDeLiquidacion"
    this.motivo = motivo
    this.codigo = codigo
  }
}

async function llamar(funcion, argumentos, queHacia) {
  const { data, error, status } = await supabase.rpc(funcion, argumentos)

  if (!error) return data

  const motivo = MOTIVOS[error.code]

  if (motivo) throw new ErrorDeLiquidacion(error.message, motivo, error.code)

  if (clasificarError(error, status) === "red") {
    throw new ErrorDeLiquidacion(
      `No hubo respuesta del servidor: ${queHacia} pudo haberse registrado o no. Reintentar es seguro.`,
      "sin-respuesta",
      error.code || ""
    )
  }

  console.error(`No se pudo ${queHacia}:`, error)

  throw new ErrorDeLiquidacion(`No se pudo ${queHacia}.`, "desconocido", error.code || "")
}

const numero = (valor) => Number(valor ?? 0)

const aPar = (fila) => ({
  clave: `${fila.origen_id}|${fila.destino_id}`,
  origenId: fila.origen_id,
  origen: fila.origen,
  destinoId: fila.destino_id,
  destino: fila.destino,
  efectivo: numero(fila.efectivo),
  electronico: numero(fila.electronico),
  cargo: numero(fila.cargo),
  porConfirmar: numero(fila.por_confirmar),
  liquidado: numero(fila.liquidado),
  pendiente: numero(fila.pendiente),
  puedeRegistrar: Boolean(fila.puede_registrar),
})

const aPedido = (fila) => ({
  id: fila.pedido_id,
  numero: fila.numero,
  estado: fila.estado,
  origenId: fila.origen_id,
  origen: fila.origen,
  destinoId: fila.destino_id,
  destino: fila.destino,
  cliente: fila.cliente,
  formaPago: fila.forma_pago,
  entregadoEn: fila.entregado_en,
  numeroFactura: fila.numero_factura || "",
  efectivo: numero(fila.efectivo),
  electronico: numero(fila.electronico),
  cargo: numero(fila.cargo),
  porConfirmar: numero(fila.por_confirmar),
  liquidado: numero(fila.liquidado),
  pendiente: numero(fila.pendiente),
  estadoLiquidacion: fila.estado_liquidacion,
  medios: (fila.medios || []).map((m) => ({ medio: m.medio, monto: numero(m.monto), cargo: numero(m.cargo) })),
})

export const aLiquidacionDeApp = (fila) => ({
  id: fila.id,
  numero: fila.numero,
  estado: fila.estado,
  origenId: fila.origen_id,
  origen: fila.origen ?? "",
  destinoId: fila.destino_id,
  destino: fila.destino ?? "",
  monto: numero(fila.monto),
  metodo: fila.metodo,
  fechaEfectiva: fila.fecha_efectiva,
  referencia: fila.referencia || "",
  observacion: fila.observacion || "",
  registradaPor: fila.registrada_por_nombre ?? fila.registrada_por ?? "",
  registradaEn: fila.registrada_en,
  resueltaPor: fila.resuelta_por_nombre ?? fila.resuelta_por ?? "",
  resueltaEn: fila.resuelta_en,
  motivoRechazo: fila.motivo_rechazo || "",
  puedeResolver: Boolean(fila.puede_resolver),
  pedidos: (fila.pedidos || []).map((p) => ({ numero: p.numero, monto: numero(p.monto) })),
  repetida: Boolean(fila.repetida),
})

/* Los saldos por par, los pedidos y las liquidaciones que el usuario puede ver. */
export async function traerControlDeLiquidaciones() {
  const datos = await llamar("control_de_liquidaciones", {}, "cargar las liquidaciones")

  return {
    pares: (datos?.pares || []).map(aPar),
    pedidos: (datos?.pedidos || []).map(aPedido),
    liquidaciones: (datos?.liquidaciones || []).map(aLiquidacionDeApp),
  }
}

/*
  Registra la entrega. `clave` es la del intento: la misma en cada reintento,
  para que un doble clic o una respuesta perdida no registren dos entregas.
*/
export async function registrarLiquidacion({ origenId, destinoId, monto, metodo, fechaEfectiva, referencia = "", observacion = "", pedidoId = null, clave }) {
  const fila = await llamar(
    "registrar_liquidacion",
    {
      p_origen: origenId,
      p_destino: destinoId,
      p_monto: monto,
      p_metodo: metodo,
      p_fecha_efectiva: fechaEfectiva || null,
      p_referencia: referencia,
      p_observacion: observacion,
      p_pedido: pedidoId,
      p_clave_idempotencia: clave,
    },
    "registrar la entrega"
  )

  return aLiquidacionDeApp(fila)
}

export async function confirmarLiquidacion(id) {
  return aLiquidacionDeApp(await llamar("resolver_liquidacion", { p_liquidacion: id, p_confirmar: true }, "confirmar la recepción"))
}

export async function rechazarLiquidacion(id, motivo) {
  return aLiquidacionDeApp(await llamar("resolver_liquidacion", { p_liquidacion: id, p_confirmar: false, p_motivo: motivo }, "rechazar la entrega"))
}
