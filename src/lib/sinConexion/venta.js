/*
  Una venta hecha sin conexión, tal como el teléfono la guarda y después la
  envía a sincronizar_venta_sin_conexion().

  Los precios, la tasa y los clientes salen de la copia local, nunca de lo
  que mande la pantalla. Los totales se calculan con la misma fórmula que el
  servidor (redondeo por línea, ISV sobre el subtotal): si no coinciden con
  lo vigente al sincronizar, la venta va a conciliación, nunca se cambia lo
  cobrado.

  El comprobante es provisional: el número definitivo lo asigna el servidor
  al registrarla. Nunca se inventa numeración fiscal.
*/
import { mismoDueno } from "./copiaLocal"

export class ErrorDeVentaLocal extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = "ErrorDeVentaLocal"
  }
}

const centavos = (valor) => Math.round(Number(valor) * 100)

export function totalesDe(renglones, tasa) {
  const subtotal = renglones.reduce((suma, r) => suma + centavos(r.precio_unitario) * r.cantidad, 0)
  const isv = Math.round((subtotal * Number(tasa)) / 100)

  return { subtotal: subtotal / 100, isv: isv / 100, total: (subtotal + isv) / 100 }
}

export function construirVentaLocal({
  copia,
  sesion,
  dispositivo,
  carrito,
  formaPago = "contado",
  clienteId = null,
  nombreCliente = "",
  rtnComprador = "",
  fechaVencimiento = null,
  nota = "",
  ahora = new Date(),
}) {
  if (!copia) throw new ErrorDeVentaLocal("No hay copia local para vender sin conexión.")

  if (!sesion || !mismoDueno(sesion, copia)) {
    throw new ErrorDeVentaLocal("La copia local es de otro usuario u otra ubicación: conéctate para actualizarla.")
  }

  if (!copia.ubicacion?.vendeSinConexion) {
    throw new ErrorDeVentaLocal("Esta ubicación no está habilitada para vender sin conexión.")
  }

  if (!Array.isArray(carrito) || carrito.length === 0) {
    throw new ErrorDeVentaLocal("La venta está sin productos.")
  }

  if (!["contado", "credito"].includes(formaPago)) {
    throw new ErrorDeVentaLocal("La forma de pago no es válida.")
  }

  const cliente = clienteId ? copia.clientes?.find((c) => c.id === clienteId) : null

  if (formaPago === "credito" && !cliente) {
    throw new ErrorDeVentaLocal("Sin conexión, el crédito es solo para un cliente registrado.")
  }

  if (clienteId && !cliente) {
    throw new ErrorDeVentaLocal("El cliente no está en la copia local.")
  }

  const renglones = carrito.map((linea) => {
    const producto = copia.productos?.find((p) => p.id === linea.productoId)

    if (!producto) throw new ErrorDeVentaLocal("Uno de los productos no está en la copia local.")

    if (!Number.isInteger(linea.cantidad) || linea.cantidad < 1) {
      throw new ErrorDeVentaLocal(`La cantidad de «${producto.nombre}» no es válida.`)
    }

    return {
      producto_id: producto.id,
      codigo: producto.codigo || "",
      nombre: producto.nombre,
      cantidad: linea.cantidad,
      precio_unitario: Number(producto.precio),
    }
  })

  const tasaIsv = Number(copia.empresa?.tasaIsv ?? 15)
  const { total } = totalesDe(renglones, tasaIsv)
  const momento = ahora.toISOString()

  return {
    clave: `off-${dispositivo}-${crypto.randomUUID()}`,
    empresaId: copia.empresaId,
    usuarioAuth: copia.usuarioAuth,
    ubicacionId: copia.ubicacionId,
    dispositivo,
    registradaEn: momento,
    creadaEn: momento,
    renglones,
    tasaIsv,
    totalCobrado: total,
    formaPago,
    clienteId: cliente?.id ?? null,
    nombreCliente: String(nombreCliente || cliente?.nombre || "Consumidor Final").trim(),
    rtnComprador: String(rtnComprador || "").trim(),
    fechaVencimiento: formaPago === "credito" ? fechaVencimiento : null,
    nota: String(nota || ""),
    estado: "pendiente",
    intentos: 0,
  }
}
