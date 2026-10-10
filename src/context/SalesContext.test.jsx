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

/*
  La existencia que la pantalla que vende le pasa a addSale: la de su
  ubicación operativa. Aquí la bodega tiene lo mismo que el catálogo.
*/
const CANTIDAD_EN_BODEGA = Object.fromEntries(PRODUCTOS.map((p) => [p.id, p.stock]))
const EN_BODEGA = { existenciaDe: (producto) => CANTIDAD_EN_BODEGA[producto.id] ?? 0 }

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

/*
  Desde INV-3.3 la venta descuenta de la ubicación operativa del usuario:
  la bodega tiene lo mismo que el catálogo, y se puede marcar como la
  ubicación que emite factura fiscal.
*/
async function montarVentas(empresa = SIN_DATOS_FISCALES, { fiscal = false, fallarEn = {} } = {}) {
  const falso = montarDatos({
    productos: PRODUCTOS,
    clientes: CLIENTES,
    empresa,
    ubicaciones: [{ id: "bodega", name: "Lunacell Bodega", type: "bodega", fiscal }],
    existencias: PRODUCTOS.map((p) => ({ locationId: "bodega", productId: p.id, quantity: p.stock })),
    ubicacionOperativa: "bodega",
    fallarEn,
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
    factura = await result.current.addSale(venta, null, EN_BODEGA)
  })

  return factura
}

