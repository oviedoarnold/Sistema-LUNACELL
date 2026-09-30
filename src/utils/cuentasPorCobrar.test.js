import { describe, it, expect } from "vitest"

import {
  cuentasPorCobrar,
  deudaTotalDeLasCuentas,
  previaDelReparto,
} from "./cuentasPorCobrar"

/*
  Lo que se prueba aquí es el paso de "una fila por factura" a "una cuenta
  por cliente". Es donde estaba el problema que el cliente reportó: un
  cliente con cuatro facturas aparecía cuatro veces.
*/

const venta = (extra = {}) => ({
  id: "v1",
  invoiceNumber: "FAC-00001",
  correlativo: 1,
  date: "01/01/2026",
  isoDate: "2026-01-01T10:00:00Z",
  timestamp: Date.parse("2026-01-01T10:00:00Z"),
  clientId: "c1",
  clientName: "Arnold Oviedo",
  total: 1000,
  payments: [],
  paymentType: "credito",
  type: "credito",
  status: "pendiente",
  ...extra,
})

const cliente = (extra = {}) => ({
  id: "c1",
  name: "Arnold Oviedo",
  rtn: "0801199912345",
  phone: "9999-0000",
  ...extra,
})

describe("la cuenta consolidada del cliente", () => {
  it("junta varias facturas del mismo cliente en una sola cuenta", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "v1", correlativo: 1, total: 1000 }),
        venta({ id: "v2", correlativo: 2, total: 2750 }),
        venta({ id: "v3", correlativo: 3, total: 5000 }),
      ],
      [cliente()]
    )

    expect(cuentas).toHaveLength(1)
    expect(cuentas[0].clienteId).toBe("c1")
    expect(cuentas[0].facturasPendientes).toBe(3)
    expect(cuentas[0].deudaTotal).toBe(8750)
  })

  it("separa a clientes distintos en cuentas distintas", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "v1", clientId: "c1", total: 1000 }),
        venta({ id: "v2", clientId: "c2", clientName: "Otro", total: 400 }),
      ],
      [cliente(), cliente({ id: "c2", name: "Otro" })]
    )

    expect(cuentas).toHaveLength(2)
    expect(cuentas.map((c) => c.clienteId).sort()).toEqual(["c1", "c2"])
  })

  it("agrupa por id y no por nombre, porque dos clientes pueden llamarse igual", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "v1", clientId: "c1", clientName: "José Pérez", total: 100 }),
        venta({ id: "v2", clientId: "c2", clientName: "José Pérez", total: 300 }),
      ],
      [
        cliente({ id: "c1", name: "José Pérez" }),
        cliente({ id: "c2", name: "José Pérez" }),
      ]
    )

    expect(cuentas).toHaveLength(2)
    expect(cuentas.map((c) => c.deudaTotal)).toEqual([300, 100])
  })

  it("la deuda total es la suma de los saldos pendientes", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "v1", total: 1000, payments: [{ id: "a1", amount: 400 }] }),
        venta({ id: "v2", correlativo: 2, total: 500 }),
      ],
      [cliente()]
    )

    expect(cuentas[0].deudaTotal).toBe(1100)
    expect(deudaTotalDeLasCuentas(cuentas)).toBe(1100)
  })

  it("una factura anulada no se debe", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "v1", total: 1000 }),
        venta({ id: "v2", correlativo: 2, total: 500, status: "anulada" }),
      ],
      [cliente()]
    )

    expect(cuentas[0].deudaTotal).toBe(1000)
    expect(cuentas[0].facturasPendientes).toBe(1)
  })

  it("una venta de contado no entra en la cuenta", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "v1", total: 1000 }),
        venta({
          id: "v2",
          correlativo: 2,
          total: 700,
          paymentType: "contado",
          type: "contado",
          status: "pagada",
        }),
      ],
      [cliente()]
    )

    expect(cuentas[0].deudaTotal).toBe(1000)
    expect(cuentas[0].facturasPendientes).toBe(1)
  })

  it("una factura ya cubierta no entra aunque siga en la lista", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "v1", total: 1000 }),
        venta({
          id: "v2",
          correlativo: 2,
          total: 500,
          payments: [{ id: "a1", amount: 500 }],
        }),
      ],
      [cliente()]
    )

    expect(cuentas[0].facturasPendientes).toBe(1)
    expect(cuentas[0].deudaTotal).toBe(1000)
  })

  it("los abonos ya registrados bajan el saldo", () => {
    const cuentas = cuentasPorCobrar(
      [venta({ total: 1000, payments: [{ id: "a1", amount: 250 }] })],
      [cliente()]
    )

    expect(cuentas[0].deudaTotal).toBe(750)
    expect(cuentas[0].facturas[0].abonado).toBe(250)
    expect(cuentas[0].facturas[0].saldo).toBe(750)
  })

  /*
    Un abono del camino viejo no tiene pago_id. La aplicación no lo mira
    —suma todos los abonos de la venta—, y tiene que seguir siendo así
    mientras el esquema los permita: si dejaran de contar, la deuda subiría
    sola y se le cobraría al cliente dinero que ya pagó.
  */
  it("un abono legado, sin pago que lo agrupe, sigue contando", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({
          total: 1000,
          payments: [{ id: "a1", amount: 400, pagoId: null }],
        }),
      ],
      [cliente()]
    )

    expect(cuentas[0].deudaTotal).toBe(600)
  })

  it("un cliente sin deuda no aparece", () => {
    const cuentas = cuentasPorCobrar(
      [venta({ total: 500, payments: [{ id: "a1", amount: 500 }] })],
      [cliente()]
    )

    expect(cuentas).toEqual([])
  })

  it("ordena las facturas de la más antigua a la más reciente", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({
          id: "v3",
          correlativo: 3,
          isoDate: "2026-03-01T10:00:00Z",
          timestamp: Date.parse("2026-03-01T10:00:00Z"),
        }),
        venta({
          id: "v1",
          correlativo: 1,
          isoDate: "2026-01-01T10:00:00Z",
          timestamp: Date.parse("2026-01-01T10:00:00Z"),
        }),
      ],
      [cliente()]
    )

    expect(cuentas[0].facturas.map((f) => f.ventaId)).toEqual(["v1", "v3"])
    expect(cuentas[0].masAntigua.ventaId).toBe("v1")
  })

  it("desempata por correlativo cuando la fecha es la misma", () => {
    const misma = Date.parse("2026-03-01T12:00:00Z")

    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "vB", correlativo: 77, timestamp: misma }),
        venta({ id: "vA", correlativo: 22, timestamp: misma }),
      ],
      [cliente()]
    )

    expect(cuentas[0].facturas.map((f) => f.correlativo)).toEqual([22, 77])
  })

  it("toma el nombre de la ficha del cliente y, si no hay, el de la factura", () => {
    const conFicha = cuentasPorCobrar([venta()], [cliente({ name: "Renombrado" })])
    const sinFicha = cuentasPorCobrar([venta()], [])

    expect(conFicha[0].nombre).toBe("Renombrado")
    expect(sinFicha[0].nombre).toBe("Arnold Oviedo")
  })

  it("pone primero a quien más debe", () => {
    const cuentas = cuentasPorCobrar(
      [
        venta({ id: "v1", clientId: "c1", total: 100 }),
        venta({ id: "v2", clientId: "c2", clientName: "Grande", total: 900 }),
      ],
      [cliente(), cliente({ id: "c2", name: "Grande" })]
    )

    expect(cuentas.map((c) => c.nombre)).toEqual(["Grande", "Arnold Oviedo"])
  })
})

describe("la previa del reparto", () => {
  const facturas = [
    { ventaId: "v1", numero: "FAC-1", saldo: 1000 },
    { ventaId: "v2", numero: "FAC-2", saldo: 2750 },
    { ventaId: "v3", numero: "FAC-3", saldo: 5000 },
  ]

  it("reparte de la más antigua a la más reciente", () => {
    const previa = previaDelReparto(facturas, 4000)

    expect(previa.map((l) => l.aplicado)).toEqual([1000, 2750, 250])
    expect(previa.at(-1).saldoPosterior).toBe(4750)
  })

  it("no pasa de la primera factura si el monto no alcanza", () => {
    expect(previaDelReparto(facturas, 400)).toHaveLength(1)
  })

  it("con un monto que no es un número no propone nada", () => {
    expect(previaDelReparto(facturas, 0)).toEqual([])
    expect(previaDelReparto(facturas, -5)).toEqual([])
    expect(previaDelReparto(facturas, Number.NaN)).toEqual([])
  })
})
