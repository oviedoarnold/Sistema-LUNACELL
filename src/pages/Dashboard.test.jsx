import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import SalesProvider from "../context/SalesContext"
import ClientsProvider from "../context/ClientsContext"
import { renderizarPantalla } from "../test/pantallas"
import Dashboard from "./Dashboard"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", name: "Martillo", category: "Herramientas", price: 180, stock: 20, minStock: 5 },
  { id: "p2", name: "Cemento", category: "Construcción", price: 250, stock: 3, minStock: 10 },
  { id: "p3", name: "Brocha", category: "Pinturas", price: 45, stock: 0, minStock: 5 },
]

const hoy = new Date()

const venta = (extra = {}) => ({
  id: "F-1",
  invoiceNumber: "FAC-01000",
  date: hoy.toLocaleDateString("es-HN"),
  timestamp: hoy.getTime(),
  clientName: "Ferremax",
  items: [{ productId: "p1", name: "Martillo", qty: 1, price: 180, subtotal: 180 }],
  subtotal: 180,
  tax: 27,
  total: 207,
  paymentType: "contado",
  type: "contado",
  status: "pagada",
  ...extra,
})

function renderDashboard({ ventas = [], productos = PRODUCTOS, clientes = [] } = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <SalesProvider>
            <Dashboard />
          </SalesProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>,
    { ventas, productos, clientes, esperar: ["ventas"] }
  )
}

describe("Dashboard", () => {
  it("muestra el encabezado", async () => {
    await renderDashboard()
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
  })

  it("cuenta como stock bajo solo lo que aun tiene existencias", async () => {
    await renderDashboard()

    const tarjeta = screen.getByText("Stock bajo").closest(".stat-card")

    expect(tarjeta).toHaveTextContent("1")
  })

  it("cuenta los productos agotados", async () => {
    await renderDashboard()

    const tarjeta = screen.getByText("Agotados").closest(".stat-card")

    expect(tarjeta).toHaveTextContent("1")
  })

  it("informa cuántos productos hay", async () => {
    await renderDashboard()

    const tarjeta = screen.getByText("Productos").closest(".stat-card")

    expect(tarjeta).toHaveTextContent("3")
  })

  it("suma las ventas del día", async () => {
    await renderDashboard({ ventas: [venta()] })

    const tarjeta = screen.getByText("Ventas hoy").closest(".stat-card")

    expect(tarjeta).toHaveTextContent("207.00")
  })

  it("deja el saldo por cobrar en cero si todo es de contado", async () => {
    await renderDashboard({ ventas: [venta()] })

    const tarjeta = screen.getByText("Por cobrar").closest(".stat-card")

    expect(tarjeta).toHaveTextContent("0.00")
  })

  it("suma al por cobrar solo el saldo pendiente de las ventas a crédito", async () => {
    const aCredito = venta({
      id: "F-2",
      paymentType: "credito",
      type: "credito",
      status: "pendiente",
      total: 1000,
      payments: [{ id: "ab1", amount: 400 }],
    })

    await renderDashboard({ ventas: [aCredito] })

    const tarjeta = screen.getByText("Por cobrar").closest(".stat-card")

    expect(tarjeta).toHaveTextContent("600.00")
  })

  it("avisa cuando todavía no hay ventas", async () => {
    await renderDashboard()
    expect(screen.getAllByText(/sin ventas todav/i).length).toBeGreaterThan(0)
  })

  it("lista los productos más vendidos", async () => {
    await renderDashboard({ ventas: [venta()] })

    expect(screen.getByText("Top productos vendidos")).toBeInTheDocument()
    expect(screen.getByText("Martillo")).toBeInTheDocument()
  })
})
