import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

import { escalaParaAncho } from "../../hooks/useEscalaDeLaHoja"

/*
  R-3: la hoja carta de facturas y cotizaciones mide 816 × 1056 px. En un
  teléfono no cabe: se muestra reducida, entera y con sus proporciones,
  y se recorre hacia abajo. La reducción es solo de la pantalla: el PDF y
  la impresión se capturan siempre a tamaño real.

  jsdom no calcula medidas, así que se fijan: el ancho disponible es el de
  .receipt-wrap y la hoja mide lo que mide la carta.
*/

vi.mock("../../utils/documentUtils", async (original) => ({
  ...(await original()),
  downloadDocumentPDF: vi.fn(async () => {}),
  printDocumentOnePage: vi.fn(async () => {}),
}))

const { downloadDocumentPDF, printDocumentOnePage, prepararCopiaParaCaptura } = await import("../../utils/documentUtils")
const { default: DocumentPreviewModal } = await import("./DocumentPreviewModal")

const CARTA = { ancho: 816, alto: 1056 }
let anchoDisponible = 328

const medidas = {
  clientWidth() {
    return this.classList.contains("receipt-wrap") ? anchoDisponible : 0
  },
  offsetWidth() {
    return this.classList.contains("vista-hoja-documento") ? CARTA.ancho : 0
  },
  offsetHeight() {
    return this.classList.contains("vista-hoja-documento") ? CARTA.alto : 0
  },
}

const originales = {}

beforeEach(() => {
  vi.clearAllMocks()
  anchoDisponible = 328
  for (const [nombre, medir] of Object.entries(medidas)) {
    originales[nombre] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, nombre)
    Object.defineProperty(HTMLElement.prototype, nombre, { configurable: true, get: medir })
  }
})

afterEach(() => {
  for (const [nombre, descriptor] of Object.entries(originales)) {
    // clientWidth vive en Element, no en HTMLElement: basta con quitar la falsa.
    if (descriptor) Object.defineProperty(HTMLElement.prototype, nombre, descriptor)
    else delete HTMLElement.prototype[nombre]
  }
})

function abrir() {
  return render(
    <DocumentPreviewModal open title="Factura" fileName="FAC-9.pdf" onClose={() => {}}>
      <div className="receipt document-letter">Factura VTA-000009 · Total L 138.00</div>
    </DocumentPreviewModal>
  )
}

const caja = () => document.querySelector(".vista-hoja")
const escalada = () => document.querySelector(".vista-hoja-escala")
const px = (valor) => Number.parseFloat(valor)

describe("escalaParaAncho", () => {
  it.each([
    ["teléfono de 360 px", 328, 0.401],
    ["teléfono de 430 px", 398, 0.487],
    ["tableta de 768 px", 720, 0.882],
  ])("en un %s reduce la hoja hasta que quepa", (_, disponible, esperada) => {
    const escala = escalaParaAncho(disponible, CARTA.ancho)

    expect(escala).toBe(esperada)
    expect(CARTA.ancho * escala).toBeLessThanOrEqual(disponible)
  })

  it("si la hoja cabe, no la agranda: se queda a tamaño real", () => {
    expect(escalaParaAncho(880, CARTA.ancho)).toBe(1)
  })

  it("sin medidas todavía, no reduce nada", () => {
    expect(escalaParaAncho(0, CARTA.ancho)).toBe(1)
    expect(escalaParaAncho(328, 0)).toBe(1)
  })
})

describe("vista previa en el teléfono", () => {
  it("la hoja se reduce al ancho disponible y conserva sus proporciones", () => {
    abrir()

    expect(escalada().style.transform).toBe("scale(0.401)")
    const ancho = px(caja().style.width)
    const alto = px(caja().style.height)
    expect(ancho).toBeLessThanOrEqual(anchoDisponible)
    expect(ancho / alto).toBeCloseTo(CARTA.ancho / CARTA.alto, 6)
  })

  it("la caja ocupa lo que ocupa la hoja reducida: se recorre hacia abajo sin espacio sobrante", () => {
    abrir()

    expect(px(caja().style.height)).toBeCloseTo(CARTA.alto * 0.401, 6)
    expect(px(caja().style.height)).toBeGreaterThan(px(caja().style.width))
  })

  it("al girar el teléfono vuelve a calcular la reducción", () => {
    abrir()
    expect(escalada().style.transform).toBe("scale(0.401)")

    anchoDisponible = 720
    act(() => {
      globalThis.dispatchEvent(new Event("orientationchange"))
    })
    expect(escalada().style.transform).toBe("scale(0.882)")

    anchoDisponible = 328
    act(() => {
      globalThis.dispatchEvent(new Event("resize"))
    })
    expect(escalada().style.transform).toBe("scale(0.401)")
  })

  it("Descargar PDF, Imprimir y Cerrar siguen ahí y funcionan", async () => {
    const onClose = vi.fn()
    render(
      <DocumentPreviewModal open title="Factura" fileName="FAC-9.pdf" printTitle="Factura FAC-9" onClose={onClose}>
        <div className="receipt document-letter">Factura</div>
      </DocumentPreviewModal>
    )

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /descargar pdf/i })))
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /imprimir/i })))
    fireEvent.click(screen.getAllByRole("button", { name: "Cerrar" }).at(-1))

    expect(downloadDocumentPDF).toHaveBeenCalledTimes(1)
    expect(printDocumentOnePage).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it("lo que se captura es el documento, no la caja reducida", async () => {
    abrir()

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /descargar pdf/i })))

    const [capturado, nombre] = downloadDocumentPDF.mock.calls[0]
    expect(nombre).toBe("FAC-9.pdf")
    expect(capturado).toHaveClass("vista-hoja-documento")
    expect(capturado.style.transform).toBe("")
    expect(capturado).toHaveTextContent("Factura VTA-000009 · Total L 138.00")
  })

  it("en la copia que se captura no queda ninguna reducción; la pantalla sigue reducida", () => {
    abrir()
    const copia = document.implementation.createHTMLDocument("")
    copia.body.innerHTML = document.body.innerHTML

    prepararCopiaParaCaptura(copia)

    for (const elemento of copia.querySelectorAll("[data-reduccion-de-vista]")) {
      expect(elemento.style.transform).toBe("")
      expect(elemento.style.width).toBe("")
      expect(elemento.style.height).toBe("")
    }
    expect(copia.querySelectorAll("[data-reduccion-de-vista]")).toHaveLength(2)
    expect(escalada().style.transform).toBe("scale(0.401)")
  })

  it("Ampliar muestra la hoja a tamaño real, y Ajustar a la pantalla la vuelve a reducir", () => {
    abrir()

    fireEvent.click(screen.getByRole("button", { name: /ampliar/i }))
    expect(escalada().style.transform).toBe("")
    expect(caja().style.width).toBe("")

    fireEvent.click(screen.getByRole("button", { name: /ajustar a la pantalla/i }))
    expect(escalada().style.transform).toBe("scale(0.401)")
  })
})

describe("vista previa en el escritorio", () => {
  it("la hoja cabe: se ve a tamaño real, sin reducción ni botón de ampliar", () => {
    anchoDisponible = 880

    abrir()

    expect(escalada().getAttribute("style")).toBeNull()
    expect(caja().getAttribute("style")).toBeNull()
    expect(screen.queryByRole("button", { name: /ampliar/i })).toBeNull()
  })
})
