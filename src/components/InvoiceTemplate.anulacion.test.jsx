import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import InvoiceTemplate from "./InvoiceTemplate"

/*
  Un documento anulado conserva su número y su contenido, pero no puede
  pasar por vigente: lleva el sello «DOCUMENTO ANULADO» con la fecha y el
  motivo. Es la misma plantilla que capturan el PDF y la impresión, así
  que lo que se prueba aquí es lo que sale en los tres.
*/

const BASE = {
  invoiceNumber: "VTA-000009",
  date: "24/10/2026",
  customerName: "Taller Central",
  items: [{ name: "Cargador", quantity: 2, price: 100, subtotal: 200 }],
  subtotal: 200,
  tax: 30,
  taxRate: 15,
  total: 230,
  paymentType: "credito",
  status: "pendiente",
  company: { name: "LUNACELL", address: "Tegucigalpa", currency: "L" },
}

const ANULACION = { fecha: "24/10/2026", motivo: "Se registró dos veces por error" }

describe("documento anulado", () => {
  it("lleva el sello con la fecha y el motivo, y conserva número, cliente, productos y total", () => {
    render(<InvoiceTemplate sale={{ ...BASE, status: "anulada", anulacion: ANULACION }} />)

    const sello = screen.getByRole("note")
    expect(sello).toHaveTextContent("DOCUMENTO ANULADO")
    expect(sello).toHaveTextContent("Anulado el 24/10/2026 · Motivo: Se registró dos veces por error")
    for (const texto of ["VTA-000009", "Taller Central", "Cargador", "L 230.00"]) {
      expect(screen.getAllByText(texto, { exact: false }).length).toBeGreaterThan(0)
    }
  })

  it("dice «Anulada» en el estado y no «PENDIENTE DE PAGO» ni saldo pendiente", () => {
    render(<InvoiceTemplate sale={{ ...BASE, status: "anulada", anulacion: ANULACION }} />)

    expect(screen.getByText("Anulada")).toBeInTheDocument()
    expect(screen.queryByText("PENDIENTE DE PAGO")).toBeNull()
    expect(screen.queryByText("Saldo pendiente")).toBeNull()
  })

  it("el sello va dentro de la hoja carta, no fuera de lo que se captura", () => {
    const { container } = render(<InvoiceTemplate sale={{ ...BASE, status: "anulada", anulacion: ANULACION }} />)

    expect(container.querySelector(".receipt.document-letter .inv-anulado")).not.toBeNull()
  })

  it("un documento vigente no lleva sello", () => {
    render(<InvoiceTemplate sale={BASE} />)

    expect(screen.queryByText("DOCUMENTO ANULADO")).toBeNull()
    expect(screen.getByText("PENDIENTE DE PAGO")).toBeInTheDocument()
  })
})
