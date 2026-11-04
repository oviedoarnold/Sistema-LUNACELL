import { describe, it, expect } from "vitest"

import {
  MIXTO,
  cobrosDelSelector,
  etiquetaDelMedio,
  faltaPorAsignar,
  problemaDeCobros,
  selectorVacio,
  textoDeMedios,
} from "./mediosDePago"

const con = (cambios) => ({ ...selectorVacio(), ...cambios })

describe("cobrosDelSelector", () => {
  it("sin medio elegido no hay cobros: nada se preselecciona", () => {
    expect(selectorVacio().medio).toBe("")
    expect(cobrosDelSelector(selectorVacio(), 100)).toEqual([])
  })

  it("un solo medio lleva el total, redondeado a centavos", () => {
    expect(cobrosDelSelector(con({ medio: "efectivo" }), 115.004)).toEqual([{ medio: "efectivo", monto: 115, referencia: "" }])
  })

  it("el pago mixto solo lleva los medios con importe, y limpia la referencia", () => {
    const valor = con({
      medio: MIXTO,
      montos: { efectivo: "15", transferencia: "", tarjeta: "100", enlace: "" },
      referencias: { efectivo: "", transferencia: "", tarjeta: "  AUT-1 ", enlace: "" },
    })

    expect(cobrosDelSelector(valor, 115)).toEqual([
      { medio: "efectivo", monto: 15, referencia: "" },
      { medio: "tarjeta", monto: 100, referencia: "AUT-1" },
    ])
  })
})

describe("faltaPorAsignar", () => {
  it("compara en centavos, sin errores de decimales binarios", () => {
    expect(faltaPorAsignar([{ monto: 0.1 }, { monto: 0.2 }], 0.3)).toBe(0)
  })

  it("dice cuánto falta o cuánto sobra", () => {
    expect(faltaPorAsignar([{ monto: 90 }], 100)).toBe(10)
    expect(faltaPorAsignar([{ monto: 110 }], 100)).toBe(-10)
  })
})

describe("problemaDeCobros", () => {
  const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })

  it("sin problema devuelve null", () => {
    expect(problemaDeCobros([efectivo(15), { medio: "tarjeta", monto: 100, referencia: "A" }], 115)).toBeNull()
    expect(problemaDeCobros([efectivo(0.1), { medio: "enlace", monto: 0.2, referencia: "L" }], 0.3)).toBeNull()
  })

  it.each([
    ["sin medios", [], 10, /elige el medio/i],
    ["medio desconocido", [{ medio: "cheque", monto: 10, referencia: "" }], 10, /no es válido/i],
    ["importe en cero", [efectivo(0)], 0, /mayor que cero/i],
    ["importe negativo", [efectivo(-1)], 10, /mayor que cero/i],
    ["importe que no es número", [efectivo(Number.NaN)], 10, /mayor que cero/i],
    ["más de dos decimales", [efectivo(9.999)], 10, /dos decimales/i],
    ["sin referencia", [{ medio: "tarjeta", monto: 10, referencia: "" }], 10, /referencia de tarjeta/i],
    ["referencia larga", [{ medio: "tarjeta", monto: 10, referencia: "x".repeat(121) }], 10, /demasiado larga/i],
    ["no suman", [efectivo(9)], 10, /deben sumar/i],
  ])("%s", (_, cobros, total, mensaje) => {
    expect(problemaDeCobros(cobros, total)).toMatch(mensaje)
  })
})

describe("cómo se escriben", () => {
  it("en palabras, y lo anterior como «Sin registrar»", () => {
    expect(etiquetaDelMedio("enlace")).toBe("Enlace de pago")
    expect(etiquetaDelMedio("sin_registrar")).toBe("Sin registrar")
  })

  it("el detalle con importe y referencia", () => {
    expect(textoDeMedios([{ medio: "efectivo", monto: 15, referencia: "" }, { medio: "tarjeta", monto: 100, referencia: "AUT-1" }]))
      .toBe("Efectivo 15.00, Tarjeta 100.00 (AUT-1)")
    expect(textoDeMedios(undefined)).toBe("")
  })
})
