import { etiquetaDelMedio } from "./mediosDePago"
import { formatMoney } from "./format"

/*
  Devoluciones después de facturar (0052, etapas C4 y C5): lo que se envía
  desde el formulario y las cifras que se ven antes de confirmar.

  Las cifras repiten la cuenta de registrar_devolucion_de_venta() —precio
  facturado por cantidad más su ISV, el cargo solo con lo último, el saldo del
  crédito primero— solo para enseñarlas: la base las vuelve a calcular y es la
  que registra. Se cuenta en centavos para no arrastrar decimales binarios.
*/

export const MOTIVO_MINIMO_DEVOLUCION = 5

export const CONDICIONES = [
  { id: "buen_estado", etiqueta: "Buen estado" },
  { id: "danado", etiqueta: "Dañado" },
]

const IMPORTE = /^\d+(\.\d{1,2})?$/
const CANTIDAD = /^\d+$/

const centavos = (valor) => Math.round(Number(valor || 0) * 100)
const aDinero = (cuantos) => cuantos / 100

// La respuesta de devolucion_de_venta() con nombres de la pantalla y números de verdad.
export function aDevolucionDeApp(datos) {
  const d = datos?.dinero || {}

  return {
    puedeRegistrar: Boolean(datos?.puede_registrar),
    bloqueo: datos?.bloqueo || "",
    puedeReembolsarElectronico: Boolean(datos?.puede_reembolsar_electronico),
    productos: (datos?.productos || []).map((p) => ({
      id: p.producto_id,
      nombre: p.nombre,
      vendido: Number(p.vendido),
      devuelto: Number(p.devuelto),
      disponible: Number(p.disponible),
      valorUnitario: Number(p.valor_unitario),
    })),
    dinero: {
      formaPago: d.forma_pago,
      total: Number(d.total || 0),
      cargoOriginal: Number(d.cargo_original || 0),
      devuelto: Number(d.devuelto || 0),
      cargoDevuelto: Number(d.cargo_devuelto || 0),
      neto: Number(d.neto || 0),
      pagado: Number(d.pagado || 0),
      saldo: Number(d.saldo || 0),
      ajusteCredito: Number(d.ajuste_credito || 0),
      aFavor: Number(d.a_favor || 0),
      reembolsado: Number(d.reembolsado || 0),
      pendiente: Number(d.pendiente || 0),
      medios: (d.medios || []).map((m) => ({ medio: m.medio, cobrado: Number(m.cobrado), reembolsado: Number(m.reembolsado) })),
    },
    devoluciones: datos?.devoluciones || [],
    reembolsos: datos?.reembolsos || [],
    ubicaciones: datos?.ubicaciones_para_recibir || [],
  }
}

export const formularioInicial = (info) => ({
  motivo: "",
  ubicacionId: info.ubicaciones[0]?.id || "",
  cantidades: Object.fromEntries(info.productos.map((p) => [p.id, ""])),
  condiciones: Object.fromEntries(info.productos.map((p) => [p.id, "buen_estado"])),
})

/*
  Lo que vale lo elegido: por producto, su parte del subtotal facturado más su
  ISV (la proporción total/subtotal de la factura). Si con esto vuelve todo lo
  que quedaba, se devuelve también el cargo y el valor cierra el total.
*/
export function cifrasDeLaDevolucion(info, venta, lineas) {
  const subtotalDe = (id) =>
    (venta.items || []).filter((item) => item.productId === id).reduce((n, item) => n + Number(item.subtotal || 0), 0)
  const proporcion = Number(venta.subtotal) > 0 ? Number(venta.total) / Number(venta.subtotal) : 1
  const elegido = Object.fromEntries(lineas.map((l) => [l.producto_id, l.cantidad]))

  let valor = lineas.reduce((n, l) => {
    const producto = info.productos.find((p) => p.id === l.producto_id)

    return n + Math.round((subtotalDe(l.producto_id) * l.cantidad * proporcion * 100) / producto.vendido)
  }, 0)

  const esLaUltima = info.productos.every((p) => (elegido[p.id] || 0) >= p.disponible)
  const cargo = esLaUltima ? centavos(info.dinero.cargoOriginal) - centavos(info.dinero.cargoDevuelto) : 0

  if (esLaUltima) valor = centavos(info.dinero.total) - centavos(info.dinero.devuelto)

  const ajuste = info.dinero.formaPago === "credito" ? Math.min(valor + cargo, centavos(info.dinero.saldo)) : 0

  return {
    valor: aDinero(valor),
    cargo: aDinero(cargo),
    ajuste: aDinero(ajuste),
    aFavor: aDinero(valor + cargo - ajuste),
    nuevoNeto: aDinero(centavos(info.dinero.neto) - valor),
    nuevoSaldo: aDinero(centavos(info.dinero.saldo) - ajuste),
    esLaUltima,
  }
}

