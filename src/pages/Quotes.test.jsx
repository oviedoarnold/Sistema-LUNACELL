import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import ClientsProvider from "../context/ClientsContext"
import QuotesProvider from "../context/QuotesContext"
import { EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import Quotes from "./Quotes"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo de uña", category: "Herramientas", price: 180, stock: 10, minStock: 3 },
  { id: "p2", code: "C-001", name: "Cemento gris", category: "Construcción", price: 250, stock: 4, minStock: 1 },
]

const empresa = { name: EMPRESA_PRUEBA.nombre, currency: "L", taxRate: 15 }

const cotizacion = (extra = {}) => ({
  id: "Q-1",
  quoteNumber: "COT-00001",
  date: "20/08/2026",
  timestamp: Date.now(),
  clientId: "c1",
  clientName: "Ferremax",
  rtn: "0801199912345",
  validity: "2027-06-30",
  includeTax: true,
  taxRate: 15,
  items: [
    { productId: "p1", id: "p1", code: "M-001", name: "Martillo de uña", price: 180, qty: 2, quantity: 2, subtotal: 360 },
  ],
  subtotal: 360,
  tax: 54,
  total: 414,
  company: empresa,
  ...extra,
})

function renderQuotes(cotizaciones = []) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <QuotesProvider>
            <MemoryRouter initialEntries={["/quotes"]}>
              <Quotes />
            </MemoryRouter>
          </QuotesProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    { productos: PRODUCTOS, cotizaciones, esperar: ["cotizaciones"] }
  )
}

const totales = () => screen.getByText("Total").closest("div").parentElement

const agregar = (nombre) => {
  const fila = screen.getAllByText(nombre)[0].closest("div").parentElement

  fireEvent.click(within(fila).getAllByRole("button", { name: /agregar/i })[0])
}

const filaDe = (numero) =>
  screen.getByText(numero, { exact: false }).closest(".sale-card")

describe("Quotes: catálogo", () => {
  it("lista los productos para cotizar", async () => {
    await renderQuotes()

    expect(screen.getByText("Martillo de uña")).toBeInTheDocument()
    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
  })

  it("filtra por nombre", async () => {
    await renderQuotes()

    fireEvent.change(screen.getByPlaceholderText(/buscar producto/i), {
      target: { value: "cemento" },
    })

    expect(screen.getByText("Cemento gris")).toBeInTheDocument()
    expect(screen.queryByText("Martillo de uña")).not.toBeInTheDocument()
  })
})

describe("Quotes: armado", () => {
  it("arranca sin productos", async () => {
    await renderQuotes()
    expect(screen.getByText(/agrega productos/i)).toBeInTheDocument()
  })

  it("calcula el total con ISV incluido", async () => {
    await renderQuotes()
    agregar("Martillo de uña")

    expect(totales()).toHaveTextContent("L 207.00")
  })

  it("permite cotizar sin ISV", async () => {
    await renderQuotes()
    agregar("Martillo de uña")

    fireEvent.click(screen.getByLabelText(/incluir isv/i))

    expect(totales()).toHaveTextContent("L 180.00")
  })

  it("acumula al agregar el mismo producto dos veces", async () => {
    await renderQuotes()
    agregar("Martillo de uña")
    agregar("Martillo de uña")

    expect(totales()).toHaveTextContent("L 414.00")
  })
})

describe("Quotes: historial", () => {
  it("avisa cuando no hay cotizaciones", async () => {
    await renderQuotes()
    expect(screen.getByText(/historial de cotizaciones/i)).toBeInTheDocument()
  })

  it("lista las cotizaciones guardadas", async () => {
    await renderQuotes([cotizacion()])
    expect(screen.getByText("Ferremax")).toBeInTheDocument()
  })

  it("marca vigente la que aún no vence", async () => {
    await renderQuotes([cotizacion()])
    expect(within(filaDe("COT-00001")).getByText("Vigente")).toBeInTheDocument()
  })

  it("marca vencida la que ya pasó su vigencia", async () => {
    await renderQuotes([cotizacion({ validity: "2020-01-01" })])
    expect(within(filaDe("COT-00001")).getByText("Vencida")).toBeInTheDocument()
  })

  it("marca sin vigencia la que no tiene fecha", async () => {
    await renderQuotes([cotizacion({ validity: "" })])

    expect(
      within(filaDe("COT-00001")).getByText("Sin vigencia")
    ).toBeInTheDocument()
  })

  it("ofrece facturar cada cotización", async () => {
    await renderQuotes([cotizacion()])

    expect(
      within(filaDe("COT-00001")).getByRole("button", { name: /facturar/i })
    ).toBeInTheDocument()
  })

  it("busca por nombre de cliente", async () => {
    await renderQuotes([
      cotizacion(),
      cotizacion({ id: "Q-2", quoteNumber: "COT-00002", clientName: "Taller Díaz" }),
    ])

    fireEvent.change(screen.getByPlaceholderText(/buscar por cliente/i), {
      target: { value: "taller" },
    })

    expect(screen.getByText("Taller Díaz")).toBeInTheDocument()
    expect(screen.queryByText("Ferremax")).not.toBeInTheDocument()
  })
})
