import { describe, it, expect, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useContext } from "react"

import { AuthProvider } from "./AuthContext"
import ProductProvider from "./ProductContext"
import SalesProvider from "./SalesContext"
import { SalesContext } from "./contexts"
import { EMPRESA_PRUEBA, esperarQueSeAsiente, montarDatos } from "../test/pantallas"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo", category: "Herramientas", price: 100, stock: 10, minStock: 2 },
  { id: "p2", code: "C-001", name: "Cemento", category: "Construcción", price: 200, stock: 3, minStock: 1 },
]

const CLIENTES = [{ id: "c1", name: "Ferremax", phone: "9999-0000" }]

const SIN_DATOS_FISCALES = {
  ...EMPRESA_PRUEBA,
  cai: "",
  rango_desde: null,
  rango_hasta: null,
  fecha_limite_emision: null,
}

function Envoltura({ children }) {
  return (
    <AuthProvider>
      <ProductProvider>
        <SalesProvider>{children}</SalesProvider>
      </ProductProvider>
    </AuthProvider>
  )
}

async function montarVentas(empresa = SIN_DATOS_FISCALES) {
  const falso = montarDatos({
    productos: PRODUCTOS,
    clientes: CLIENTES,
    empresa,
  })

  const vista = renderHook(() => useContext(SalesContext), {
    wrapper: Envoltura,
  })

  await waitFor(() => {
    expect(falso.from).toHaveBeenCalledWith("ventas")
  })

  await waitFor(() => {
    expect(vista.result.current.cargando).toBe(false)
  })

  await esperarQueSeAsiente(falso)

  return { ...vista, falso }
}

const ventaContado = (cambios = {}) => ({
  items: [{ productId: "p1", qty: 2 }],
  paymentType: "contado",
  customerName: "Consumidor Final",
  ...cambios,
})

const ventaCredito = (cambios = {}) => ({
  items: [{ productId: "p1", qty: 1 }],
  paymentType: "credito",
  clientId: "c1",
  customerName: "Ferremax",
  dueDate: "2027-01-31",
  ...cambios,
})

async function facturar(result, venta) {
  let factura

  await act(async () => {
    factura = await result.current.addSale(venta)
  })

  return factura
}

describe("addSale: validaciones", () => {
  it("rechaza una venta sin datos", async () => {
    const { result } = await montarVentas()

    await expect(result.current.addSale(null)).rejects.toThrow()
  })

  it("rechaza una venta sin productos", async () => {
    const { result } = await montarVentas()

    await expect(result.current.addSale({ items: [] })).rejects.toThrow(
      /al menos un producto/i
    )
  })

  it("rechaza una cantidad de cero o menos", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addSale(
        ventaContado({ items: [{ productId: "p1", qty: 0 }] })
      )
    ).rejects.toThrow(/mayor que cero/i)
  })

  it("rechaza un producto que no existe", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addSale(
        ventaContado({ items: [{ productId: "zzz", qty: 1 }] })
      )
    ).rejects.toThrow(/ya no existe/i)
  })

  it("rechaza vender más de lo que hay en stock", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addSale(
        ventaContado({ items: [{ productId: "p2", qty: 99 }] })
      )
    ).rejects.toThrow(/insuficiente/i)
  })

  it("exige un cliente registrado para vender al crédito", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addSale(ventaCredito({ clientId: null }))
    ).rejects.toThrow(/crédito/i)
  })
})