/*
  Lo que se va a enviar y sus cifras, o el primer problema. `datos` es null
  mientras haya un problema.
*/
export function leerDevolucion(info, venta, f) {
  if (f.motivo.trim().length < MOTIVO_MINIMO_DEVOLUCION) {
    return { problema: `Escribe el motivo de la devolución (al menos ${MOTIVO_MINIMO_DEVOLUCION} caracteres).` }
  }

  const lineas = []

  for (const p of info.productos.filter((x) => x.disponible > 0)) {
    const texto = String(f.cantidades[p.id] || "0").trim()

    if (!CANTIDAD.test(texto) || Number(texto) > p.disponible) {
      return { problema: `La cantidad de «${p.nombre}» debe ser un número entero entre 0 y ${p.disponible}.` }
    }

    if (Number(texto) > 0) lineas.push({ producto_id: p.id, cantidad: Number(texto), condicion: f.condiciones[p.id] })
  }

  if (lineas.length === 0) return { problema: "Indica al menos un producto devuelto." }
  if (!info.ubicaciones.some((u) => u.id === f.ubicacionId)) return { problema: "Elige dónde se recibieron los productos." }

  return {
    datos: { motivo: f.motivo.trim(), productos: lineas, ubicacionId: f.ubicacionId },
    cifras: cifrasDeLaDevolucion(info, venta, lineas),
  }
}

// El resumen que se ve antes de confirmar.
export function resumenDeDevolucion(info, { datos, cifras }, moneda) {
  const ubicacion = info.ubicaciones.find((u) => u.id === datos.ubicacionId)?.nombre || ""
  const buenas = datos.productos.filter((l) => l.condicion === "buen_estado").reduce((n, l) => n + l.cantidad, 0)
  const lineas = [
    `La venta baja ${formatMoney(cifras.valor, moneda)} (precio facturado más su ISV): su importe queda en ${formatMoney(cifras.nuevoNeto, moneda)}.`,
    buenas > 0
      ? `${buenas} unidad(es) en buen estado vuelven a la existencia de ${ubicacion}; lo dañado queda registrado sin sumar.`
      : "Lo devuelto está dañado: queda registrado y no vuelve a la existencia.",
  ]

  if (cifras.cargo > 0) lineas.push(`Vuelve todo lo que quedaba: también se devuelve el cargo de ${formatMoney(cifras.cargo, moneda)}.`)
  if (cifras.ajuste > 0) lineas.push(`El saldo de esta factura baja ${formatMoney(cifras.ajuste, moneda)} y queda en ${formatMoney(cifras.nuevoSaldo, moneda)}.`)
  if (cifras.aFavor > 0) {
    lineas.push(`Quedan ${formatMoney(cifras.aFavor, moneda)} a favor del cliente, por reembolsar: no salen de ninguna caja hasta que se registre el reembolso.`)
  }

  lineas.push("La factura conserva su número y su historia; la devolución queda registrada aparte y no se puede modificar.")

  return lineas
}

/*
  Con qué se puede reembolsar y hasta cuánto: lo pendiente a favor del
  cliente; en contado, además, no más de lo cobrado por ese medio. El efectivo
  sale de la ubicación que facturó; lo electrónico, solo el administrador.
*/
export function mediosParaReembolsar(info) {
  const pendiente = centavos(info.dinero.pendiente)

  if (pendiente <= 0) return []

  const candidatos =
    info.dinero.formaPago === "contado"
      ? info.dinero.medios.map((m) => ({ medio: m.medio, tope: Math.min(pendiente, centavos(m.cobrado) - centavos(m.reembolsado)) }))
      : ["efectivo", "transferencia", "tarjeta", "enlace"].map((medio) => ({ medio, tope: pendiente }))

  return candidatos
    .filter((m) => m.tope > 0 && (m.medio === "efectivo" || info.puedeReembolsarElectronico))
    .map((m) => ({ medio: m.medio, tope: aDinero(m.tope) }))
}

export function leerReembolso(info, f) {
  const medio = mediosParaReembolsar(info).find((m) => m.medio === f.medio)
  const texto = String(f.importe || "").trim()

  if (!medio) return { problema: "Elige con qué se devuelve el dinero." }
  if (!IMPORTE.test(texto) || centavos(texto) <= 0) return { problema: "Escribe un importe mayor que cero, con hasta dos decimales." }
  if (centavos(texto) > centavos(medio.tope)) {
    return { problema: `Con ${etiquetaDelMedio(medio.medio)} se pueden devolver hasta ${formatMoney(medio.tope)}.` }
  }
  if (medio.medio !== "efectivo" && !f.referencia.trim()) {
    return { problema: `Escribe la referencia de la devolución por ${etiquetaDelMedio(medio.medio)}.` }
  }

  return { datos: { medio: medio.medio, importe: Number(texto), referencia: f.referencia.trim() } }
}
