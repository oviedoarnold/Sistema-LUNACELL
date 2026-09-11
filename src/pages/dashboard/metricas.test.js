import { describe, it, expect } from "vitest"

import {
  hayVentasEn,
  productosAgotados,
  productosBajoMinimo,
  productosMasVendidos,
  productosPorAtender,
  saldoPorCobrar,
  variacionFrenteAAyer,
  ventasDelDia,
  ventasDelMes,
  ventasPorDia,
  ventasRecientes,
} from "./metricas"

/*
  Las cifras del panel.

  Se prueban aparte de la pantalla porque lo que importa aquí es la
  aritmética, no el marcado: que "ventas de hoy" sume lo del día y no lo
  de ayer, que el saldo descuente los abonos, que nada devuelva un número
  inventado cuando no hay datos.
*/

const HOY = new Date(2026, 8, 11, 12, 0, 0)
const diaRelativo = (dias) => {
  const fecha = new Date(HOY)
  fecha.setDate(fecha.getDate() + dias)
  return fecha
}

const venta = (extra = {}) => ({
  id: "v1",
  isoDate: HOY.toISOString(),
  total: 100,
  paymentType: "contado",
  items: [],
  ...extra,
})

const producto = (extra = {}) => ({
  id: "p1",
  name: "Cargador",
  stock: 10,
  minStock: 5,
  ...extra,
})

describe("ventasDelDia", () => {
  it("suma solo lo vendido ese día", () => {
    const ventas = [
      venta({ id: "a", total: 100 }),
      venta({ id: "b", total: 250 }),
      venta({ id: "c", total: 999, isoDate: diaRelativo(-1).toISOString() }),
    ]

    expect(ventasDelDia(ventas, HOY)).toEqual({ total: 350, cantidad: 2 })
  })

  it("sin ventas devuelve cero, no un hueco", () => {
    expect(ventasDelDia([], HOY)).toEqual({ total: 0, cantidad: 0 })
  })

  it("una sola venta cuenta como una", () => {
    expect(ventasDelDia([venta({ total: 75 })], HOY)).toEqual({
      total: 75,
      cantidad: 1,
    })
  })
})

describe("ventasDelMes", () => {
  it("suma lo del mes en curso y descarta el anterior", () => {
    const ventas = [
      venta({ id: "a", total: 100 }),
      venta({ id: "b", total: 200, isoDate: diaRelativo(-5).toISOString() }),
      venta({ id: "c", total: 500, isoDate: new Date(2026, 7, 20).toISOString() }),
    ]

    expect(ventasDelMes(ventas, HOY).total).toBe(300)
  })
})

describe("saldoPorCobrar", () => {
  it("una venta de contado no deja saldo", () => {
    expect(saldoPorCobrar([venta({ total: 500 })])).toBe(0)
  })

  /*
    Lo pendiente es el saldo, no el total facturado: los abonos ya
    registrados se descuentan.
  */
  it("descuenta los abonos de una venta a crédito", () => {
    const aCredito = venta({
      total: 1000,
      paymentType: "credito",
      type: "credito",
      payments: [{ id: "ab1", amount: 400 }],
    })

    expect(saldoPorCobrar([aCredito])).toBe(600)
  })

  it("sin ventas no hay nada por cobrar", () => {
    expect(saldoPorCobrar([])).toBe(0)
  })
})

describe("variacionFrenteAAyer", () => {
  /*
    Contra cero el porcentaje no está definido. Antes que enseñar un
    "+100 %" que no significa nada, no se enseña nada.
  */
  it("sin ventas ayer no devuelve porcentaje", () => {
    expect(variacionFrenteAAyer([venta({ total: 500 })], HOY)).toBeNull()
  })

  it("sin ventas en absoluto tampoco", () => {
    expect(variacionFrenteAAyer([], HOY)).toBeNull()
  })

  it("con ventas ayer calcula la diferencia real", () => {
    const ventas = [
      venta({ id: "hoy", total: 150 }),
      venta({ id: "ayer", total: 100, isoDate: diaRelativo(-1).toISOString() }),
    ]

    expect(variacionFrenteAAyer(ventas, HOY)).toBeCloseTo(50)
  })

  it("una caída se expresa en negativo", () => {
    const ventas = [
      venta({ id: "hoy", total: 50 }),
      venta({ id: "ayer", total: 100, isoDate: diaRelativo(-1).toISOString() }),
    ]

    expect(variacionFrenteAAyer(ventas, HOY)).toBeCloseTo(-50)
  })
})

