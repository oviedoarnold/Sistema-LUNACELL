import { describe, it, expect } from "vitest"
import jsPDF from "jspdf"

/*
  jsPDF de verdad, sin simular: lo mismo que pide downloadDocumentPDF
  (carta, vertical, milímetros, una imagen PNG) tiene que producir un PDF
  válido de una página. Es la comprobación que importa al actualizar las
  dependencias de jspdf (A-2): las pruebas de documentUtils.test.js
  simulan la librería y no la ejercitan.
*/

// Un PNG de 1 x 1 píxel en escala de grises (válido: su IDAT descomprime).
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

describe("jsPDF real con las opciones de downloadDocumentPDF", () => {
  it("genera un PDF válido de una página, tamaño carta, con la imagen", () => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" })

    pdf.addImage(PNG, "PNG", 0, 0, 215.9, 279.4)
    const bytes = new Uint8Array(pdf.output("arraybuffer"))
    const texto = new TextDecoder("latin1").decode(bytes)

    expect(texto.startsWith("%PDF-")).toBe(true)
    expect(pdf.getNumberOfPages()).toBe(1)
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(215.9, 1)
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(279.4, 1)
    expect(texto).toContain("/Subtype /Image")
  })
})
