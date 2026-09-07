/*
  Datos fiscales de la factura.

  En Honduras el SAR exige que una factura
  autorizada lleve el CAI, el rango de
  numeración autorizado y la fecha límite
  de emisión.

  ⚠ La normativa cambia. Estos campos y su
  formato deben confirmarse con un contador
  o con el SAR antes de facturar formalmente.
  El sistema los almacena y los valida, pero
  no sustituye esa verificación.
*/

export const FISCAL_VACIO = {
  rtn: "",
  cai: "",
  establecimiento: "000",
  puntoEmision: "001",
  tipoDocumento: "01",
  rangoDesde: "",
  rangoHasta: "",
  fechaLimiteEmision: "",
}

/*
  Avisa cuando quedan pocos correlativos
  para que dé tiempo de tramitar el
  siguiente rango.
*/
export const UMBRAL_AVISO = 50

function soloDigitos(value, largo, porDefecto) {
  const limpio = String(value ?? "").replace(/\D/g, "")

  if (!limpio) {
    return porDefecto
  }

  return limpio.slice(-largo).padStart(largo, "0")
}

export function padCorrelativo(correlativo) {
  const n = Number(correlativo)

  if (!Number.isFinite(n) || n < 0) {
    return "00000000"
  }

  return String(Math.trunc(n)).padStart(8, "0")
}

/*
  Arma el número con la estructura
  establecimiento-punto-tipo-correlativo.
*/
export function formatDocumentNumber(correlativo, fiscal = {}) {
  const establecimiento = soloDigitos(fiscal.establecimiento, 3, "000")
  const puntoEmision = soloDigitos(fiscal.puntoEmision, 3, "001")
  const tipoDocumento = soloDigitos(fiscal.tipoDocumento, 2, "01")

  return `${establecimiento}-${puntoEmision}-${tipoDocumento}-${padCorrelativo(
    correlativo
  )}`
}

/*
  Solo se considera configurado si están
  los tres datos que vuelven fiscal a la
  factura.
*/
export function isFiscalConfigured(fiscal) {
  if (!fiscal) {
    return false
  }

  return Boolean(
    String(fiscal.cai || "").trim() &&
      Number(fiscal.rangoHasta) > 0 &&
      String(fiscal.fechaLimiteEmision || "").trim()
  )
}

function parseFechaLimite(valor) {
  if (!valor) {
    return null
  }

  const fecha = new Date(`${valor}T23:59:59`)

  return Number.isNaN(fecha.getTime()) ? null : fecha
}

/*
  Estado del rango autorizado frente al
  correlativo que se va a emitir.

  level: "ok" | "aviso" | "bloqueo"
*/
export function getFiscalStatus(fiscal, correlativo, hoy = new Date()) {
  if (!isFiscalConfigured(fiscal)) {
    return {
      level: "aviso",
      code: "sin-configurar",
      restantes: null,
      message:
        "Sin datos fiscales. Las facturas se emiten con numeración interna, no autorizada.",
    }
  }

  const fechaLimite = parseFechaLimite(fiscal.fechaLimiteEmision)

  if (fechaLimite && hoy > fechaLimite) {
    return {
      level: "bloqueo",
      code: "vencido",
      restantes: 0,
      message: `El CAI venció el ${fiscal.fechaLimiteEmision}. Debes tramitar uno nuevo antes de seguir facturando.`,
    }
  }

  const desde = Number(fiscal.rangoDesde) || 0
  const hasta = Number(fiscal.rangoHasta) || 0
  const actual = Number(correlativo) || 0

  if (actual < desde) {
    return {
      level: "bloqueo",
      code: "fuera-de-rango",
      restantes: hasta - actual,
      message: `El correlativo ${actual} es anterior al rango autorizado, que inicia en ${desde}.`,
    }
  }

  if (actual > hasta) {
    return {
      level: "bloqueo",
      code: "agotado",
      restantes: 0,
      message: `Se agotó el rango autorizado, que terminaba en ${hasta}.`,
    }
  }

  const restantes = hasta - actual

  if (restantes <= UMBRAL_AVISO) {
    return {
      level: "aviso",
      code: "por-agotarse",
      restantes,
      message: `Quedan ${restantes} facturas del rango autorizado. Conviene tramitar el siguiente.`,
    }
  }

  return {
    level: "ok",
    code: "ok",
    restantes,
    message: `Rango vigente. Quedan ${restantes} facturas autorizadas.`,
  }
}

/*
  Congela los datos fiscales dentro de la
  factura al emitirla.

  Es a propósito una copia y no una
  referencia: cuando el CAI cambie, las
  facturas viejas deben seguir mostrando
  el que tenían.
*/
export function buildFiscalSnapshot(fiscal, correlativo) {
  if (!isFiscalConfigured(fiscal)) {
    return null
  }

  return {
    cai: String(fiscal.cai).trim(),
    rtn: String(fiscal.rtn || "").trim(),
    establecimiento: soloDigitos(fiscal.establecimiento, 3, "000"),
    puntoEmision: soloDigitos(fiscal.puntoEmision, 3, "001"),
    tipoDocumento: soloDigitos(fiscal.tipoDocumento, 2, "01"),
    rangoDesde: Number(fiscal.rangoDesde) || 0,
    rangoHasta: Number(fiscal.rangoHasta) || 0,
    fechaLimiteEmision: fiscal.fechaLimiteEmision,
    correlativo: Number(correlativo) || 0,
    numero: formatDocumentNumber(correlativo, fiscal),
  }
}
