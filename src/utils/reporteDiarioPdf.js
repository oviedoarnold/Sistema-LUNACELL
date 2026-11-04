import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

import {
  celdaParaLeer,
  indicadoresDelReporte,
  seccionesDelReporte,
} from "./reporteDiario"

const MARGEN = 12

/*
  El reporte en PDF, horizontal porque las tablas son anchas. Se dibuja como
  texto y no como captura de la pantalla: un día con muchas ventas ocupa
  varias páginas, y una imagen no se parte bien.
*/
export function reporteEnPdf(reporte, nombreDeUbicacion = "Todas") {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" })
  const { moneda } = reporte

  pdf.setFontSize(14)
  pdf.text(`Reporte diario de ventas: ${reporte.empresa}`, MARGEN, 14)
  pdf.setFontSize(10)
  pdf.text(`Día: ${reporte.dia} (hora de Honduras)   Ubicación: ${nombreDeUbicacion}`, MARGEN, 20)

  autoTable(pdf, {
    startY: 24,
    margin: { left: MARGEN, right: MARGEN },
    head: [["Indicador", "Valor", "Detalle"]],
    body: indicadoresDelReporte(reporte).map((i) => [i.etiqueta, celdaParaLeer(i.valor, i.tipo, moneda), i.detalle || ""]),
    styles: { fontSize: 8 },
  })

  for (const seccion of seccionesDelReporte(reporte)) {
    const inicio = pdf.lastAutoTable.finalY + 10

    pdf.setFontSize(11)
    pdf.text(seccion.titulo, MARGEN, inicio - 2)

    autoTable(pdf, {
      startY: inicio,
      margin: { left: MARGEN, right: MARGEN },
      head: [seccion.columnas.map((c) => c.titulo)],
      body: seccion.filas.length
        ? seccion.filas.map((fila) => fila.celdas.map((valor, i) => celdaParaLeer(valor, seccion.columnas[i].tipo, moneda)))
        : [[{ content: seccion.vacio, colSpan: seccion.columnas.length }]],
      styles: { fontSize: 7, overflow: "linebreak" },
      columnStyles: Object.fromEntries(
        seccion.columnas.flatMap((c, i) => (c.tipo === "texto" ? [] : [[i, { halign: "right" }]]))
      ),
    })
  }

  return pdf
}