describe("addSale: factura generada", () => {
  it("registra la venta en el historial", async () => {
    const { result } = await montarVentas()

    await facturar(result, ventaContado())

    expect(result.current.sales).toHaveLength(1)
  })

  it("calcula subtotal, impuesto y total", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaContado())

    expect(factura.subtotal).toBe(200)
    expect(factura.tax).toBe(30)
    expect(factura.total).toBe(230)
  })

  it("marca pagada la venta de contado", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaContado())

    expect(factura.status).toBe("pagada")
    expect(factura.dueDate).toBeNull()
  })

  it("marca pendiente la venta al crédito y guarda el vencimiento", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaCredito())

    expect(factura.status).toBe("pendiente")
    expect(factura.dueDate).toBe("2027-01-31")
  })

  it("usa numeración interna sin datos fiscales", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaContado())

    expect(factura.invoiceNumber).toBe("FAC-01000")
    expect(factura.fiscal.cai).toBe("")
  })

  it("incrementa el correlativo entre facturas", async () => {
    const { result } = await montarVentas()

    const primera = await facturar(result, ventaContado())
    const segunda = await facturar(result, ventaContado())

    expect(primera.invoiceNumber).not.toBe(segunda.invoiceNumber)
    expect(segunda.correlativo).toBe(primera.correlativo + 1)
  })

  /*
    Con el reloj detenido, dos facturas caen en el mismo milisegundo. El
    doble numeraba los identificadores con Date.now(), asi que las dos
    recibian el mismo id y quien buscaba la recien creada encontraba la
    anterior: la prueba comparaba la primera consigo misma. Pasaba en
    maquinas rapidas y por eso solo se veia en integracion continua.
  */
  it("numera dos facturas emitidas en el mismo milisegundo", async () => {
    const { result } = await montarVentas()

    vi.useFakeTimers({ shouldAdvanceTime: false })
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"))

    try {
      const primera = await facturar(result, ventaContado())
      const segunda = await facturar(result, ventaContado())

      expect(segunda.id).not.toBe(primera.id)
      expect(segunda.correlativo).toBe(primera.correlativo + 1)
      expect(segunda.invoiceNumber).not.toBe(primera.invoiceNumber)
    } finally {
      vi.useRealTimers()
    }
  })

  it("descarga el inventario con un movimiento de salida", async () => {
    const { result, falso } = await montarVentas()

    await facturar(result, ventaContado())

    const salidas = falso.datos.movimientos_inventario.filter(
      (m) => m.tipo === "salida"
    )

    expect(salidas).toHaveLength(1)
    expect(salidas[0].cantidad).toBe(-2)
  })

  it("congela los datos de la empresa dentro de la factura", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaContado())

    expect(factura.company.name).toBe(EMPRESA_PRUEBA.nombre)
    expect(factura.company.taxRate).toBe(15)
  })
})

describe("addSale con datos fiscales", () => {
  it("usa la numeración autorizada", async () => {
    const { result } = await montarVentas(EMPRESA_PRUEBA)

    const factura = await facturar(result, ventaContado())

    expect(factura.invoiceNumber).toMatch(/^000-001-01-[0-9]{8}$/)
  })

  it("guarda una copia del CAI dentro de la factura", async () => {
    const { result } = await montarVentas(EMPRESA_PRUEBA)

    const factura = await facturar(result, ventaContado())

    expect(factura.fiscal.cai).toBe(EMPRESA_PRUEBA.cai)
  })
})

describe("abonos", () => {
  const abonar = async (result, facturaId, abono) => {
    let registrado

    await act(async () => {
      registrado = await result.current.addPayment(facturaId, abono)
    })

    return registrado
  }

  it("rechaza abonar a una factura inexistente", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addPayment("no-existe", { amount: 10 })
    ).rejects.toThrow(/no existe/i)
  })

  it("rechaza abonar a una venta de contado", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaContado())

    await expect(
      result.current.addPayment(factura.id, { amount: 10 })
    ).rejects.toThrow(/crédito/i)
  })

  it("rechaza un monto de cero", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaCredito())

    await expect(
      result.current.addPayment(factura.id, { amount: 0 })
    ).rejects.toThrow(/mayor que cero/i)
  })

  it("rechaza un abono mayor al saldo", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaCredito())

    await expect(
      result.current.addPayment(factura.id, { amount: factura.total + 1 })
    ).rejects.toThrow(/no puede superar/i)
  })

  it("registra un abono parcial y deja la factura pendiente", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaCredito())

    await abonar(result, factura.id, { amount: 50, note: "Efectivo" })

    const actualizada = result.current.getSaleById(factura.id)

    expect(actualizada.payments).toHaveLength(1)
    expect(actualizada.status).toBe("pendiente")
  })

  it("cancela la factura al cubrir el saldo completo", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaCredito())

    await abonar(result, factura.id, { amount: factura.total })

    expect(result.current.getSaleById(factura.id).status).toBe("pagada")
  })

  it("no admite otro abono sobre una factura ya cancelada", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaCredito())

    await abonar(result, factura.id, { amount: factura.total })

    await expect(
      result.current.addPayment(factura.id, { amount: 1 })
    ).rejects.toThrow(/ya está cancelada/i)
  })

  it("al eliminar un abono la factura vuelve a pendiente", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaCredito())
    const abono = await abonar(result, factura.id, { amount: factura.total })

    await act(async () => {
      await result.current.deletePayment(factura.id, abono.id)
    })

    const actualizada = result.current.getSaleById(factura.id)

    expect(actualizada.status).toBe("pendiente")
    expect(actualizada.payments).toHaveLength(0)
  })
})

describe("búsqueda de facturas", () => {
  it("encuentra por número de factura", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaContado())

    expect(
      result.current.getSaleByInvoiceNumber(factura.invoiceNumber).id
    ).toBe(factura.id)
  })

  it("devuelve undefined si el número no existe", async () => {
    const { result } = await montarVentas()

    expect(result.current.getSaleByInvoiceNumber("FAC-99999")).toBeUndefined()
  })
})
