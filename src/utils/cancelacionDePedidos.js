import { etiquetaDelMedio } from "./mediosDePago"
import { formatMoney } from "./format"

/*
  Cancelar un pedido antes de facturarlo (0049, etapa C2a): qué puede hacer
  quien mira, qué se envía desde el formulario y el resumen que se ve antes de
  confirmar. Nada de esto autoriza: la base lo vuelve a comprobar todo.
*/

const IMPORTE = /^\d+(\.\d{1,2})?$/

const centavos = (valor) => Math.round(Number(valor) * 100)

/*
  Lo que este usuario puede devolver de cada medio: el efectivo desde una
  ubicación que puede usar, mientras ninguna liquidación del pedido esté por
  confirmar (0050); lo electrónico, el administrador.
*/
export function mediosQuePuedeDevolver(cancelacion) {
  return cancelacion.dinero.filter(
    (d) =>
      d.pendiente > 0 &&
      (d.medio === "efectivo"
        ? cancelacion.ubicacionesParaReembolsar.length > 0 && !cancelacion.bloqueoDeReembolsos
        : cancelacion.puedeReembolsarElectronico)
  )
}

export function inicial(cancelacion, modo) {
  return {
    motivo: "",
    productosModo: modo === "recibir" ? "todos" : "ninguno",
    cantidades: Object.fromEntries(cancelacion.productos.map((p) => [p.id, String(p.pendiente)])),
    condiciones: Object.fromEntries(cancelacion.productos.map((p) => [p.id, "buen_estado"])),
    ubicacionId: cancelacion.ubicacionesParaRecibir[0]?.id || "",
    nota: "",
    reembolsar: modo === "reembolsar",
    importes: Object.fromEntries(cancelacion.dinero.map((d) => [d.medio, String(d.pendiente)])),
    referencias: {},
    desdeId: cancelacion.ubicacionesParaReembolsar[0]?.id || "",
  }
}

/*
  Lo que se va a enviar y, si algo no vale, el primer problema. `null` en
  `datos` mientras haya un problema.
*/
export function leerFormulario(cancelacion, modo, f) {
  const productos = cancelacion.productos.filter((p) => p.pendiente > 0)
  const conMotivo = modo !== "cancelar" || f.motivo.trim().length >= 5
  const recibe = modo === "recibir" || (modo === "cancelar" && f.productosModo !== "ninguno")
  const devuelve = modo === "reembolsar" || (modo === "cancelar" && f.reembolsar)

  if (!conMotivo) return { problema: "Escribe el motivo de la cancelación (al menos 5 caracteres)." }

  let recepcion = null

  if (recibe) {
    const lineas = []

    for (const p of productos) {
      const texto = f.productosModo === "todos" ? String(p.pendiente) : (f.cantidades[p.id] || "0").trim()

      if (!/^\d+$/.test(texto) || Number(texto) > p.pendiente) {
        return { problema: `La cantidad de «${p.nombre}» debe ser un número entero entre 0 y ${p.pendiente}.` }
      }

      if (Number(texto) > 0) lineas.push({ productoId: p.id, cantidad: Number(texto), condicion: f.condiciones[p.id] })
    }

    if (lineas.length === 0) return { problema: "Indica al menos un producto recibido, o elige «Ninguno»." }

    const ubicacion = cancelacion.ubicacionesParaRecibir.find((u) => u.id === f.ubicacionId)

    if (!ubicacion) return { problema: "Elige la ubicación donde se recibieron los productos." }
    if (ubicacion.otra && f.nota.trim().length < 5) {
      return { problema: `«${ubicacion.nombre}» no es ni el origen ni el destino: escribe una nota que respalde la recepción.` }
    }

    recepcion = { ubicacionId: ubicacion.id, nota: f.nota.trim(), productos: lineas }
  }

  const reembolsos = []

  if (devuelve) {
    for (const d of mediosQuePuedeDevolver(cancelacion)) {
      const texto = (f.importes[d.medio] || "").trim()

      if (texto === "" || Number(texto) === 0) continue

      if (!IMPORTE.test(texto)) return { problema: `El importe de ${etiquetaDelMedio(d.medio)} debe tener hasta dos decimales.` }
      if (centavos(texto) > centavos(d.pendiente)) {
        return { problema: `No se puede devolver más de lo pendiente con ${etiquetaDelMedio(d.medio)} (${formatMoney(d.pendiente)}).` }
      }

      const referencia = (f.referencias[d.medio] || "").trim()

      if (d.medio !== "efectivo" && !referencia) {
        return { problema: `Escribe la referencia de la devolución por ${etiquetaDelMedio(d.medio)}.` }
      }

      // Desde una ubicación que no es ni el origen ni el destino (solo el administrador), con la referencia de la entrega real.
      const desde = d.medio === "efectivo" ? cancelacion.ubicacionesParaReembolsar.find((u) => u.id === f.desdeId) : null

      if (desde?.otra && !referencia) {
        return { problema: `«${desde.nombre}» no es el origen ni el destino: escribe la referencia de la entrega (recibo, quién entregó).` }
      }

      reembolsos.push({ medio: d.medio, importe: Number(texto), ubicacionId: d.medio === "efectivo" ? f.desdeId : null, referencia })
    }

    if (modo === "reembolsar" && reembolsos.length === 0) return { problema: "Escribe cuánto se le devuelve al cliente." }
  }

  if (modo === "recibir" && !recepcion) return { problema: "Indica qué productos se recibieron." }

  return { datos: { motivo: f.motivo.trim(), recepcion, reembolsos } }
}

