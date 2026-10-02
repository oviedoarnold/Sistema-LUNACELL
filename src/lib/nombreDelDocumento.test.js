import { describe, it, expect } from "vitest"

import { nombreDelDocumento } from "./nombreDelDocumento"

/*
  El nombre del archivo es lo único del documento que sobrevive a la
  pantalla: «Factura-VTA-000009.pdf» guardado en un disco afirma por sí
  solo algo que no es cierto, y nadie va a volver a abrir la aplicación
  para comprobarlo.
*/
describe("nombreDelDocumento", () => {
  it("llama factura a la venta fiscal", () => {
    expect(nombreDelDocumento({ fiscal: { cai: "CAI-1" } })).toBe("Factura")
  })

  it("no llama factura a la venta interna", () => {
    expect(nombreDelDocumento({ fiscal: null })).toBe("Documento")
  })

  /*
    Mira `fiscal`, no el número ni el estado, que es la misma propiedad que
    mira la plantilla.
  */
  it("no se fija en el número, que es solo una forma", () => {
    expect(
      nombreDelDocumento({ invoiceNumber: "000-001-01-00000009", fiscal: null })
    ).toBe("Documento")
  })

  it("aguanta que no haya venta seleccionada", () => {
    expect(nombreDelDocumento(null)).toBe("Documento")
    expect(nombreDelDocumento(undefined)).toBe("Documento")
  })
})