describe("existencias", () => {
  it("bajo mínimo es lo que aún se puede vender pero está por debajo", () => {
    const catalogo = [
      producto({ id: "a", stock: 3, minStock: 10 }),
      producto({ id: "b", stock: 20, minStock: 5 }),
      producto({ id: "c", stock: 0, minStock: 5 }),
    ]

    expect(productosBajoMinimo(catalogo).map((p) => p.id)).toEqual(["a"])
  })

  it("lo agotado se cuenta aparte", () => {
    const catalogo = [
      producto({ id: "a", stock: 3, minStock: 10 }),
      producto({ id: "c", stock: 0, minStock: 5 }),
    ]

    expect(productosAgotados(catalogo).map((p) => p.id)).toEqual(["c"])
  })

  it("justo en el mínimo ya cuenta como bajo", () => {
    expect(productosBajoMinimo([producto({ stock: 5, minStock: 5 })])).toHaveLength(1)
  })

  it("un producto sin mínimo declarado usa el del sistema", () => {
    const sinMinimo = { id: "x", name: "Funda", stock: 4 }

    expect(productosBajoMinimo([sinMinimo])).toHaveLength(1)
  })

  it("un catálogo vacío no da alertas", () => {
    expect(productosBajoMinimo([])).toHaveLength(0)
    expect(productosAgotados([])).toHaveLength(0)
  })

  it("lo agotado se atiende antes que lo escaso", () => {
    const catalogo = [
      producto({ id: "escaso", stock: 2, minStock: 10 }),
      producto({ id: "agotado", stock: 0, minStock: 5 }),
    ]

    expect(productosPorAtender(catalogo).map((p) => p.id)).toEqual([
      "agotado",
      "escaso",
    ])
  })

  it("la lista no crece sin límite", () => {
    const catalogo = Array.from({ length: 12 }, (_, i) =>
      producto({ id: `p${i}`, stock: 0 })
    )

    expect(productosPorAtender(catalogo)).toHaveLength(5)
  })
})

describe("ventasPorDia", () => {
  it("devuelve siempre siete días, aunque no haya ventas", () => {
    const dias = ventasPorDia([], 7, HOY)

    expect(dias).toHaveLength(7)
    expect(dias.every((d) => d.total === 0)).toBe(true)
  })

  it("el último día es hoy", () => {
    const dias = ventasPorDia([], 7, HOY)

    expect(dias[6].fecha.toDateString()).toBe(HOY.toDateString())
  })

  it("coloca cada venta en su día", () => {
    const ventas = [
      venta({ id: "hoy", total: 100 }),
      venta({ id: "anteayer", total: 60, isoDate: diaRelativo(-2).toISOString() }),
    ]

    const dias = ventasPorDia(ventas, 7, HOY)

    expect(dias[6].total).toBe(100)
    expect(dias[4].total).toBe(60)
    expect(dias[5].total).toBe(0)
  })

  it("hayVentasEn distingue un período vacío de uno con ventas", () => {
    expect(hayVentasEn(ventasPorDia([], 7, HOY))).toBe(false)
    expect(hayVentasEn(ventasPorDia([venta()], 7, HOY))).toBe(true)
  })
})

describe("productosMasVendidos", () => {
  it("acumula unidades e importe del mismo producto", () => {
    const ventas = [
      venta({
        id: "a",
        items: [{ name: "Cargador", qty: 2, subtotal: 300 }],
      }),
      venta({
        id: "b",
        items: [{ name: "Cargador", qty: 3, subtotal: 450 }],
      }),
    ]

    expect(productosMasVendidos(ventas)).toEqual([
      { nombre: "Cargador", unidades: 5, total: 750 },
    ])
  })

  it("ordena por unidades vendidas", () => {
    const ventas = [
      venta({
        id: "a",
        items: [
          { name: "Funda", qty: 1, subtotal: 100 },
          { name: "Cargador", qty: 9, subtotal: 900 },
        ],
      }),
    ]

    expect(productosMasVendidos(ventas).map((p) => p.nombre)).toEqual([
      "Cargador",
      "Funda",
    ])
  })

  it("sin ventas devuelve lista vacía, no productos de ejemplo", () => {
    expect(productosMasVendidos([])).toEqual([])
  })

  it("una venta sin detalle no aporta nada", () => {
    expect(productosMasVendidos([venta({ items: [] })])).toEqual([])
  })
})

describe("ventasRecientes", () => {
  it("devuelve las más nuevas primero", () => {
    const ventas = [
      venta({ id: "vieja", isoDate: diaRelativo(-3).toISOString() }),
      venta({ id: "nueva" }),
      venta({ id: "media", isoDate: diaRelativo(-1).toISOString() }),
    ]

    expect(ventasRecientes(ventas).map((v) => v.id)).toEqual([
      "nueva",
      "media",
      "vieja",
    ])
  })

  it("no devuelve más de las pedidas", () => {
    const ventas = Array.from({ length: 9 }, (_, i) => venta({ id: `v${i}` }))

    expect(ventasRecientes(ventas)).toHaveLength(5)
  })

  it("sin ventas devuelve lista vacía", () => {
    expect(ventasRecientes([])).toEqual([])
  })

  it("no altera el arreglo que recibe", () => {
    const ventas = [
      venta({ id: "vieja", isoDate: diaRelativo(-3).toISOString() }),
      venta({ id: "nueva" }),
    ]

    ventasRecientes(ventas)

    expect(ventas.map((v) => v.id)).toEqual(["vieja", "nueva"])
  })
})
