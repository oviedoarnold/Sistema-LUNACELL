import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import InvoiceTemplate from "./InvoiceTemplate"

/*
  Qué imprime el documento según sea factura autorizada o interno.

  Esto se prueba mirando lo que sale, y no las propiedades que entran,
  porque el defecto que arregla INV-3.2 era exactamente de salida: la
  plantilla recibía un objeto fiscal con el CAI vacío y lo pintaba igual,
  de modo que un documento que no es una factura autorizada imprimía un
  «CAI» en blanco. Quien lo leyera no tenía forma de saberlo.
*/

const RENGLONES = [
  { name: "Cargador", quantity: 1, price: 100, subtotal: 100 },
]

const BASE = {
  invoiceNumber: "VTA-000001",
  date: "2026-10-01",
  customerName: "Consumidor Final",
  items: RENGLONES,
  subtotal: 100,
  tax: 15,
  taxRate: 15,
  total: 115,
  paymentType: "contado",
  status: "pagada",
  company: { name: "LUNACELL", address: "Tegucigalpa", currency: "L" },
}

const FISCAL = {
  cai: "A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-12",
  rtn: "08011999123456",
  rangoDesde: 1,
  rangoHasta: 5000,
  fechaLimiteEmision: "2027-12-31",
  correlativo: 9,
  numero: "000-001-01-00000009",
}

describe("InvoiceTemplate · documento interno", () => {
  const interno = () =>
    render(<InvoiceTemplate sale={{ ...BASE, fiscal: null }} />)

  /*
    El defecto que motivó esto. Antes imprimía la etiqueta «CAI» con el
    valor vacío al lado.
  */
  it("no muestra el bloque fiscal", () => {
    interno()

    expect(screen.queryByText("CAI")).not.toBeInTheDocument()
    expect(screen.queryByText(/rango autorizado/i)).not.toBeInTheDocument()
  })

  it("no se presenta como factura", () => {
    interno()

    expect(screen.queryByText("FACTURA")).not.toBeInTheDocument()
  })

  it("dice claramente que es un documento interno", () => {
    interno()

    expect(screen.getByText("DOCUMENTO INTERNO")).toBeInTheDocument()
  })

  it("conserva su número y sus importes", () => {
    interno()

    expect(screen.getAllByText("VTA-000001").length).toBeGreaterThan(0)
    expect(screen.getByText("Cargador")).toBeInTheDocument()
  })

  /*
    La cabecera no es el único sitio donde el documento se nombra. El
    encabezado del bloque de datos decía «Detalle de factura» en todos los
    casos, así que un documento interno seguía llamándose factura un par de
    centímetros más abajo de donde dice que no lo es.
  */
  it("tampoco llama factura al bloque de detalle", () => {
    interno()

    expect(screen.getByText(/detalle del documento/i)).toBeInTheDocument()
    expect(screen.queryByText(/detalle de factura/i)).not.toBeInTheDocument()
  })
})

describe("InvoiceTemplate · factura fiscal", () => {
  const fiscal = () =>
    render(
      <InvoiceTemplate
        sale={{ ...BASE, invoiceNumber: FISCAL.numero, fiscal: FISCAL }}
      />
    )

  it("conserva su bloque fiscal", () => {
    fiscal()

    expect(screen.getByText("CAI")).toBeInTheDocument()
    expect(screen.getByText(FISCAL.cai)).toBeInTheDocument()
  })

  it("se presenta como factura", () => {
    fiscal()

    expect(screen.getByText("FACTURA")).toBeInTheDocument()
    expect(screen.queryByText("DOCUMENTO INTERNO")).not.toBeInTheDocument()
  })

  it("muestra el rango autorizado", () => {
    fiscal()

    expect(screen.getByText(/rango autorizado/i)).toBeInTheDocument()
  })

  it("muestra el RTN del emisor cuando lo hay", () => {
    fiscal()

    expect(screen.getByText(/rtn del emisor/i)).toBeInTheDocument()
  })

  it("sí llama factura a su bloque de detalle", () => {
    fiscal()

    expect(screen.getByText(/detalle de factura/i)).toBeInTheDocument()
  })
})
