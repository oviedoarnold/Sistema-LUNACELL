import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import LocationsProvider from "../context/LocationsContext"
import ProductProvider from "../context/ProductContext"
import SalesProvider from "../context/SalesContext"
import { renderizarPantalla } from "../test/pantallas"
import SalesHistory from "./SalesHistory"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

vi.mock("sweetalert2", () => ({ default: { fire: vi.fn(() => Promise.resolve({})) } }))

const VENTAS = [
  {
    id: "v1",
    invoiceNumber: "VTA-000001",
    clientName: "Ferremax",
    paymentType: "contado",
    status: "pagada",
    total: 207,
    subtotal: 180,
    items: [{ productId: "p1", name: "Cemento gris", qty: 1, price: 180, subtotal: 180 }],
  },
  {
    id: "v2",
    invoiceNumber: "VTA-000002",
    clientName: "Taller Díaz",
    paymentType: "contado",
    status: "pagada",
    total: 115,
    subtotal: 100,
    items: [{ productId: "p1", name: "Cemento gris", qty: 1, price: 100, subtotal: 100 }],
  },
]

const TRAZA = {
  precio_referencia: 250,
  negociado_por_nombre: "Juan Pérez",
  negociado_en: "2026-11-05T15:30:00.000Z",
  motivo_negociacion: "mayoreo",
}

const RENGLONES = [
  { id: "r1", empresa_id: "e-1", venta_id: "v1", producto_id: "p1", nombre: "Cemento gris", codigo: "", cantidad: 1, precio: 180, subtotal: 180, ...TRAZA },
  { id: "r2", empresa_id: "e-1", venta_id: "v2", producto_id: "p1", nombre: "Cemento gris", codigo: "", cantidad: 1, precio: 100, subtotal: 100 },
]

async function render(opciones = {}) {
  const r = await renderizarPantalla(
    <AuthProvider>
      <LocationsProvider>
        <ProductProvider>
          <SalesProvider>
            <SalesHistory />
          </SalesProvider>
        </ProductProvider>
      </LocationsProvider>
    </AuthProvider>,
    { ventas: VENTAS, tablasExtra: { detalle_venta: RENGLONES }, esperar: ["ventas"], ...opciones }
  )

  return r
}

describe("Historial: precios negociados", () => {
  const traza = () => screen.queryByText(/Precio negociado: Cemento gris/)

  it("el administrador ve el precio, la referencia, el motivo y quién lo cambió", async () => {
    await render()

    const texto = (await screen.findByText(/Precio negociado: Cemento gris/)).textContent

    expect(texto).toContain("L 180.00")
    expect(texto).toContain("referencia L 250.00")
    expect(texto).toContain("Compra al por mayor")
    expect(texto).toContain("Juan Pérez")
    expect(texto).toMatch(/0?5\/11\/(20)?26/)
  })

  it("el filtro deja solo las ventas con precio negociado", async () => {
    await render()

    expect(await screen.findByText(/VTA-000002/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Filtrar por tipo de pago"), { target: { value: "negociadas" } })

    expect(screen.getByText(/VTA-000001/)).toBeInTheDocument()
    expect(screen.queryByText(/VTA-000002/)).not.toBeInTheDocument()
  })

  it("un vendedor no ve la trazabilidad ni el filtro", async () => {
    await render({ rolDelUsuario: "vendedor", permisosDelUsuario: ["sales-history"] })

    expect(await screen.findByText(/VTA-000001/)).toBeInTheDocument()
    expect(traza()).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Con precio negociado" })).not.toBeInTheDocument()
  })

  it("el contador tampoco", async () => {
    await render({ rolDelUsuario: "contador", permisosDelUsuario: ["sales-history"] })

    expect(await screen.findByText(/VTA-000001/)).toBeInTheDocument()
    expect(traza()).not.toBeInTheDocument()
  })

  it("no menciona costos", async () => {
    await render()

    await screen.findByText(/Precio negociado: Cemento gris/)

    expect(document.body.textContent).not.toMatch(/costo|margen|utilidad/i)
  })
})
