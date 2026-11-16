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

export const etiquetaDelMedio = (medio) =>
  medio === SIN_REGISTRAR ? "Sin registrar" : MEDIO_POR_ID[medio]?.etiqueta || medio

const centavos = (valor) => Math.round(Number(valor) * 100)

const aTexto = (cuantos) => (cuantos / 100).toFixed(2)

/*
  El porcentaje adicional que tarjeta y enlace suman a lo que paga el comprador.
  Lo fija el administrador en Configuración y llega con la empresa como
  `{ tarjeta, enlace }` (0044): aquí no hay ninguno escrito. Sin él no se puede
  cobrar con ese medio, porque el servidor rechazaría cualquier otro.
*/
export const llevaCargo = (medio) => medio === "tarjeta" || medio === "enlace"

export const tasaValida = (tasa) =>
  typeof tasa === "number" && Number.isFinite(tasa) && tasa >= 0 && tasa <= 100 && Math.round(tasa * 100) === tasa * 100

/*
  Sobre el importe de ese medio. El mismo cálculo que cargo_de_cobro() en la base,
  que lo comprueba: en enteros, porque 115 × 1.7 en binario da 195.49999… y no 195.5.
*/
export const cargoDe = (medio, monto, tasa) =>
  llevaCargo(medio) ? Math.round((centavos(monto) * Math.round(Number(tasa) * 100)) / 10000) / 100 : 0

export const cargoDeCobros = (cobros) =>
  (cobros || []).reduce((suma, c) => suma + centavos(c.cargo || 0), 0) / 100

// Lo escrito en Configuración: «1.7», «1,7», «2». De 0 a 100 con hasta dos decimales; null si no vale.
export function leerPorcentaje(texto) {
  const limpio = String(texto ?? "").trim().replace(",", ".")

  if (!/^\d{1,3}(\.\d{1,2})?$/.test(limpio)) return null

  const valor = Number(limpio)

  return valor <= 100 ? valor : null
}

// «1.7 %», «2 %».
export const textoDePorcentaje = (tasa) => `${Number(tasa)} %`

/*
  Qué porcentaje se cobró, para la etiqueta del cargo: uno si fue uno solo; si
  tarjeta y enlace llevaron distintos, cada uno con su medio. Vacío si no se sabe,
  como en lo cobrado antes de la 0044.
*/
export function textoDeTasas(cobros) {
  const conCargo = (cobros || []).filter((c) => llevaCargo(c.medio) && Number(c.cargo) > 0)

  if (conCargo.length === 0 || !conCargo.every((c) => tasaValida(c.tasa))) return ""

  const distintas = new Set(conCargo.map((c) => c.tasa))

  if (distintas.size === 1) return textoDePorcentaje(conCargo[0].tasa)

  return conCargo.map((c) => `${MEDIO_POR_ID[c.medio].etiqueta} ${textoDePorcentaje(c.tasa)}`).join(", ")
}

export const etiquetaDelCargo = (tasas) => (tasas ? `Cargo por medio de pago (${tasas})` : "Cargo por medio de pago")

/*
  Tarjeta y enlace viajan con su tasa y su cargo, también si el cargo es 0: así la
  base guarda con qué tasa se cobró. Sin una tasa válida no llevan ninguno de los
  dos, y problemaDeCobros() impide enviarlos.
*/
const conCargo = (cobro, tasas) => {
  if (!llevaCargo(cobro.medio)) return cobro

  const tasa = tasas?.[cobro.medio]

  return tasaValida(tasa) ? { ...cobro, tasa, cargo: cargoDe(cobro.medio, cobro.monto, tasa) } : cobro
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
  // En pago mixto, el primero que se eligió: lleva el total hasta que se escriba un importe.
  primero: null,
})

const esCalculado = ({ elegidos, escrito, primero }, medio) => {
  if (!elegidos.includes(medio)) return false

  return escrito === null ? medio === primero : escrito !== medio
}

