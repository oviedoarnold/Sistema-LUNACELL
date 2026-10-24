import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/*
  Lo que hacen el PDF y la impresión de facturas y cotizaciones, fijado
  antes de actualizar las dependencias (A-2). html2canvas y jsPDF se
  simulan: aquí se comprueba qué se les pide; que jsPDF de verdad produzca
  el archivo lo comprueba documentUtils.jspdf.test.js.
*/

const canvas = { width: 1000, height: 1200, toDataURL: vi.fn(() => "data:image/png;base64,IMAGEN") }
const html2canvas = vi.fn(async () => canvas)
const pdf = { addImage: vi.fn(), save: vi.fn() }
const jsPDF = vi.fn(function () {
  return pdf
})

vi.mock("html2canvas", () => ({ default: (...args) => html2canvas(...args) }))
vi.mock("jspdf", () => ({ default: function (...args) { return jsPDF(...args) } }))

const { downloadDocumentPDF, printDocumentOnePage } = await import("./documentUtils")

const CARTA = { ancho: 215.9, alto: 279.4 }
const OPCIONES_DE_CAPTURA = { scale: 2, useCORS: true, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0, logging: false }

beforeEach(() => {
  vi.clearAllMocks()
  canvas.width = 1000
  canvas.height = 1200
})

describe("downloadDocumentPDF", () => {
  it("captura el documento indicado con fondo blanco y doble resolución", async () => {
    const elemento = document.createElement("div")

    await downloadDocumentPDF(elemento, "factura")

    expect(html2canvas).toHaveBeenCalledWith(elemento, OPCIONES_DE_CAPTURA)
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/png", 1.0)
  })

  it("crea el PDF en tamaño carta, vertical y en milímetros", async () => {
    await downloadDocumentPDF(document.createElement("div"))

    expect(jsPDF).toHaveBeenCalledWith({ orientation: "portrait", unit: "mm", format: "letter" })
  })

  it("incluye la imagen capturada al ancho de la carta cuando cabe a lo alto", async () => {
    canvas.height = 1000

    await downloadDocumentPDF(document.createElement("div"))

    const [imagen, formato, x, y, ancho, alto] = pdf.addImage.mock.calls[0]
    expect([imagen, formato, x, y]).toEqual(["data:image/png;base64,IMAGEN", "PNG", 0, 0])
    expect(ancho).toBeCloseTo(CARTA.ancho)
    expect(alto).toBeCloseTo(CARTA.ancho)
  })

  it("si el documento es más alto que la carta, lo ajusta al alto y lo centra", async () => {
    canvas.height = 2000

    await downloadDocumentPDF(document.createElement("div"))

    const [, , x, y, ancho, alto] = pdf.addImage.mock.calls[0]
    expect(alto).toBeCloseTo(CARTA.alto)
    expect(ancho).toBeCloseTo(CARTA.alto / 2)
    expect(x).toBeCloseTo((CARTA.ancho - CARTA.alto / 2) / 2)
    expect(y).toBe(0)
  })

  it("guarda con el nombre del documento, añadiendo .pdf solo si falta", async () => {
    await downloadDocumentPDF(document.createElement("div"), "FAC-00008")
    await downloadDocumentPDF(document.createElement("div"), "Cotizacion-9.PDF")
    await downloadDocumentPDF(document.createElement("div"))

    expect(pdf.save.mock.calls.map(([nombre]) => nombre)).toEqual(["FAC-00008.pdf", "Cotizacion-9.PDF", "documento.pdf"])
  })

  it("sin documento avisa y no genera nada", async () => {
    await expect(downloadDocumentPDF(null)).rejects.toThrow("No se encontró el documento para generar el PDF.")

    expect(html2canvas).not.toHaveBeenCalled()
    expect(pdf.save).not.toHaveBeenCalled()
  })

  it("si la captura falla, el error llega a quien llamó y no se guarda un PDF vacío", async () => {
    html2canvas.mockRejectedValueOnce(new Error("captura fallida"))

    await expect(downloadDocumentPDF(document.createElement("div"))).rejects.toThrow("captura fallida")

    expect(pdf.save).not.toHaveBeenCalled()
  })
})

describe("printDocumentOnePage", () => {
  let ventana
  let escrito
  let imagen

  beforeEach(() => {
    vi.useFakeTimers()
    escrito = []
    imagen = { complete: true, onload: null }
    ventana = {
      document: {
        open: vi.fn(),
        write: vi.fn((html) => escrito.push(html)),
        close: vi.fn(),
        getElementById: vi.fn((id) => (id === "document-image" ? imagen : null)),
      },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    }
    vi.spyOn(window, "open").mockReturnValue(ventana)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("abre una ventana, pone la imagen del documento con su título e imprime", async () => {
    const elemento = document.createElement("div")

    await printDocumentOnePage(elemento, "Factura FAC-00008")

    expect(window.open).toHaveBeenCalledWith("", "_blank", "width=950,height=850")
    expect(html2canvas).toHaveBeenCalledWith(elemento, OPCIONES_DE_CAPTURA)
    const pagina = escrito.at(-1)
    expect(pagina).toContain('src="data:image/png;base64,IMAGEN"')
    expect(pagina).toContain("<title>Factura FAC-00008</title>")
    expect(pagina).toContain("size: letter portrait")

    expect(ventana.print).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(ventana.focus).toHaveBeenCalled()
    expect(ventana.print).toHaveBeenCalledTimes(1)
  })

  it("si la imagen todavía no cargó, imprime cuando termina de cargar", async () => {
    imagen.complete = false

    await printDocumentOnePage(document.createElement("div"))
    vi.advanceTimersByTime(1000)
    expect(ventana.print).not.toHaveBeenCalled()

    imagen.onload()
    vi.advanceTimersByTime(250)
    expect(ventana.print).toHaveBeenCalledTimes(1)
  })

  it("sin documento avisa y no abre ninguna ventana", async () => {
    await expect(printDocumentOnePage(null)).rejects.toThrow("No se encontró el documento para imprimir.")

    expect(window.open).not.toHaveBeenCalled()
  })

  it("si el navegador bloquea la ventana, dice cómo permitirla", async () => {
    window.open.mockReturnValue(null)

    await expect(printDocumentOnePage(document.createElement("div"))).rejects.toThrow(
      "El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio."
    )
    expect(html2canvas).not.toHaveBeenCalled()
  })

  it("si la captura falla, cierra la ventana y el error llega a quien llamó", async () => {
    html2canvas.mockRejectedValueOnce(new Error("captura fallida"))

    await expect(printDocumentOnePage(document.createElement("div"))).rejects.toThrow("captura fallida")

    expect(ventana.close).toHaveBeenCalled()
    expect(ventana.print).not.toHaveBeenCalled()
  })
})
