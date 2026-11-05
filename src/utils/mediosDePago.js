/*
  Con qué se cobra: un medio con el total (pago único), o dos medios distintos
  (pago mixto): se escribe un importe y el otro se calcula con lo que falta. La
  base admite más medios; el límite de dos es de esta aplicación.

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

export const UNICO = "unico"
export const MIXTO = "mixto"
export const MEDIOS_EN_MIXTO = 2
export const TASA_DE_CARGO = 7

export const etiquetaDelMedio = (medio) =>
  medio === SIN_REGISTRAR ? "Sin registrar" : MEDIO_POR_ID[medio]?.etiqueta || medio

const centavos = (valor) => Math.round(Number(valor) * 100)

const aTexto = (cuantos) => (cuantos / 100).toFixed(2)

/*
  El 7 % que tarjeta y enlace suman a lo que paga el comprador, sobre el importe
  de ese medio. El mismo cálculo que cargo_de_cobro() en la base, que lo comprueba.
*/
export const cargoDe = (medio, monto) =>
  medio === "tarjeta" || medio === "enlace" ? Math.round((centavos(monto) * TASA_DE_CARGO) / 100) / 100 : 0

export const cargoDeCobros = (cobros) =>
  (cobros || []).reduce((suma, c) => suma + centavos(c.cargo || 0), 0) / 100

/* Sin cargo el cobro no lleva el campo: es lo mismo que enviaba antes. */
const conCargo = (cobro) => {
  const cargo = cargoDe(cobro.medio, cobro.monto)

  return cargo > 0 ? { ...cobro, cargo } : cobro
}

const vacios = () => Object.fromEntries(MEDIOS_DE_PAGO.map((m) => [m.id, ""]))

/*
  Nace sin medio elegido, a propósito. Con uno preseleccionado, una venta por
  transferencia que nadie cambió quedaría como efectivo, y el reporte diría algo
  falso sin que nadie lo notara.
*/
export const selectorVacio = (modalidad = UNICO) => ({
  modalidad,
  elegidos: [],
  montos: vacios(),
  referencias: vacios(),
  // El medio cuyo importe escribió el cajero en pago mixto; el otro se calcula.
  escrito: null,
})

const esCalculado = ({ elegidos, escrito }, medio) =>
  elegidos.length === MEDIOS_EN_MIXTO && escrito !== null && escrito !== medio

/* Sale de la resta y no del estado: así sigue al total si este cambia. */
export const importeDe = (valor, medio, total) =>
  esCalculado(valor, medio)
    ? aTexto(Math.max(0, centavos(total) - centavos(valor.montos[valor.escrito])))
    : valor.montos[medio]

export { esCalculado as importeCalculado }

/*
  Cambiar de modalidad empieza de cero: lo que se escribió para la otra no puede
  viajar oculto en esta.
*/
export const cambiarModalidad = (valor, modalidad) =>
  valor.modalidad === modalidad ? valor : selectorVacio(modalidad)

