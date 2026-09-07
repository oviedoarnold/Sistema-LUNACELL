import { describe, it, expect } from "vitest"

import {
  padCorrelativo,
  formatDocumentNumber,
  isFiscalConfigured,
  getFiscalStatus,
  buildFiscalSnapshot,
  UMBRAL_AVISO,
} from "./fiscal"

const fiscalValido = {
  rtn: "08019012345678",
  cai: "A1B2C3-D4E5F6-A7B8C9-D1E2F3-A4B5C6-D7",
  establecimiento: "000",
  puntoEmision: "001",
  tipoDocumento: "01",
  rangoDesde: 1,
  rangoHasta: 5000,
  fechaLimiteEmision: "2027-01-31",
}

const HOY = new Date("2026-08-28T12:00:00")

describe("padCorrelativo", () => {
  it("rellena a ocho dígitos", () => {
    expect(padCorrelativo(1)).toBe("00000001")
    expect(padCorrelativo(1234)).toBe("00001234")
  })

  it("no recorta un correlativo ya largo", () => {
    expect(padCorrelativo(123456789)).toBe("123456789")
  })

  it("devuelve ceros ante un valor inválido", () => {
    expect(padCorrelativo(null)).toBe("00000000")
    expect(padCorrelativo(-5)).toBe("00000000")
    expect(padCorrelativo("abc")).toBe("00000000")
  })
})

describe("formatDocumentNumber", () => {
  it("arma la estructura completa", () => {
    expect(formatDocumentNumber(1, fiscalValido)).toBe("000-001-01-00000001")
  })

  it("usa valores por defecto si faltan los prefijos", () => {
    expect(formatDocumentNumber(42, {})).toBe("000-001-01-00000042")
  })

  it("normaliza prefijos cortos", () => {
    const numero = formatDocumentNumber(7, {
      establecimiento: "5",
      puntoEmision: "2",
      tipoDocumento: "1",
    })

    expect(numero).toBe("005-002-01-00000007")
  })

  it("descarta caracteres que no son dígitos", () => {
    const numero = formatDocumentNumber(7, { establecimiento: "A-1" })
    expect(numero).toBe("001-001-01-00000007")
  })
})

describe("isFiscalConfigured", () => {
  it("acepta una configuración completa", () => {
    expect(isFiscalConfigured(fiscalValido)).toBe(true)
  })

  it("rechaza si falta el CAI", () => {
    expect(isFiscalConfigured({ ...fiscalValido, cai: "" })).toBe(false)
  })

  it("rechaza si falta la fecha límite", () => {
    expect(
      isFiscalConfigured({ ...fiscalValido, fechaLimiteEmision: "" })
    ).toBe(false)
  })

  it("rechaza si no hay rango", () => {
    expect(isFiscalConfigured({ ...fiscalValido, rangoHasta: 0 })).toBe(false)
  })

  it("rechaza valores ausentes", () => {
    expect(isFiscalConfigured(null)).toBe(false)
    expect(isFiscalConfigured({})).toBe(false)
  })
})

describe("getFiscalStatus", () => {
  it("avisa cuando no hay datos fiscales", () => {
    const estado = getFiscalStatus({}, 1, HOY)

    expect(estado.code).toBe("sin-configurar")
    expect(estado.level).toBe("aviso")
  })

  it("da rango vigente en el caso normal", () => {
    const estado = getFiscalStatus(fiscalValido, 100, HOY)

    expect(estado.code).toBe("ok")
    expect(estado.level).toBe("ok")
    expect(estado.restantes).toBe(4900)
  })

  it("bloquea cuando el CAI ya venció", () => {
    const vencido = { ...fiscalValido, fechaLimiteEmision: "2026-01-31" }
    const estado = getFiscalStatus(vencido, 100, HOY)

    expect(estado.code).toBe("vencido")
    expect(estado.level).toBe("bloqueo")
  })

  it("acepta facturar el mismo día del vencimiento", () => {
    const limite = { ...fiscalValido, fechaLimiteEmision: "2026-08-28" }
    const estado = getFiscalStatus(limite, 100, HOY)

    expect(estado.level).not.toBe("bloqueo")
  })

  it("bloquea al agotarse el rango", () => {
    const estado = getFiscalStatus(fiscalValido, 5001, HOY)

    expect(estado.code).toBe("agotado")
    expect(estado.level).toBe("bloqueo")
  })

  it("permite emitir exactamente el último del rango", () => {
    const estado = getFiscalStatus(fiscalValido, 5000, HOY)

    expect(estado.level).not.toBe("bloqueo")
    expect(estado.restantes).toBe(0)
  })

  it("bloquea un correlativo anterior al rango", () => {
    const estado = getFiscalStatus(
      { ...fiscalValido, rangoDesde: 100 },
      50,
      HOY
    )

    expect(estado.code).toBe("fuera-de-rango")
    expect(estado.level).toBe("bloqueo")
  })

  it("avisa cuando quedan pocas facturas", () => {
    const estado = getFiscalStatus(
      fiscalValido,
      fiscalValido.rangoHasta - UMBRAL_AVISO,
      HOY
    )

    expect(estado.code).toBe("por-agotarse")
    expect(estado.level).toBe("aviso")
  })

  it("el vencimiento pesa más que el rango disponible", () => {
    const vencido = { ...fiscalValido, fechaLimiteEmision: "2020-01-01" }
    const estado = getFiscalStatus(vencido, 1, HOY)

    expect(estado.code).toBe("vencido")
  })
})

describe("buildFiscalSnapshot", () => {
  it("no genera datos si la configuración está incompleta", () => {
    expect(buildFiscalSnapshot({}, 1)).toBeNull()
  })

  it("congela los datos dentro de la factura", () => {
    const snapshot = buildFiscalSnapshot(fiscalValido, 250)

    expect(snapshot.cai).toBe(fiscalValido.cai)
    expect(snapshot.correlativo).toBe(250)
    expect(snapshot.numero).toBe("000-001-01-00000250")
    expect(snapshot.rangoHasta).toBe(5000)
  })

  it("la copia sobrevive a un cambio posterior del CAI", () => {
    const empresa = { ...fiscalValido }
    const snapshot = buildFiscalSnapshot(empresa, 10)

    empresa.cai = "OTRO-CAI-DISTINTO"

    expect(snapshot.cai).toBe(fiscalValido.cai)
  })
})