/*
  Sale de la resta y no del estado: así sigue al total si este cambia. Como en
  pago único, el primer medio lleva el total y su cargo sin escribir nada.
*/
export function importeDe(valor, medio, total) {
  if (!esCalculado(valor, medio)) return valor.montos[medio]

  const escrito = valor.escrito === null ? 0 : centavos(valor.montos[valor.escrito])

  return aTexto(Math.max(0, centavos(total) - escrito))
}

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

  const elegidos = MEDIOS_DE_PAGO
    .map((m) => m.id)
    .filter((id) => (id === medio ? marcado : valor.elegidos.includes(id)))

  /*
    Al soltar uno, el que queda vuelve a llevar el total: lo escrito era para
    repartir entre dos, y ya no hay entre quiénes.
  */
  if (!marcado) {
    return {
      ...valor,
      elegidos,
      montos: vacios(),
      referencias: { ...valor.referencias, [medio]: "" },
      escrito: null,
      primero: elegidos[0] ?? null,
    }
  }

  return { ...valor, elegidos, primero: valor.primero ?? medio }
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
  importe no viaja, y problemaDelSelector impide confirmar así. `tasas` es el
  porcentaje adicional vigente de la empresa: { tarjeta, enlace }.
*/
export function cobrosDelSelector(valor, total, tasas) {
  const { modalidad, elegidos, referencias } = valor

  if (modalidad !== MIXTO) {
    return elegidos.map((medio) => conCargo({ medio, monto: centavos(total) / 100, referencia: referencias[medio].trim() }, tasas))
  }

  return elegidos
    .filter((medio) => centavos(importeDe(valor, medio, total)) > 0)
    .map((medio) =>
      conCargo({ medio, monto: centavos(importeDe(valor, medio, total)) / 100, referencia: referencias[medio].trim() }, tasas)
    )
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

  for (const cobro of cobros) {
    const { medio, monto, referencia } = cobro

    if (!MEDIO_POR_ID[medio]) return "Un medio de pago no es válido."

    const { etiqueta } = MEDIO_POR_ID[medio]

    if (!Number.isFinite(monto) || monto <= 0) return `El importe de ${etiqueta} debe ser mayor que cero.`
    if (Math.abs(monto * 100 - centavos(monto)) > 1e-6) return `El importe de ${etiqueta} admite dos decimales.`
    if (referencia.length > 120) return `La referencia de ${etiqueta} es demasiado larga.`

    if (llevaCargo(medio) && !tasaValida(cobro.tasa)) {
      return `No se pudo leer el porcentaje adicional de ${etiqueta}. Actualiza la página con conexión e inténtalo de nuevo.`
    }
  }

  if (faltaPorAsignar(cobros, total) !== 0) return "Los importes de los medios de pago deben sumar el total."

  return null
}

/*
  Lo mismo sobre el selector, que además sabe lo que un cobro no dice: que el
  pago mixto lleva dos medios y que los dos tienen importe.
*/
export function problemaDelSelector(valor, total, tasas) {
  if (valor.modalidad === MIXTO) {
    if (valor.elegidos.length !== MEDIOS_EN_MIXTO) return `Elige ${MEDIOS_EN_MIXTO} medios de pago.`

    if (valor.escrito === null) return "Escribe el importe de uno de los medios: el otro se calcula solo."

    const sinImporte = valor.elegidos.find((medio) => centavos(importeDe(valor, medio, total)) <= 0)

    if (sinImporte) return `Baja el otro importe para asignarle saldo a ${MEDIO_POR_ID[sinImporte].etiqueta}.`

  }

  return problemaDeCobros(cobrosDelSelector(valor, total, tasas), total)
}

/*
  Cada medio con su importe y su referencia, y el cargo con la tasa con la que se
  cobró. Lo cobrado antes de la 0044 no guarda la tasa: va solo el cargo.
*/
export const textoDeMedios = (medios) =>
  (medios || [])
    .map(({ medio, monto, referencia, cargo, tasa }) => {
      const base = `${etiquetaDelMedio(medio)} ${Number(monto).toFixed(2)}`
      const conReferencia = referencia ? `${base} (${referencia})` : base

      if (!(Number(cargo) > 0)) return conReferencia

      const conTasa = tasaValida(tasa) ? ` al ${textoDePorcentaje(tasa)}` : ""

      return `${conReferencia} + cargo ${Number(cargo).toFixed(2)}${conTasa}`
    })
    .join(", ")