/*
  Elegir un medio. En pago único reemplaza al anterior. En pago mixto alterna, y
  un tercero se rechaza aunque la pantalla no lo hubiera impedido. Lo que se
  suelta pierde su importe y su referencia.
*/
export function elegirMedio(valor, medio) {
  if (valor.modalidad !== MIXTO) return { ...selectorVacio(UNICO), elegidos: [medio] }

  const marcado = !valor.elegidos.includes(medio)

  if (marcado && valor.elegidos.length >= MEDIOS_EN_MIXTO) return valor

  return {
    ...valor,
    elegidos: MEDIOS_DE_PAGO
      .map((m) => m.id)
      .filter((id) => (id === medio ? marcado : valor.elegidos.includes(id))),
    montos: { ...valor.montos, [medio]: "" },
    referencias: { ...valor.referencias, [medio]: "" },
    escrito: valor.escrito === medio ? null : valor.escrito,
  }
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
  Escribir un importe sin que pase del total, también al pegar: lo que se pasa se
  deja en el total, y `ajustado` lo dice. El medio que se escribe manda: el otro
  pasa a calcularse con lo que falta, aunque antes se hubiera escrito a mano.
*/
export function escribirImporte(valor, medio, texto, total) {
  const limpio = limpiarImporte(texto)
  const ajustado = centavos(limpio) > centavos(total)

  return {
    valor: {
      ...valor,
      montos: { ...vacios(), [medio]: ajustado ? aTexto(centavos(total)) : limpio },
      escrito: limpio === "" ? null : medio,
    },
    ajustado,
  }
}

export const escribirReferencia = (valor, medio, texto) => ({
  ...valor,
  referencias: { ...valor.referencias, [medio]: texto },
})

/*
  Lo que eligió el cajero, como lo recibe la base. En pago único el importe es
  siempre el total, aunque el total cambie después. En pago mixto, un medio sin
  importe no viaja, y problemaDelSelector impide confirmar así.
*/
export function cobrosDelSelector(valor, total) {
  const { modalidad, elegidos, referencias } = valor

  if (modalidad !== MIXTO) {
    return elegidos.map((medio) => conCargo({ medio, monto: centavos(total) / 100, referencia: referencias[medio].trim() }))
  }

  return elegidos
    .filter((medio) => centavos(importeDe(valor, medio, total)) > 0)
    .map((medio) => conCargo({ medio, monto: centavos(importeDe(valor, medio, total)) / 100, referencia: referencias[medio].trim() }))
}

/* Cuánto falta por asignar; negativo si sobra porque el total bajó. */
export const faltaPorAsignar = (cobros, total) =>
  (centavos(total) - cobros.reduce((suma, c) => suma + centavos(c.monto), 0)) / 100

/*
  Null si se puede enviar; si no, qué falta. Vale para lo que ya salió del
  selector: también lo usa la venta sin conexión al guardarse.
*/
export function problemaDeCobros(cobros, total) {
  if (cobros.length === 0) return "Elige el medio de pago."
  if (cobros.length > MEDIOS_EN_MIXTO) return `Un pago admite hasta ${MEDIOS_EN_MIXTO} medios.`

  for (const { medio, monto, referencia } of cobros) {
    if (!MEDIO_POR_ID[medio]) return "Un medio de pago no es válido."

    const { etiqueta } = MEDIO_POR_ID[medio]

    if (!Number.isFinite(monto) || monto <= 0) return `El importe de ${etiqueta} debe ser mayor que cero.`
    if (Math.abs(monto * 100 - centavos(monto)) > 1e-6) return `El importe de ${etiqueta} admite dos decimales.`
    if (referencia.length > 120) return `La referencia de ${etiqueta} es demasiado larga.`
  }

  if (faltaPorAsignar(cobros, total) !== 0) return "Los importes de los medios de pago deben sumar el total."

  return null
}

/*
  Lo mismo sobre el selector, que además sabe lo que un cobro no dice: que el
  pago mixto lleva dos medios y que los dos tienen importe.
*/
export function problemaDelSelector(valor, total) {
  if (valor.modalidad === MIXTO) {
    if (valor.elegidos.length !== MEDIOS_EN_MIXTO) return `Elige ${MEDIOS_EN_MIXTO} medios de pago.`

    if (valor.escrito === null) return "Escribe el importe de uno de los medios: el otro se calcula solo."

    const sinImporte = valor.elegidos.find((medio) => centavos(importeDe(valor, medio, total)) <= 0)

    if (sinImporte) return `Baja el otro importe para asignarle saldo a ${MEDIO_POR_ID[sinImporte].etiqueta}.`

  }

  return problemaDeCobros(cobrosDelSelector(valor, total), total)
}

export const textoDeMedios = (medios) =>
  (medios || [])
    .map(({ medio, monto, referencia }) => {
      const base = `${etiquetaDelMedio(medio)} ${Number(monto).toFixed(2)}`

      return referencia ? `${base} (${referencia})` : base
    })
    .join(", ")