// El resumen que se ve antes de confirmar.
export function resumen(cancelacion, modo, datos) {
  const lineas = []
  const recibidos = datos.recepcion?.productos.reduce((n, p) => n + p.cantidad, 0) || 0
  const pendientesDeRecibir = cancelacion.productos.reduce((n, p) => n + p.pendiente, 0) - recibidos
  const porDevolver = cancelacion.dinero.reduce((n, d) => n + d.pendiente, 0)
  const devuelto = datos.reembolsos.reduce((n, r) => n + r.importe, 0)

  if (modo === "cancelar") lineas.push("El pedido queda cancelado: ya no se puede facturar.")

  if (modo !== "reembolsar") {
    const ubicacion = cancelacion.ubicacionesParaRecibir.find((u) => u.id === datos.recepcion?.ubicacionId)

    lineas.push(recibidos > 0 ? `Se reciben ${recibidos} unidad(es) en ${ubicacion?.nombre}; solo las de buen estado vuelven a su existencia.` : "No se recibe ningún producto ahora.")
    if (pendientesDeRecibir > 0) lineas.push(`Quedan ${pendientesDeRecibir} unidad(es) por recibir.`)
  }

  if (porDevolver > 0 && modo !== "recibir") {
    lineas.push(devuelto > 0 ? `Se registra la devolución de ${formatMoney(devuelto)} al cliente.` : "No se devuelve dinero ahora.")
    if (porDevolver - devuelto > 0.004) lineas.push(`Quedan ${formatMoney(porDevolver - devuelto)} pendientes de devolver al cliente: no salen de ninguna caja hasta que se devuelvan.`)
  }

  const enEfectivo = datos.reembolsos.find((r) => r.medio === "efectivo")
  const desde = enEfectivo ? cancelacion.ubicacionesParaReembolsar.find((u) => u.id === enEfectivo.ubicacionId) : null

  if (desde) lineas.push(`El efectivo sale de la caja de ${desde.nombre}. Si lo conserva otra ubicación, se lo deberá a ${desde.nombre} en Liquidaciones.`)

  if (modo === "cancelar") lineas.push("Lo cobrado se conserva tal como se registró y ya no se le debe a la ubicación destino.")

  return lineas
}

/*
  Las cifras de un pedido cancelado, solo para mostrarlas: lo que el cliente
  pagó antes de cancelar (con el cargo, que también se le devuelve), lo ya
  devuelto, lo que falta devolver y el saldo que tenía antes de cancelar.
  Nada se le cobra ya: el saldo vigente es cero. Sin los datos de la
  cancelación, lo pagado sale del pedido y lo devuelto queda sin saber (null).
*/
export function cifrasDeCancelado(pedido, cancelacion) {
  const suma = (campo) => (cancelacion?.dinero || []).reduce((n, d) => n + centavos(d[campo] || 0), 0) / 100
  const conDinero = Boolean(cancelacion?.cancelacion)

  return {
    recibido: conDinero ? suma("total") : centavos((pedido.cobrado || 0) + (pedido.cargo || 0)) / 100,
    reembolsado: conDinero ? suma("devuelto") : null,
    porReembolsar: conDinero ? suma("pendiente") : null,
    saldoAntes: Number(pedido.saldo) || 0,
    saldoVigente: 0,
  }
}

// Qué puede completar quien mira en un pedido cancelado.
export function pendientesQuePuedeCompletar(cancelacion) {
  if (!cancelacion?.puedeRegistrar) return { recibir: false, reembolsar: false }

  return {
    recibir: cancelacion.productos.some((p) => p.pendiente > 0) && cancelacion.ubicacionesParaRecibir.length > 0,
    reembolsar: mediosQuePuedeDevolver(cancelacion).length > 0,
  }
}
