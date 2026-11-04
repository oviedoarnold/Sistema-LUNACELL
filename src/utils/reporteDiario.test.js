import { describe, it, expect } from "vitest"

import { REPORTE, REPORTE_VACIO } from "../test/reporteDePrueba"
import {
  celdaParaLeer,
  fechaYHoraEnHonduras,
  hoyEnHonduras,
  indicadoresDelReporte,
  nombreDelArchivo,
  reporteEnCsv,
  seccionesDelReporte,
} from "./reporteDiario"
import { reporteEnPdf } from "./reporteDiarioPdf"

const seccion = (id, reporte = REPORTE) => seccionesDelReporte(reporte).find((s) => s.id === id)

describe("el día en Honduras", () => {
  it("a las 05:59 UTC todavía es el día anterior; a las 06:00, ya el siguiente", () => {
    expect(hoyEnHonduras(new Date("2026-03-11T05:59:59Z"))).toBe("2026-03-10")
    expect(hoyEnHonduras(new Date("2026-03-11T06:00:00Z"))).toBe("2026-03-11")
  })

  it("la hora se escribe en Honduras, no en la del navegador", () => {
    expect(fechaYHoraEnHonduras("2026-03-11T05:59:00Z")).toMatch(/10\/03\/2026.*23:59/)
  })
})

describe("las secciones del reporte", () => {
  it("el detalle lleva lo pedido, con el estado y el origen de cada venta", () => {
    const { columnas, filas } = seccion("operaciones")

    expect(columnas.map((c) => c.titulo)).toEqual([
      "Fecha y hora", "Correlativo", "Ubicación", "Vendedor", "Cliente", "Productos", "Forma de pago", "Total", "Estado",
    ])
    expect(filas[0].celdas).toEqual([
      expect.stringMatching(/23:59/), "INT-00001", "Camión 01", "Chofer Uno", "=SUMA(A1), \"Ferremax\"",
      "1 x Cargador, 2 x Cubo", "Contado", 115, "Pagada (Sin conexión)",
    ])
    expect(filas[1].celdas.at(-1)).toBe("Anulada")
  })

  it("un traslado dice de dónde a dónde, y los tipos se escriben en palabras", () => {
    const { filas } = seccion("movimientos")

    expect(filas[1].celdas).toContain("Traslado: salida")
    expect(filas[1].celdas).toContain("Camión 01 a Camión 02")
    expect(seccion("resumen-movimientos").filas.map((f) => f.celdas[0])).toEqual(["Traslado: salida", "Venta"])
  })

  it("la anulación dice qué pasó con el dinero", () => {
    expect(seccion("anulaciones").filas[0].celdas).toContain("Reembolso pendiente")
  })

  it("un abono lleva su fecha y la de su venta por separado", () => {
    const { columnas, filas } = seccion("abonos")

    expect(columnas.map((c) => c.titulo)).toContain("Fecha del abono")
    expect(columnas.map((c) => c.titulo)).toContain("Fecha de la venta")
    expect(filas[0].celdas[0]).toMatch(/10\/03\/2026/)
    expect(filas[0].celdas[2]).toMatch(/01\/02\/2026/)
  })

  it("ninguna columna habla de costos ni márgenes", () => {
    const textos = seccionesDelReporte(REPORTE).flatMap((s) => s.columnas.map((c) => c.titulo))
    const etiquetas = indicadoresDelReporte(REPORTE).map((i) => i.etiqueta)

    expect([...textos, ...etiquetas].join(" ")).not.toMatch(/costo|margen|utilidad/i)
  })

  it("los importes se escriben con la moneda de la empresa y sus dos decimales", () => {
    expect(celdaParaLeer(345.1, "dinero", "L")).toBe("L 345.10")
    expect(celdaParaLeer(-3, "numero", "L")).toBe("-3")
  })
})

describe("el CSV", () => {
  const lineas = reporteEnCsv(REPORTE, "Todas").split("\r\n")

  it("empieza con BOM para que Excel lea los acentos", () => {
    expect(reporteEnCsv(REPORTE).charCodeAt(0)).toBe(0xfeff)
  })

  it("los importes llevan dos decimales exactos y sin moneda", () => {
    expect(lineas).toContain("Ventas válidas,345.10")
    expect(lineas).toContain("Camión 01,2,345.10,172.55,115.00,230.10,50.00,165.00,80.00")
  })

  it("neutraliza un texto que Excel ejecutaría como fórmula, y lo escapa", () => {
    const venta = lineas.find((l) => l.includes("INT-00001") && l.includes("SUMA"))

    expect(venta).toContain(`"'=SUMA(A1), ""Ferremax"""`)
  })

  it("una cantidad negativa sigue siendo un número", () => {
    expect(lineas).toContain("Traslado: salida,1,-3")
  })

  it("lleva cada sección bajo su título, también si está vacía", () => {
    const vacio = reporteEnCsv(REPORTE_VACIO)

    for (const titulo of ["Ventas por ubicación", "Ventas por vendedor", "Detalle de operaciones", "Abonos cobrados", "Anulaciones", "Movimientos de inventario"]) {
      expect(vacio).toContain(titulo)
    }
  })

  it("no menciona costos", () => {
    expect(reporteEnCsv(REPORTE)).not.toMatch(/costo|margen|utilidad/i)
  })
})

describe("el PDF", () => {
  it("con jsPDF de verdad: lleva títulos, importes y ventas, sin costos", () => {
    const pdf = reporteEnPdf(REPORTE, "Camión 01")
    const texto = new TextDecoder("latin1").decode(new Uint8Array(pdf.output("arraybuffer")))

    expect(texto.startsWith("%PDF-")).toBe(true)

    for (const esperado of ["Ventas por ubicaci", "Detalle de operaciones", "L 345.10", "INT-00001", "Traslado: salida"]) {
      expect(texto).toContain(esperado)
    }

    expect(texto).not.toMatch(/\(Costo|\(Margen|\(Utilidad/)
    expect(pdf.internal.pageSize.getWidth()).toBeGreaterThan(pdf.internal.pageSize.getHeight())
  })

  it("un día sin datos también genera el documento", () => {
    const pdf = reporteEnPdf(REPORTE_VACIO)
    const texto = new TextDecoder("latin1").decode(new Uint8Array(pdf.output("arraybuffer")))

    expect(texto).toContain("No hay ventas registradas")
  })

  it("el archivo se nombra con el día", () => {
    expect(nombreDelArchivo(REPORTE, "pdf")).toBe("reporte-diario-2026-03-10.pdf")
  })
})
