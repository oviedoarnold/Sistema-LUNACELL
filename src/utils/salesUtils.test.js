import { describe, it, expect } from "vitest"

import {
  roundMoney,
  isCreditSale,
  getSalePayments,
  getSalePaid,
  getSaleBalance,
  getSaleAdjusted,
  getSaleReturned,
  applyPayments,
} from "./salesUtils"

const credito = (total, payments = []) => ({
  id: "F-1",
  total,
  paymentType: "credito",
  status: "pendiente",
  payments,
})

const abono = (amount, id = `AB-${amount}-${Math.random()}`) => ({
  id,
  amount,
})

describe("roundMoney", () => {
  it("corrige el error clásico de punto flotante", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
  })

  it("redondea a dos decimales", () => {
    expect(roundMoney(10.005)).toBe(10.01)
    expect(roundMoney(10.004)).toBe(10)
  })

  it("trata los valores ausentes como cero", () => {
    expect(roundMoney(null)).toBe(0)
    expect(roundMoney(undefined)).toBe(0)
    expect(roundMoney("")).toBe(0)
  })
})

describe("isCreditSale", () => {
  it("reconoce una venta a crédito", () => {
    expect(isCreditSale({ paymentType: "credito" })).toBe(true)
  })

  it("no confunde una venta de contado", () => {
    expect(isCreditSale({ paymentType: "contado" })).toBe(false)
  })

  it("acepta el campo type como respaldo", () => {
    expect(isCreditSale({ type: "credito" })).toBe(true)
  })

  it("no distingue mayúsculas", () => {
    expect(isCreditSale({ paymentType: "CREDITO" })).toBe(true)
  })

  it("asume contado cuando no hay dato", () => {
    expect(isCreditSale({})).toBe(false)
    expect(isCreditSale(null)).toBe(false)
  })
})

describe("getSalePayments", () => {
  it("devuelve una lista vacía en facturas anteriores a los abonos", () => {
    expect(getSalePayments({ total: 100 })).toEqual([])
  })

  it("ignora un campo payments corrupto", () => {
    expect(getSalePayments({ payments: "no es lista" })).toEqual([])
  })
})

describe("getSalePaid", () => {
  it("suma los abonos registrados", () => {
    expect(getSalePaid(credito(1000, [abono(300), abono(250)]))).toBe(550)
  })

  it("devuelve cero sin abonos", () => {
    expect(getSalePaid(credito(1000))).toBe(0)
  })
})

describe("getSaleBalance", () => {
  it("una venta de contado nunca arrastra saldo", () => {
    expect(getSaleBalance({ total: 500, paymentType: "contado" })).toBe(0)
  })

  it("una venta a crédito sin abonos debe el total", () => {
    expect(getSaleBalance(credito(1000))).toBe(1000)
  })

  it("descuenta los abonos parciales", () => {
    expect(getSaleBalance(credito(1000, [abono(400)]))).toBe(600)
  })

  it("nunca devuelve un saldo negativo", () => {
    expect(getSaleBalance(credito(100, [abono(150)]))).toBe(0)
  })

  it("funciona con facturas guardadas antes de existir los abonos", () => {
    expect(getSaleBalance({ total: 300, paymentType: "credito" })).toBe(300)
  })

  it("cierra en cero exacto pagando en tercios con centavos", () => {
    const venta = credito(1035.75, [
      abono(345.25, "a"),
      abono(345.25, "b"),
      abono(345.25, "c"),
    ])

    expect(getSaleBalance(venta)).toBe(0)
  })
})

describe("applyPayments", () => {
  it("mantiene pendiente mientras quede saldo", () => {
    expect(applyPayments(credito(1000), [abono(400)]).status).toBe("pendiente")
  })

  it("pasa a pagada al cubrir el total de una sola vez", () => {
    expect(applyPayments(credito(1000), [abono(1000)]).status).toBe("pagada")
  })

  it("pasa a pagada al cubrir el total por partes", () => {
    const resultado = applyPayments(credito(1000), [abono(600), abono(400)])
    expect(resultado.status).toBe("pagada")
  })

  it("vuelve a pendiente si se elimina un abono", () => {
    const saldada = credito(1000, [abono(600, "x"), abono(400, "y")])
    const resultado = applyPayments(saldada, [abono(600, "x")])

    expect(resultado.status).toBe("pendiente")
  })

  it("vuelve a pendiente si se eliminan todos los abonos", () => {
    const saldada = credito(1000, [abono(1000)])
    expect(applyPayments(saldada, []).status).toBe("pendiente")
  })

  it("no muta la venta original", () => {
    const original = credito(1000, [abono(200)])
    const copia = JSON.stringify(original)

    applyPayments(original, [...original.payments, abono(300)])

    expect(JSON.stringify(original)).toBe(copia)
  })

  it("deja la lista de abonos que se le pasó", () => {
    const nuevos = [abono(100), abono(200)]
    expect(applyPayments(credito(1000), nuevos).payments).toEqual(nuevos)
  })
})

/*
  0052: el ajuste de una devolución a crédito rebaja el saldo, pero no es
  dinero que entró: no cuenta como abonado.
*/
describe("devoluciones", () => {
  const ajuste = (amount) => ({ id: `AJ-${amount}`, amount, ajuste: true })

  it("el ajuste no cuenta como abonado y sí rebaja el saldo", () => {
    const venta = credito(230, [abono(50), ajuste(115)])

    expect(getSalePaid(venta)).toBe(50)
    expect(getSaleAdjusted(venta)).toBe(115)
    expect(getSaleBalance(venta)).toBe(65)
  })

  it("lo devuelto suma el valor y el cargo de cada devolución", () => {
    expect(getSaleReturned({ devoluciones: [{ valor: 115, cargo: 0 }, { valor: 115, cargo: 8.5 }] })).toBe(238.5)
    expect(getSaleReturned({})).toBe(0)
  })
})
