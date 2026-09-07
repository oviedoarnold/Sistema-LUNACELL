import { describe, it, expect } from "vitest"

import {
  formatMoney,
  toISODate,
  toISODateInDays,
  formatDateForDisplay,
  MONEDA_POR_DEFECTO,
} from "./format"

describe("formatMoney", () => {
  it("usa lempiras por defecto y dos decimales", () => {
    expect(formatMoney(1500)).toBe("L 1,500.00")
  })

  it("acepta otra moneda", () => {
    expect(formatMoney(20, "$")).toBe("$ 20.00")
  })

  it("separa los miles", () => {
    expect(formatMoney(1234567.5)).toBe("L 1,234,567.50")
  })

  it("trata los valores ausentes como cero", () => {
    expect(formatMoney(null)).toBe("L 0.00")
    expect(formatMoney(undefined)).toBe("L 0.00")
    expect(formatMoney("no es número")).toBe("L 0.00")
  })

  it("conserva el signo negativo", () => {
    expect(formatMoney(-50)).toBe("L -50.00")
  })

  it("expone la moneda por defecto", () => {
    expect(MONEDA_POR_DEFECTO).toBe("L")
  })
})

describe("toISODate", () => {
  it("da el formato año-mes-día con relleno", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05")
  })

  it("no se corre de mes en diciembre", () => {
    expect(toISODate(new Date(2026, 11, 31))).toBe("2026-12-31")
  })
})

describe("toISODateInDays", () => {
  const base = new Date(2026, 7, 28)

  it("suma los días pedidos", () => {
    expect(toISODateInDays(30, base)).toBe("2026-09-27")
  })

  it("cruza el fin de mes correctamente", () => {
    expect(toISODateInDays(4, new Date(2026, 0, 30))).toBe("2026-02-03")
  })

  it("cruza el fin de año correctamente", () => {
    expect(toISODateInDays(5, new Date(2026, 11, 30))).toBe("2027-01-04")
  })

  it("con cero días devuelve la fecha base", () => {
    expect(toISODateInDays(0, base)).toBe("2026-08-28")
  })

  it("acepta días negativos", () => {
    expect(toISODateInDays(-1, base)).toBe("2026-08-27")
  })

  it("no muta la fecha base recibida", () => {
    const original = new Date(2026, 7, 28)
    toISODateInDays(45, original)

    expect(toISODate(original)).toBe("2026-08-28")
  })
})

describe("formatDateForDisplay", () => {
  it("usa el formato de dos dígitos por parte", () => {
    expect(formatDateForDisplay(new Date(2026, 7, 28))).toMatch(
      /^\d{2}\/\d{2}\/\d{4}$/
    )
  })
})
