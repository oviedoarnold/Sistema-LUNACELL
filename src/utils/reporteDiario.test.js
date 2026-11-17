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
      "Fecha y hora", "Correlativo", "Ubicación", "Vendedor", "Cliente", "Productos", "Forma de pago", "Medio de pago", "Total", "Estado",
    ])
    expect(filas[0].celdas).toEqual([
      expect.stringMatching(/23:59/), "INT-00001", "Camión 01", "Chofer Uno", "=SUMA(A1), \"Ferremax\"",
      "1 x Cargador, 2 x Cubo", "Contado", "Efectivo 15.00, Tarjeta 100.00 (AUT-9)", 115, "Pagada (Sin conexión)",
    ])
    expect(filas[1].celdas.at(-1)).toBe("Anulada")
  })

  it("el medio de una venta lleva su cargo con el porcentaje con que se cobró", () => {
    const conCargo = {
      ...REPORTE,
      medios: {
        ...REPORTE.medios,
        por_venta: {
          "v-1": [
            { medio: "efectivo", monto: 15, cargo: 0, tasa: 0, referencia: "" },
            { medio: "tarjeta", monto: 100, cargo: 1.7, tasa: 1.7, referencia: "AUT-9" },
          ],
        },
      },
    }

    expect(seccionesDelReporte(conCargo).find((s) => s.id === "operaciones").filas[0].celdas).toContain(
      "Efectivo 15.00, Tarjeta 100.00 (AUT-9) + cargo 1.70 al 1.7 %"
    )
  })

  it("cobros sin medio dicen «Sin registrar», y una venta a crédito no lleva medio", () => {
    const sinMedios = { ...REPORTE, medios: { ...REPORTE.medios, por_venta: {}, por_abono: {}, por_anulacion: {} } }
    const operaciones = seccionesDelReporte(sinMedios).find((s) => s.id === "operaciones")
    const aCredito = seccionesDelReporte({
      ...sinMedios,
      ventas: [{ ...REPORTE.ventas[0], forma_pago: "credito" }],
    }).find((s) => s.id === "operaciones")
    const abonos = seccionesDelReporte(sinMedios).find((s) => s.id === "abonos")

    expect(operaciones.filas[0].celdas).toContain("Sin registrar")
    expect(aCredito.filas[0].celdas).not.toContain("Sin registrar")
    expect(abonos.filas[0].celdas).toContain("Sin registrar")
  })

  it("los cobros por medio llevan su cargo, y la sección no menciona costos", () => {
    const { columnas, filas } = seccion("medios")

    expect(columnas.map((c) => c.titulo)).toEqual(["Medio", "Operaciones", "Cobrado", "Cargo", "Total cobrado"])
    expect(filas[1].celdas).toEqual(["Tarjeta", 1, 100, 7, 107])
    expect(filas[2].celdas[0]).toBe("Sin registrar")
    expect(JSON.stringify(REPORTE.medios)).not.toMatch(/costo|margen|utilidad/i)
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

/*
  La caja por ubicación (0046): el cobro de un pedido es de la ubicación que
  recibió el dinero; la venta, de la que factura.
*/
describe("los pedidos y las liquidaciones", () => {
  const CON_PEDIDOS = {
    ...REPORTE,
    indicadores: { ...REPORTE.indicadores, cobros_por_cuenta_de_otras: 220, cobros_por_cuenta_de_otras_cantidad: 1 },
    ventas: [
      { ...REPORTE.ventas[0], id: "v-ped", numero: "VTA-000023", pedido: "PED-000001", cobrado_en: "Lunacell Bodega", origen: "en_linea" },
    ],
    cobros_de_pedidos: [
      {
        id: "c-1", fecha: "2026-03-10T16:00:00Z", ubicacion_id: "bodega", ubicacion: "Lunacell Bodega", medio: "efectivo", monto: 220, cargo: 0,
        pedido: "PED-000001", destino: "Ruta local", cliente: "Ferremax", factura: "VTA-000023",
      },
      {
        id: "c-2", fecha: "2026-03-10T17:00:00Z", ubicacion_id: "bodega", ubicacion: "Lunacell Bodega", medio: "tarjeta", monto: 100, cargo: 1.7,
        pedido: "PED-000003", destino: "Ruta local", cliente: "Ana", factura: null,
      },
    ],
    saldos_por_liquidar: [
      { origen_id: "bodega", origen: "Lunacell Bodega", destino_id: "ruta", destino: "Ruta local", efectivo: 410, pendiente: 210, por_confirmar: 100, liquidado: 100 },
    ],
    liquidaciones_del_dia: [
      { id: "l-1", numero: "LIQ-000001", origen: "Lunacell Bodega", destino: "Ruta local", metodo: "entrega_en_efectivo", referencia: "Sobre 3", registrada_por: "Encargado", estado: "por_confirmar", monto: 100 },
    ],
  }

  it("un indicador dice cuánto se cobró por cuenta de otra ubicación", () => {
    const indicador = indicadoresDelReporte(CON_PEDIDOS).find((i) => i.id === "por-cuenta-de-otras")

    expect(indicador).toMatchObject({ etiqueta: "Cobrado por cuenta de otra ubicación", valor: 220, detalle: "1 cobro de pedidos que factura otra ubicación" })
    expect(indicadoresDelReporte(REPORTE).find((i) => i.id === "por-cuenta-de-otras").valor).toBe(0)
  })

  it("los cobros de pedidos llevan quién cobró, para quién, el medio real y si ya se facturó", () => {
    const { filas } = seccion("cobros-de-pedidos", CON_PEDIDOS)

    expect(filas.map((f) => f.celdas.slice(1))).toEqual([
      ["PED-000001", "Lunacell Bodega", "Ruta local: VTA-000023", "Ferremax", "Efectivo", 220, 0],
      ["PED-000003", "Lunacell Bodega", "Ruta local: sin facturar", "Ana", "Tarjeta", 100, 1.7],
    ])
  })

  it("la factura de un pedido dice de qué pedido sale y dónde se cobró", () => {
    expect(seccion("operaciones", CON_PEDIDOS).filas[0].celdas.at(-1)).toBe("Pagada · pedido PED-000001, cobrado en Lunacell Bodega")
  })

  it("muestra lo pendiente, lo por confirmar y lo liquidado, y las liquidaciones del día", () => {
    expect(seccion("saldos-por-liquidar", CON_PEDIDOS).filas[0].celdas).toEqual(["Lunacell Bodega", "Ruta local", 410, 210, 100, 100])
    expect(seccion("liquidaciones", CON_PEDIDOS).filas[0].celdas).toEqual([
      "LIQ-000001", "Lunacell Bodega", "Ruta local", "Entrega en efectivo", "Sobre 3", "Encargado", "Pendiente de confirmación", 100,
    ])
  })

  it("sin datos de pedidos, las secciones quedan vacías y el CSV las incluye", () => {
    expect(seccion("cobros-de-pedidos").filas).toEqual([])
    expect(seccion("saldos-por-liquidar").filas).toEqual([])

    const csv = reporteEnCsv(CON_PEDIDOS, "Todas")

    expect(csv).toContain("Cobros por cuenta de otra ubicación (pedidos)")
    expect(csv).toContain("LIQ-000001")
  })
})
