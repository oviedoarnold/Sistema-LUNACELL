import { describe, it, expect, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useContext } from "react"

import { AuthProvider } from "./AuthContext"
import ProductProvider from "./ProductContext"
import QuotesProvider from "./QuotesContext"
import { QuotesContext } from "./contexts"
import { esperarQueSeAsiente, montarDatos } from "../test/pantallas"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo", price: 180, stock: 10, minStock: 2 },
]

const GUARDADA = {
  id: "q1",
  quoteNumber: "COT-02000",
  correlativo: 2000,
  clientName: "Ferremax",
  validity: "2027-06-30",
  includeTax: true,
  taxRate: 15,
  subtotal: 360,
  tax: 54,
  total: 414,
  items: [
    { productId: "p1", code: "M-001", name: "Martillo", qty: 2, price: 180, subtotal: 360 },
  ],
}

function Envoltura({ children }) {
  return (
    <AuthProvider>
      <ProductProvider>
        <QuotesProvider>{children}</QuotesProvider>
      </ProductProvider>
    </AuthProvider>
  )
}

async function montarCotizaciones(cotizaciones = []) {
  const falso = montarDatos({ productos: PRODUCTOS, cotizaciones })

  const vista = renderHook(() => useContext(QuotesContext), {
    wrapper: Envoltura,
  })

  await waitFor(() => {
    expect(falso.from).toHaveBeenCalledWith("cotizaciones")
  })

  await waitFor(() => {
    expect(vista.result.current.cargando).toBe(false)
  })

  await esperarQueSeAsiente(falso)

  return { ...vista, falso }
}

const nueva = (cambios = {}) => ({
  clientName: "Constructora López",
  clientId: null,
  rtn: "",
  validity: "2027-12-31",
  notes: "Precios sujetos a cambio",
  includeTax: true,
  taxRate: 15,
  subtotal: 180,
  tax: 27,
  total: 207,
  items: [
    { productId: "p1", code: "M-001", name: "Martillo", qty: 1, price: 180, subtotal: 180 },
  ],
  ...cambios,
})

async function cotizar(result, cotizacion) {
  let guardada

  await act(async () => {
    guardada = await result.current.addQuote(cotizacion)
  })

  return guardada
}

describe("QuotesContext", () => {
  it("arranca sin cotizaciones cuando la ferretería no tiene ninguna", async () => {
    const { result } = await montarCotizaciones()

    expect(result.current.quotes).toEqual([])
  })

  it("lee las cotizaciones que ya están en la base", async () => {
    const { result } = await montarCotizaciones([GUARDADA])

    expect(result.current.quotes).toHaveLength(1)
    expect(result.current.quotes[0].quoteNumber).toBe("COT-02000")
    expect(result.current.quotes[0].items).toHaveLength(1)
  })

  it("guarda la cotización con el número que entrega la base", async () => {
    const { result } = await montarCotizaciones()

    const guardada = await cotizar(result, nueva())

    expect(guardada.quoteNumber).toBe("COT-02000")
    expect(result.current.quotes).toHaveLength(1)
  })

  it("numera la siguiente cotización sin repetir", async () => {
    const { result } = await montarCotizaciones()

    const primera = await cotizar(result, nueva())
    const segunda = await cotizar(result, nueva())

    expect(segunda.correlativo).toBe(primera.correlativo + 1)
  })

  it("guarda los renglones de la cotización", async () => {
    const { result, falso } = await montarCotizaciones()

    await cotizar(result, nueva())

    expect(falso.datos.detalle_cotizacion).toHaveLength(1)
    expect(falso.datos.detalle_cotizacion[0].nombre).toBe("Martillo")
  })

  it("cotizar no toca el inventario", async () => {
    const { result, falso } = await montarCotizaciones()

    const movimientosAntes = falso.datos.movimientos_inventario.length

    await cotizar(result, nueva())

    expect(falso.datos.movimientos_inventario).toHaveLength(movimientosAntes)
  })

  it("conserva la vigencia y las observaciones", async () => {
    const { result } = await montarCotizaciones()

    const guardada = await cotizar(result, nueva())

    expect(guardada.validity).toBe("2027-12-31")
    expect(guardada.notes).toBe("Precios sujetos a cambio")
  })

  it("permite cotizar sin ISV", async () => {
    const { result } = await montarCotizaciones()

    const guardada = await cotizar(result, nueva({ includeTax: false, tax: 0, total: 180 }))

    expect(guardada.includeTax).toBe(false)
    expect(guardada.tax).toBe(0)
  })

  it("elimina una cotización", async () => {
    const { result } = await montarCotizaciones([GUARDADA])

    await act(async () => {
      await result.current.deleteQuote("q1")
    })

    expect(result.current.quotes).toHaveLength(0)
  })

  it("deja anotada la venta cuando la cotización se factura", async () => {
    const { result, falso } = await montarCotizaciones([GUARDADA])

    await act(async () => {
      await result.current.linkQuoteToSale("q1", "venta-1")
    })

    expect(falso.datos.cotizaciones[0].venta_id).toBe("venta-1")
  })

  it("encuentra una cotización por identificador", async () => {
    const { result } = await montarCotizaciones([GUARDADA])

    expect(result.current.getQuoteById("q1").clientName).toBe("Ferremax")
  })

  it("devuelve null si la cotización no existe", async () => {
    const { result } = await montarCotizaciones()

    expect(result.current.getQuoteById("no-existe")).toBeNull()
  })
})
