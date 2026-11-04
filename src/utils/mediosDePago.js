/*
  Con qué se cobra: efectivo, transferencia, tarjeta o enlace de pago, o varios
  de ellos con su importe.

  Lo que se comprueba aquí es para avisar antes de enviar. Quien decide es la
  base (0039), que vuelve a comprobar que los importes sumen el total que ella
  misma calculó. Se compara en centavos: sumar decimales binarios daría falsos
  rechazos.
*/

export const MEDIOS_DE_PAGO = [
  { id: "efectivo", etiqueta: "Efectivo", conReferencia: false },
  { id: "transferencia", etiqueta: "Transferencia", conReferencia: true },
  { id: "tarjeta", etiqueta: "Tarjeta", conReferencia: true },
  { id: "enlace", etiqueta: "Enlace de pago", conReferencia: true },
]

export const MIXTO = "mixto"

const MEDIO_POR_ID = Object.fromEntries(MEDIOS_DE_PAGO.map((m) => [m.id, m]))

export const SIN_REGISTRAR = "sin_registrar"

export const etiquetaDelMedio = (medio) =>
  medio === SIN_REGISTRAR ? "Sin registrar" : MEDIO_POR_ID[medio]?.etiqueta || medio

export const llevaReferencia = (medio) => Boolean(MEDIO_POR_ID[medio]?.conReferencia)

const centavos = (valor) => Math.round(Number(valor) * 100)

const vacios = () => Object.fromEntries(MEDIOS_DE_PAGO.map((m) => [m.id, ""]))

/*
  Nace sin medio elegido, a propósito. Con uno preseleccionado, una venta por
  transferencia que nadie cambió quedaría como efectivo, y el reporte diría algo
  falso sin que nadie lo notara.
*/
export const selectorVacio = () => ({ medio: "", montos: vacios(), referencias: vacios() })

/* Lo que eligió el cajero, como los manda la base. */
export function cobrosDelSelector({ medio, montos, referencias }, total) {
  if (!medio) return []

  if (medio !== MIXTO) {
    return [{ medio, monto: centavos(total) / 100, referencia: referencias[medio].trim() }]
  }

  return MEDIOS_DE_PAGO
    .filter((m) => montos[m.id] !== "")
    .map((m) => ({ medio: m.id, monto: Number(montos[m.id]), referencia: referencias[m.id].trim() }))
}

/* Cuánto falta por asignar en un pago mixto; negativo si sobra. */
export const faltaPorAsignar = (cobros, total) =>
  (centavos(total) - cobros.reduce((suma, c) => suma + centavos(c.monto), 0)) / 100

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