describe("addSale: validaciones", () => {
  it("rechaza una venta sin datos", async () => {
    const { result } = await montarVentas()

    await expect(result.current.addSale(null, null, EN_BODEGA)).rejects.toThrow()
  })

  it("rechaza una venta sin productos", async () => {
    const { result } = await montarVentas()

    await expect(result.current.addSale({ items: [] }, null, EN_BODEGA)).rejects.toThrow(
      /al menos un producto/i
    )
  })

  it("rechaza una cantidad de cero o menos", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addSale(
        ventaContado({ items: [{ productId: "p1", qty: 0 }] }),
        null,
        EN_BODEGA
      )
    ).rejects.toThrow(/mayor que cero/i)
  })

  it("rechaza un producto que no existe", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addSale(
        ventaContado({ items: [{ productId: "zzz", qty: 1 }] }),
        null,
        EN_BODEGA
      )
    ).rejects.toThrow(/ya no existe/i)
  })

  it("rechaza vender más de lo que hay en stock", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addSale(
        ventaContado({ items: [{ productId: "p2", qty: 99 }] }),
        null,
        EN_BODEGA
      )
    ).rejects.toThrow(/insuficiente/i)
  })

  it("compara contra la existencia de la ubicación, no contra el catálogo", async () => {
    const { result } = await montarVentas()

    // El catálogo dice 10 martillos; la ubicación de quien vende no tiene.
    await expect(
      result.current.addSale(ventaContado(), null, { existenciaDe: () => 0 })
    ).rejects.toThrow(/martillo.*0 unidades/i)
  })

  it("sin la existencia de la ubicación no se vende: no se usa el total del catálogo", async () => {
    const { result, falso } = await montarVentas()

    await expect(result.current.addSale(ventaContado())).rejects.toThrow(
      /existencia de tu ubicación/i
    )
    expect(falso.datos.ventas).toHaveLength(0)
  })

  it("exige un cliente registrado para vender al crédito", async () => {
    const { result } = await montarVentas()

    await expect(
      result.current.addSale(ventaCredito({ clientId: null }), null, EN_BODEGA)
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

  /*
    INV-3.2 cambió este contrato: una venta sin datos fiscales ya no trae
    un bloque fiscal con el CAI vacío, sino ninguno. Ese bloque a medias
    es lo que hacía que la plantilla imprimiera «CAI» en blanco en un
    documento que no es una factura autorizada.
  */
  it("sin datos fiscales no trae bloque fiscal", async () => {
    const { result } = await montarVentas()

    const factura = await facturar(result, ventaContado())

    expect(factura.invoiceNumber).toBe("VTA-003000")
    expect(factura.fiscal).toBeNull()
    expect(factura.isFiscal).toBe(false)
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
  /*
    Desde INV-3.2 el CAI no basta: la ubicación que vende tiene que estar
    marcada como la que emite. Sin la marca, la venta sale interna.
  */
  it("con CAI pero sin ubicación fiscal sale como documento interno", async () => {
    const { result } = await montarVentas(EMPRESA_PRUEBA)

    const factura = await facturar(result, ventaContado())

    expect(factura.invoiceNumber).toMatch(/^VTA-\d{6}$/)
    expect(factura.isFiscal).toBe(false)
  })

  it("usa la numeración autorizada", async () => {
    const { result } = await montarVentas(EMPRESA_PRUEBA, { fiscal: true })

    const factura = await facturar(result, ventaContado())

    expect(factura.invoiceNumber).toMatch(/^000-001-01-[0-9]{8}$/)
  })

  it("guarda una copia del CAI dentro de la factura", async () => {
    const { result } = await montarVentas(EMPRESA_PRUEBA, { fiscal: true })

    const factura = await facturar(result, ventaContado())

    expect(factura.fiscal.cai).toBe(EMPRESA_PRUEBA.cai)
  })
})

describe("addSale con registrar_venta_ubicacion", () => {
  const llamadasAlRpc = (falso) =>
    falso.rpc.mock.calls.filter(([nombre]) => nombre === "registrar_venta_ubicacion")

  it("manda una sola llamada con producto y cantidad, sin importes", async () => {
    const { result, falso } = await montarVentas()

    await act(async () => {
      await result.current.addSale(ventaContado(), "clave-1", EN_BODEGA)
    })

    const llamadas = llamadasAlRpc(falso)

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0][1]).toMatchObject({
      p_items: [{ producto_id: "p1", cantidad: 2 }],
      p_forma_pago: "contado",
      p_clave_idempotencia: "clave-1",
    })
    expect(llamadas[0][1]).not.toHaveProperty("p_subtotal")
  })

  it("descuenta la celda de la ubicación operativa", async () => {
    const { result, falso } = await montarVentas()

    await facturar(result, ventaContado())

    const celda = falso.datos.inventario_ubicacion.find((c) => c.producto_id === "p1")

    expect(celda.cantidad).toBe(8)
  })

  /*
    El historial se recarga de la base después de vender: la factura que
    devuelve addSale es la que quedó guardada, con sus renglones.
  */
  it("recarga el historial con la venta guardada y sus renglones", async () => {
    const { result } = await montarVentas()

    await facturar(result, ventaContado())

    expect(result.current.sales[0].items[0].qty).toBe(2)
  })

  it("el mismo intento con la misma clave devuelve la misma factura", async () => {
    const { result, falso } = await montarVentas()

    let primera
    let segunda

    await act(async () => {
      primera = await result.current.addSale(ventaContado(), "clave-2", EN_BODEGA)
      segunda = await result.current.addSale(ventaContado(), "clave-2", EN_BODEGA)
    })

    expect(segunda.id).toBe(primera.id)
    expect(falso.datos.ventas).toHaveLength(1)
  })

  it("un rechazo del servidor llega al POS con su mensaje y motivo", async () => {
    const { result } = await montarVentas(SIN_DATOS_FISCALES, {
      fallarEn: {
        registrar_venta_ubicacion: {
          code: "LV007",
          message: "No hay suficiente «Martillo» en Lunacell Bodega: hay 1, se piden 2",
        },
      },
    })

    await expect(
      act(async () => {
        await result.current.addSale(ventaContado(), null, EN_BODEGA)
      })
    ).rejects.toMatchObject({
      motivo: "existencia-insuficiente",
      message: "No hay suficiente «Martillo» en Lunacell Bodega: hay 1, se piden 2",
    })

    expect(result.current.sales).toHaveLength(0)
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
