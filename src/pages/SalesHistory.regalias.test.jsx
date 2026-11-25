import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import SalesProvider from "../context/SalesContext"
import { EMPRESA, EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import SalesHistory from "./SalesHistory"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  Regalías en el historial (0054): la venta sigue con su total; lo regalado va
  aparte, sin cargo. Si la venta se anuló, la regalía se sigue viendo como
  entregada y no restituida.
*/

const empresa = { name: EMPRESA_PRUEBA.nombre, currency: "L", taxRate: 15 }

const venta = (extra = {}) => ({
  id: "V-1",
  invoiceNumber: "VTA-000009",
  isoDate: new Date().toISOString(),
  timestamp: Date.now(),
  clientId: "c1",
  clientName: "Ferremax",
  items: [{ productId: "p1", name: "Cargador", qty: 5, quantity: 5, price: 100, subtotal: 500 }],
  subtotal: 500,
  tax: 75,
  total: 575,
  paymentType: "contado",
  status: "pagada",
  company: empresa,
  ...extra,
})

const REGALIA = {
  id: "rg-1",
  empresa_id: EMPRESA,
  venta_id: "V-1",
  producto_id: "p1",
  nombre: "Cargador",
  codigo: "C-1",
  cantidad: 1,
  motivo: "cortesia_comercial",
  detalle_motivo: "",
  usuario_nombre: "Vendedora",
  costo_unitario: 37,
}

const renderHistory = (ventas) =>
  renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <SalesProvider>
          <SalesHistory />
        </SalesProvider>
      </ProductProvider>
    </AuthProvider>,
    { ventas, tablasExtra: { regalias_venta: [REGALIA] }, esperar: ["ventas"] }
  )

const tarjeta = (numero) => screen.getByText(numero, { exact: false }).closest(".sale-card")

describe("19. regalías en el historial de ventas", () => {
  it("la venta conserva su total y muestra la regalía sin cargo; la factura la separa de lo vendido", async () => {
    await renderHistory([venta()])

    expect(tarjeta("VTA-000009")).toHaveTextContent("Regalías sin cargo: Cargador × 1")
    expect(within(tarjeta("VTA-000009")).getByText("L 575.00")).toBeInTheDocument()

    fireEvent.click(within(tarjeta("VTA-000009")).getByRole("button", { name: "Ver factura" }))

    const regalias = await screen.findByLabelText("Regalías y cortesías")
    expect(within(regalias).getByText("SIN CARGO")).toBeInTheDocument()
    expect(within(regalias).getByText("Motivo: Cortesía comercial")).toBeInTheDocument()
    expect(within(regalias).queryByText(/37/)).toBeNull()
  })

  it("E. anulada: la regalía sigue a la vista, entregada y no restituida", async () => {
    await renderHistory([venta({ status: "anulada" })])

    expect(tarjeta("VTA-000009")).toHaveTextContent("entregadas y no restituidas al anular")

    fireEvent.click(within(tarjeta("VTA-000009")).getByRole("button", { name: "Ver factura" }))

    const regalias = await screen.findByLabelText("Regalías y cortesías")
    expect(regalias).toHaveTextContent("Documento anulado: la regalía se entregó al cliente y no se restituyó al inventario.")
  })
})
