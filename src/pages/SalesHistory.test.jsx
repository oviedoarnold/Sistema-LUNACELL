import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import SalesProvider from "../context/SalesContext"
import { EMPRESA_PRUEBA, renderizarPantalla } from "../test/pantallas"
import SalesHistory from "./SalesHistory"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const empresa = { name: EMPRESA_PRUEBA.nombre, currency: "L", taxRate: 15 }

const factura = (extra = {}) => ({
  id: "F-1",
  invoiceNumber: "FAC-01001",
  date: "20/08/2026",
  timestamp: Date.now(),
  clientName: "Ferremax",
  rtn: "0801199912345",
  items: [
    { productId: "p1", name: "Martillo", qty: 1, quantity: 1, price: 180, subtotal: 180 },
  ],
  subtotal: 180,
  tax: 27,
  total: 207,
  paymentType: "contado",
  type: "contado",
  status: "pagada",
  company: empresa,
  ...extra,
})

const aCredito = (extra = {}) =>
  factura({
    id: "F-2",
    invoiceNumber: "FAC-01002",
    clientName: "Constructora López",
    paymentType: "credito",
    type: "credito",
    status: "pendiente",
    total: 1000,
    dueDate: "2027-01-31",
    ...extra,
  })

function renderHistory(ventas = []) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <SalesProvider>
          <SalesHistory />
        </SalesProvider>
      </ProductProvider>
    </AuthProvider>,
    { ventas, esperar: ["ventas"] }
  )
}

const filaDe = (numero) =>
  screen.getByText(numero, { exact: false }).closest(".sale-card")

describe("SalesHistory sin ventas", () => {
  it("invita a generar la primera factura", async () => {
    await renderHistory()
    expect(screen.getByText(/no hay facturas registradas/i)).toBeInTheDocument()
  })
})

describe("SalesHistory con ventas", () => {
  it("lista las facturas", async () => {
    await renderHistory([factura(), aCredito()])

    expect(screen.getByText("Ferremax")).toBeInTheDocument()
    expect(screen.getByText("Constructora López")).toBeInTheDocument()
  })

  it("cuenta las facturas registradas", async () => {
    await renderHistory([factura(), aCredito()])

    const tarjeta = screen.getByText("Facturas").closest(".stat-card")

    expect(tarjeta).toHaveTextContent("2")
  })

  it("separa las ventas de contado de las de crédito", async () => {
    await renderHistory([factura(), aCredito()])

    expect(
      screen.getByText("Ventas contado").closest(".stat-card")
    ).toHaveTextContent("1")

    expect(
      screen.getByText("Ventas crédito").closest(".stat-card")
    ).toHaveTextContent("1")
  })

  it("suma el total facturado", async () => {
    await renderHistory([factura(), aCredito()])
    expect(screen.getByText("L 1,207.00")).toBeInTheDocument()
  })

  it("muestra el saldo por cobrar solo de lo pendiente", async () => {
    await renderHistory([factura(), aCredito()])

    const resumen = screen
      .getByText("Saldo por cobrar")
      .closest("div")

    expect(resumen).toHaveTextContent("L 1,000.00")
  })

  it("marca pagada la venta de contado", async () => {
    await renderHistory([factura()])
    expect(within(filaDe("FAC-01001")).getByText("Pagada")).toBeInTheDocument()
  })

  it("marca pendiente la venta a crédito", async () => {
    await renderHistory([aCredito()])
    expect(within(filaDe("FAC-01002")).getByText("Pendiente")).toBeInTheDocument()
  })

  it("marca vencida la que pasó su fecha de pago", async () => {
    await renderHistory([aCredito({ dueDate: "2020-01-01" })])
    expect(within(filaDe("FAC-01002")).getByText("Vencida")).toBeInTheDocument()
  })

  it("marca cancelada la venta a crédito ya saldada", async () => {
    await renderHistory([
      aCredito({ status: "pagada", payments: [{ id: "a1", amount: 1000 }] }),
    ])

    expect(
      within(filaDe("FAC-01002")).getByText("Cancelada")
    ).toBeInTheDocument()
  })
})

describe("SalesHistory: abonos", () => {
  it("ofrece abonar solo en las facturas a crédito con saldo", async () => {
    await renderHistory([factura(), aCredito()])

    expect(
      within(filaDe("FAC-01002")).getByRole("button", { name: /abonar/i })
    ).toBeInTheDocument()

    expect(
      within(filaDe("FAC-01001")).queryByRole("button", { name: /abonar/i })
    ).not.toBeInTheDocument()
  })

  it("muestra lo abonado y lo que resta", async () => {
    await renderHistory([aCredito({ payments: [{ id: "a1", amount: 400 }] })])

    const fila = filaDe("FAC-01002")

    expect(fila).toHaveTextContent("Abonado")
    expect(fila).toHaveTextContent("Resta")
  })

  it("abre el modal de abonos con el saldo actual", async () => {
    await renderHistory([aCredito({ payments: [{ id: "a1", amount: 400 }] })])

    fireEvent.click(
      within(filaDe("FAC-01002")).getByRole("button", { name: /abonar/i })
    )

    expect(screen.getByText(/abonar a/i)).toBeInTheDocument()
    expect(screen.getByText("Saldo")).toBeInTheDocument()
  })

  it("el monto no permite superar el saldo pendiente", async () => {
    await renderHistory([aCredito()])

    fireEvent.click(screen.getByRole("button", { name: /abonar/i }))

    expect(screen.getByPlaceholderText("0.00")).toHaveAttribute("max", "1000")
  })

  it("lista los abonos ya registrados", async () => {
    await renderHistory([
      aCredito({
        payments: [
          { id: "a1", amount: 400, date: "22/08/2026", note: "Efectivo" },
        ],
      }),
    ])

    fireEvent.click(screen.getByRole("button", { name: /abonar/i }))

    expect(screen.getByText(/abonos registrados/i)).toBeInTheDocument()
    expect(screen.getByText(/efectivo/i)).toBeInTheDocument()
  })
})

describe("SalesHistory: filtros", () => {
  it("busca por nombre de cliente", async () => {
    await renderHistory([factura(), aCredito()])

    fireEvent.change(screen.getByPlaceholderText(/buscar por cliente/i), {
      target: { value: "ferremax" },
    })

    expect(screen.getByText("Ferremax")).toBeInTheDocument()
    expect(screen.queryByText("Constructora López")).not.toBeInTheDocument()
  })

  it("busca por número de factura", async () => {
    await renderHistory([factura(), aCredito()])

    fireEvent.change(screen.getByPlaceholderText(/buscar por cliente/i), {
      target: { value: "FAC-01002" },
    })

    expect(screen.getByText("Constructora López")).toBeInTheDocument()
    expect(screen.queryByText("Ferremax")).not.toBeInTheDocument()
  })

  it("filtra por forma de pago", async () => {
    await renderHistory([factura(), aCredito()])

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "credito" },
    })

    expect(screen.getByText("Constructora López")).toBeInTheDocument()
    expect(screen.queryByText("Ferremax")).not.toBeInTheDocument()
  })

  it("avisa cuando el filtro no deja resultados", async () => {
    await renderHistory([factura()])

    fireEvent.change(screen.getByPlaceholderText(/buscar por cliente/i), {
      target: { value: "cliente-inexistente" },
    })

    expect(screen.getByText(/no se encontraron facturas/i)).toBeInTheDocument()
  })
})
