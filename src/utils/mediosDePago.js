/*
  Con qué se cobra: efectivo, transferencia, tarjeta o enlace de pago, o varios
  de ellos con su importe.

  Lo que se comprueba aquí es para avisar antes de enviar. Quien decide es la
  base (0039), que vuelve a comprobar que los importes sumen el total que ella
  misma calculó. Se cuenta en centavos: sumar decimales binarios daría falsos
  rechazos.
*/

export const MEDIOS_DE_PAGO = [
  { id: "efectivo", etiqueta: "Efectivo", conReferencia: false },
  { id: "transferencia", etiqueta: "Transferencia", conReferencia: true },
  { id: "tarjeta", etiqueta: "Tarjeta", conReferencia: true },
  { id: "enlace", etiqueta: "Enlace de pago", conReferencia: true },
]

const MEDIO_POR_ID = Object.fromEntries(MEDIOS_DE_PAGO.map((m) => [m.id, m]))

export const SIN_REGISTRAR = "sin_registrar"

export const etiquetaDelMedio = (medio) =>
  medio === SIN_REGISTRAR ? "Sin registrar" : MEDIO_POR_ID[medio]?.etiqueta || medio

export const llevaReferencia = (medio) => Boolean(MEDIO_POR_ID[medio]?.conReferencia)

const centavos = (valor) => Math.round(Number(valor) * 100)

const aTexto = (cuantos) => (cuantos / 100).toFixed(2)

const vacios = () => Object.fromEntries(MEDIOS_DE_PAGO.map((m) => [m.id, ""]))

/*
  Nace sin medio elegido, a propósito. Con uno preseleccionado, una venta por
  transferencia que nadie cambió quedaría como efectivo, y el reporte diría algo
  falso sin que nadie lo notara.
*/
export const selectorVacio = () => ({ elegidos: [], montos: vacios(), referencias: vacios() })

/* Los importes de los demás medios elegidos, en centavos. */
const asignadoSin = ({ elegidos, montos }, medio) =>
  elegidos.filter((m) => m !== medio).reduce((suma, m) => suma + centavos(montos[m]), 0)

/*
  Marcar o desmarcar un medio. Con uno solo, el importe es el total. El que ya
  estaba conserva ese importe al marcar otro, y hay que bajarlo para liberar
  saldo. Desmarcar borra el importe y la referencia de ese medio.
*/
export function alternarMedio(valor, medio, total) {
  const marcado = !valor.elegidos.includes(medio)
  const elegidos = MEDIOS_DE_PAGO
    .map((m) => m.id)
    .filter((id) => (id === medio ? marcado : valor.elegidos.includes(id)))

  const montos = { ...valor.montos, [medio]: "" }
  const referencias = marcado ? valor.referencias : { ...valor.referencias, [medio]: "" }
  const unicoAntes = marcado && valor.elegidos.length === 1 ? valor.elegidos[0] : null
  const unicoAhora = !marcado && elegidos.length === 1 ? elegidos[0] : null

  if (unicoAntes) montos[unicoAntes] = aTexto(centavos(total))
  if (unicoAhora) montos[unicoAhora] = aTexto(centavos(total))

  return { elegidos, montos, referencias }
}

/*
  Lo que llega al campo de un importe, escrito o pegado, como número con punto:
  «1,125.50» y «12,50» se entienden, y lo que no es un importe se descarta. Más
  de dos decimales se cortan.
*/
export function limpiarImporte(texto) {
  let limpio = String(texto ?? "").replace(/[^\d.,]/g, "")

  if (limpio.includes(".")) {
    limpio = limpio.replaceAll(",", "")
  } else if (/,\d{1,2}$/.test(limpio)) {
    limpio = limpio.replace(/,(?=\d{1,2}$)/, ".").replaceAll(",", "")
  } else {
    limpio = limpio.replaceAll(",", "")
  }

  const [enteros, ...decimales] = limpio.split(".")

  return decimales.length ? `${enteros || "0"}.${decimales.join("").slice(0, 2)}` : enteros
}

/*
  Escribir un importe sin que la suma pueda pasar del total, también al pegar:
  lo que se pasa se deja en lo que queda disponible, y `ajustado` lo dice.
*/
export function escribirImporte(valor, medio, texto, total) {
  const limpio = limpiarImporte(texto)
  const disponible = Math.max(0, centavos(total) - asignadoSin(valor, medio))
  const ajustado = centavos(limpio) > disponible
  const monto = ajustado ? aTexto(disponible) : limpio

  return { valor: { ...valor, montos: { ...valor.montos, [medio]: monto } }, ajustado }
}

export const escribirReferencia = (valor, medio, texto) => ({
  ...valor,
  referencias: { ...valor.referencias, [medio]: texto },
})

/*
  Lo que eligió el cajero, como lo recibe la base. Con un solo medio el importe
  es siempre el total, aunque el total cambie después. Un medio marcado sin
  importe no viaja.
*/
export function cobrosDelSelector({ elegidos, montos, referencias }, total) {
  if (elegidos.length === 1) {
    const [medio] = elegidos

    return [{ medio, monto: centavos(total) / 100, referencia: referencias[medio].trim() }]
  }

  return elegidos
    .filter((medio) => centavos(montos[medio]) > 0)
    .map((medio) => ({ medio, monto: centavos(montos[medio]) / 100, referencia: referencias[medio].trim() }))
}

/* Cuánto falta por asignar; negativo si sobra porque el total bajó. */
export const faltaPorAsignar = (cobros, total) =>
  (centavos(total) - cobros.reduce((suma, c) => suma + centavos(c.monto), 0)) / 100

/* El importe que se ve en el formulario: con un solo medio, el total. */
export const importeVisible = ({ elegidos, montos }, medio, total) =>
  elegidos.length === 1 ? aTexto(centavos(total)) : montos[medio]

/* Sin saldo pendiente no se agrega un medio más; el que ya tiene importe se puede editar. */
export const importeBloqueado = (valor, medio, total) =>
  valor.elegidos.length > 1 &&
  centavos(valor.montos[medio]) === 0 &&
  asignadoSin(valor, medio) >= centavos(total)

/* Null si se puede enviar; si no, qué falta. */
export function problemaDeCobros(cobros, total) {
  if (cobros.length === 0) return "Elige el medio de pago."

  for (const { medio, monto, referencia } of cobros) {
    if (!MEDIO_POR_ID[medio]) return "Un medio de pago no es válido."

    const { etiqueta } = MEDIO_POR_ID[medio]

    if (!Number.isFinite(monto) || monto <= 0) return `El importe de ${etiqueta} debe ser mayor que cero.`
    if (Math.abs(monto * 100 - centavos(monto)) > 1e-6) return `El importe de ${etiqueta} admite dos decimales.`
    if (llevaReferencia(medio) && !referencia) return `Escribe la referencia de ${etiqueta}.`
    if (referencia.length > 120) return `La referencia de ${etiqueta} es demasiado larga.`
  }

  if (faltaPorAsignar(cobros, total) !== 0) return "Los importes de los medios de pago deben sumar el total."

  return null
}

export const textoDeMedios = (medios) =>
  (medios || [])
    .map(({ medio, monto, referencia }) => {
      const base = `${etiquetaDelMedio(medio)} ${Number(monto).toFixed(2)}`

      return referencia ? `${base} (${referencia})` : base
    })
    .join(", ")
