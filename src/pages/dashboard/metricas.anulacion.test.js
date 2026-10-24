import { describe, it, expect } from "vitest"

import {
  productosMasVendidos,
  saldoPorCobrar,
  variacionFrenteAAyer,
  ventasDelDia,
  ventasDelMes,
  ventasPorDia,
  ventasRecientes,
} from "./metricas"
import { cuentasPorCobrar } from "../../utils/cuentasPorCobrar"

/*
  Una venta anulada no es ingreso, ni deuda, ni producto vendido. Se queda
  en las recientes, con su estado, porque ahí lo que importa es qué pasó.
*/

const HOY = new Date(2026, 9, 24, 12, 0, 0)

const venta = (extra = {}) => ({
  id: "v1",
  isoDate: HOY.toISOString(),
  total: 100,
  paymentType: "contado",
  status: "pagada",
  items: [{ name: "Cargador", qty: 2, subtotal: 100 }],
  ...extra,
})

const vigente = venta()
const anulada = venta({ id: "v2", total: 900, status: "anulada", items: [{ name: "Cubo", qty: 9, subtotal: 900 }] })
const creditoAnulado = venta({ id: "v3", total: 500, paymentType: "credito", status: "anulada", clientId: "c1" })

describe("las anuladas fuera de las cifras", () => {
  it("no suman a las ventas del día ni del mes", () => {
    expect(ventasDelDia([vigente, anulada], HOY)).toEqual({ total: 100, cantidad: 1 })
    expect(ventasDelMes([vigente, anulada], HOY)).toEqual({ total: 100, cantidad: 1 })
  })

  it("no cuentan en el gráfico de la semana ni en la comparación con ayer", () => {
    const ayer = new Date(HOY)
    ayer.setDate(ayer.getDate() - 1)
    const deAyer = venta({ id: "v4", isoDate: ayer.toISOString(), total: 100 })

    expect(ventasPorDia([vigente, anulada], 7, HOY).at(-1).total).toBe(100)
    expect(variacionFrenteAAyer([vigente, anulada, deAyer], HOY)).toBe(0)
  })

  it("no son deuda: ni en el saldo por cobrar ni en las cuentas por cobrar", () => {
    const pendiente = venta({ id: "v5", total: 200, paymentType: "credito", status: "pendiente", clientId: "c1" })

    expect(saldoPorCobrar([pendiente, creditoAnulado])).toBe(200)
    const [cuenta] = cuentasPorCobrar([pendiente, creditoAnulado], [{ id: "c1", name: "Taller" }])
    expect([cuenta.deudaTotal, cuenta.facturasPendientes]).toEqual([200, 1])
  })

  it("no cuentan como productos vendidos", () => {
    expect(productosMasVendidos([vigente, anulada]).map((p) => p.nombre)).toEqual(["Cargador"])
  })

  it("se siguen viendo entre las recientes", () => {
    expect(ventasRecientes([vigente, anulada]).map((v) => v.id).sort()).toEqual(["v1", "v2"])
  })
})
