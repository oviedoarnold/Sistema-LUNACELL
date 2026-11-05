/*
  Cómo se presenta el reporte diario.

  Aquí no se suma ni se redondea ningún importe: los calcula
  reporte_diario() en la base, con decimales exactos. Las tablas de la
  pantalla, el CSV y el PDF salen de las mismas secciones, así que no pueden
  decir cosas distintas.
*/

import { textoDelTratamiento } from "./anulacion"
import { formatMoney } from "./format"
import { etiquetaDelMedio, textoDeMedios } from "./mediosDePago"

const ZONA = "America/Tegucigalpa"

export const FORMA_DE_PAGO = { contado: "Contado", credito: "Crédito" }

export const ESTADO_DE_VENTA = { pendiente: "Pendiente de cobro", pagada: "Pagada", anulada: "Anulada" }

const ORIGEN_DE_VENTA = { en_linea: "", sin_conexion: "Sin conexión", conciliacion: "Conciliada" }

export const CLASE_DE_MOVIMIENTO = {
  venta: "Venta",
  anulacion_venta: "Anulación de venta",
  traslado_salida: "Traslado: salida",
  traslado_entrada: "Traslado: entrada",
  ajuste: "Ajuste",
  entrada: "Entrada",
  salida: "Salida manual",
  devolucion: "Devolución",
}

/* El día de hoy en Honduras, como AAAA-MM-DD. */
export const hoyEnHonduras = (ahora = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora)

const formatoDeFechaYHora = new Intl.DateTimeFormat("es-HN", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export const fechaYHoraEnHonduras = (fecha) => formatoDeFechaYHora.format(new Date(fecha))

const SIN_MEDIO = "Sin registrar"

/* A crédito no se cobra al vender: el medio va en cada abono. */
const medioDeVenta = ({ forma_pago }, cobros) =>
  textoDeMedios(cobros) || (forma_pago === "credito" ? "" : SIN_MEDIO)

const conEstado = (venta) => {
  const origen = ORIGEN_DE_VENTA[venta.origen]
  const estado = ESTADO_DE_VENTA[venta.estado] || venta.estado

  return origen ? `${estado} (${origen})` : estado
}

const productosDe = (venta) =>
  venta.productos.map((p) => `${p.cantidad} x ${p.nombre}`).join(", ")

const trasladoDe = (m) => (m.origen && m.destino ? `${m.origen} a ${m.destino}` : "")

const claseDe = (clase) => CLASE_DE_MOVIMIENTO[clase] || clase

const cuantas = (cantidad, singular, plural) => `${cantidad} ${cantidad === 1 ? singular : plural}`

const texto = (titulo) => ({ titulo, tipo: "texto" })
const numero = (titulo) => ({ titulo, tipo: "numero" })
const dinero = (titulo) => ({ titulo, tipo: "dinero" })

/*
  Los indicadores: `valor` es lo que dice la cifra y `tipo` cómo se escribe.
*/
export function indicadoresDelReporte({ indicadores: i, moneda, medios }) {
  const { totales: t } = medios

  return [
    { id: "ventas", etiqueta: "Ventas válidas", valor: i.ventas_total, tipo: "dinero", detalle: cuantas(i.ventas_cantidad, "venta", "ventas") },
    { id: "ticket", etiqueta: "Ticket promedio", valor: i.ticket_promedio, tipo: "dinero" },
    { id: "contado", etiqueta: "Ventas al contado", valor: i.contado_total, tipo: "dinero", detalle: cuantas(i.contado_cantidad, "venta", "ventas") },
    { id: "credito", etiqueta: "Ventas al crédito", valor: i.credito_total, tipo: "dinero", detalle: cuantas(i.credito_cantidad, "venta", "ventas") },
    { id: "cobros", etiqueta: "Cobros recibidos", valor: i.cobros_total, tipo: "dinero", detalle: "Contado válido más abonos del día" },
    { id: "sin-registrar", etiqueta: "Cobros sin medio registrado", valor: t.sin_registrar, tipo: "dinero", detalle: "Registrados antes de los medios de pago" },
    { id: "cargos", etiqueta: "Cargos por medio de pago", valor: t.cargos, tipo: "dinero", detalle: `Tarjeta y enlace, sumados al comprador. A devolver por anulaciones: ${formatMoney(t.cargos_a_devolver, moneda)}` },
    { id: "total-cobrado", etiqueta: "Total cobrado con cargos", valor: t.total_cobrado, tipo: "dinero" },
    { id: "abonos", etiqueta: "Abonos cobrados", valor: i.abonos_total, tipo: "dinero", detalle: `${cuantas(i.abonos_cantidad, "abono", "abonos")}, por la fecha del abono` },
    { id: "anuladas", etiqueta: "Anulaciones del día", valor: i.anuladas_total, tipo: "dinero", detalle: `${cuantas(i.anuladas_cantidad, "anulación", "anulaciones")}, fuera de las ventas; ${formatMoney(i.reembolsos_pendientes, moneda)} por reembolsar` },
  ]
}

/*
  Las tablas del reporte, en el orden en que se leen. `celdas` lleva los
  valores tal como llegan: cada salida decide cómo escribirlos según el tipo
  de su columna.
*/
export function seccionesDelReporte(reporte) {
  const { medios } = reporte

  return [
    {
      id: "medios",
      titulo: "Cobros por medio de pago",
      vacio: "No hubo cobros este día.",
      columnas: [texto("Medio"), numero("Operaciones"), dinero("Cobrado"), dinero("Cargo"), dinero("Total cobrado")],
      filas: medios.por_medio.map((m) => ({
        clave: m.medio,
        celdas: [etiquetaDelMedio(m.medio), m.operaciones, m.monto, m.cargo, m.total_cobrado],
      })),
    },
    {
      id: "medios-por-ubicacion",
      titulo: "Cobros por ubicación y medio de pago",
      vacio: "No hubo cobros este día.",
      columnas: [texto("Ubicación"), dinero("Efectivo"), dinero("Transferencia"), dinero("Tarjeta"), dinero("Enlace de pago"), dinero("Sin registrar"), dinero("Total"), dinero("Cargo")],
      filas: medios.por_ubicacion.map((u) => ({
        clave: u.ubicacion_id || "sin-ubicacion",
        celdas: [u.ubicacion, u.efectivo, u.transferencia, u.tarjeta, u.enlace, u.sin_registrar, u.total, u.cargo],
      })),
    },
    {
      id: "ubicaciones",
      titulo: "Ventas por ubicación",
      vacio: "No hay ubicaciones con actividad.",
      columnas: [texto("Ubicación"), numero("Ventas"), dinero("Total"), dinero("Ticket promedio"), dinero("Contado"), dinero("Crédito"), dinero("Abonos"), dinero("Cobros"), dinero("Anuladas")],
      filas: reporte.por_ubicacion.map((u) => ({
        clave: u.ubicacion_id || "sin-ubicacion",
        celdas: [u.ubicacion, u.ventas_cantidad, u.ventas_total, u.ticket_promedio, u.contado_total, u.credito_total, u.abonos_total, u.cobros_total, u.anuladas_total],
      })),
    },
    {
      id: "vendedores",
      titulo: "Ventas por vendedor",
      vacio: "Ningún vendedor registró ventas ni abonos este día.",
      columnas: [texto("Vendedor"), numero("Ventas"), dinero("Total"), dinero("Ticket promedio"), dinero("Contado"), dinero("Crédito"), dinero("Abonos cobrados")],
      filas: reporte.por_vendedor.map((v) => ({
        clave: v.usuario_id || "sin-usuario",
        celdas: [v.vendedor, v.ventas_cantidad, v.ventas_total, v.ticket_promedio, v.contado_total, v.credito_total, v.abonos_total],
      })),
    },
    {
      id: "operaciones",
      titulo: "Detalle de operaciones",
      vacio: "No hay ventas registradas este día.",
      columnas: [texto("Fecha y hora"), texto("Correlativo"), texto("Ubicación"), texto("Vendedor"), texto("Cliente"), texto("Productos"), texto("Forma de pago"), texto("Medio de pago"), dinero("Total"), texto("Estado")],
      filas: reporte.ventas.map((v) => ({
        clave: v.id,
        celdas: [fechaYHoraEnHonduras(v.fecha), v.numero, v.ubicacion, v.vendedor, v.cliente, productosDe(v), FORMA_DE_PAGO[v.forma_pago] || v.forma_pago, medioDeVenta(v, medios.por_venta[v.id]), v.total, conEstado(v)],
      })),
    },
    {
      id: "abonos",
      titulo: "Abonos cobrados",
      vacio: "No se cobraron abonos este día.",
      columnas: [texto("Fecha del abono"), texto("Factura"), texto("Fecha de la venta"), texto("Ubicación"), texto("Cobró"), texto("Cliente"), texto("Medio de pago"), dinero("Monto")],
      filas: reporte.abonos.map((a) => ({
        clave: a.id,
        celdas: [fechaYHoraEnHonduras(a.fecha), a.numero, fechaYHoraEnHonduras(a.fecha_venta), a.ubicacion, a.cobrador, a.cliente, textoDeMedios(medios.por_abono[a.id]) || SIN_MEDIO, a.monto],
      })),
    },
    {
      id: "anulaciones",
      titulo: "Anulaciones",
      vacio: "No se anularon ventas este día.",
      columnas: [texto("Fecha de anulación"), texto("Documento"), texto("Fecha de la venta"), texto("Ubicación"), texto("Anuló"), texto("Cliente"), texto("Forma de pago"), texto("Medio de pago"), dinero("Total"), texto("Dinero"), texto("Motivo")],
      filas: reporte.anulaciones.map((a) => ({
        clave: a.id,
        celdas: [fechaYHoraEnHonduras(a.fecha), a.numero, fechaYHoraEnHonduras(a.fecha_venta), a.ubicacion, a.anulada_por, a.cliente, FORMA_DE_PAGO[a.forma_pago] || a.forma_pago, medioDeVenta(a, medios.por_anulacion[a.id]), a.total, textoDelTratamiento(a.tratamiento_dinero), a.motivo],
      })),
    },
    {
      id: "resumen-movimientos",
      titulo: "Resumen de movimientos de inventario",
      vacio: "No hubo movimientos de inventario este día.",
      columnas: [texto("Tipo"), numero("Movimientos"), numero("Unidades")],
      filas: reporte.movimientos_resumen.map((r) => ({
        clave: r.clase,
        celdas: [claseDe(r.clase), r.movimientos, r.unidades],
      })),
    },
    {
      id: "movimientos",
      titulo: "Movimientos de inventario",
      vacio: "No hubo movimientos de inventario este día.",
      columnas: [texto("Fecha y hora"), texto("Tipo"), texto("Código"), texto("Producto"), numero("Cantidad"), texto("Ubicación"), texto("Usuario"), texto("Documento"), texto("Traslado"), texto("Motivo")],
      filas: reporte.movimientos.map((m) => ({
        clave: m.id,
        celdas: [fechaYHoraEnHonduras(m.fecha), claseDe(m.clase), m.codigo, m.producto, m.cantidad, m.ubicacion, m.usuario, m.documento || "", trasladoDe(m), m.motivo],
      })),
    },
  ]
}

/* Una celda escrita para la pantalla y el PDF. */
export function celdaParaLeer(valor, tipo, moneda) {
  if (tipo === "dinero") return formatMoney(valor, moneda)
  if (tipo === "numero") return String(valor)

  return valor
}

/*
  Una celda de CSV. A un texto que empieza por =, +, - o @ se le antepone un
  apóstrofo: Excel lo ejecutaría como fórmula, y el nombre de un cliente lo
  escribe cualquiera. Los importes y las cantidades no pasan por ahí: son
  números, y un apóstrofo los dañaría.
*/
function celdaDeCsv(valor, tipo) {
  if (tipo === "dinero") return Number(valor).toFixed(2)
  if (tipo === "numero") return String(valor)

  const crudo = String(valor ?? "")
  const seguro = /^[=+\-@\t\r]/.test(crudo) ? `'${crudo}` : crudo

  return /[",\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro
}

const lineaDeCsv = (celdas, columnas) =>
  celdas.map((valor, i) => celdaDeCsv(valor, columnas[i].tipo)).join(",")

const TEXTO = { tipo: "texto" }
const BOM = String.fromCharCode(0xfeff)

/*
  El reporte completo en CSV, con cada sección bajo su título. Lleva BOM
  para que Excel reconozca los acentos.
*/
export function reporteEnCsv(reporte, nombreDeUbicacion = "Todas") {
  const cabecera = [
    [`Reporte diario de ventas: ${reporte.empresa}`],
    ["Día", reporte.dia],
    ["Ubicación", nombreDeUbicacion],
    ["Zona horaria", ZONA],
  ].map((fila) => lineaDeCsv(fila, fila.map(() => TEXTO)))

  const indicadores = [
    "Indicadores",
    ...indicadoresDelReporte(reporte).map((i) => lineaDeCsv([i.etiqueta, i.valor], [TEXTO, { tipo: i.tipo }])),
  ]

  const secciones = seccionesDelReporte(reporte).flatMap((seccion) => [
    "",
    lineaDeCsv([seccion.titulo], [TEXTO]),
    lineaDeCsv(seccion.columnas.map((c) => c.titulo), seccion.columnas.map(() => TEXTO)),
    ...seccion.filas.map((fila) => lineaDeCsv(fila.celdas, seccion.columnas)),
  ])

  return `${BOM}${[...cabecera, "", ...indicadores, ...secciones].join("\r\n")}\r\n`
}

export const nombreDelArchivo = (reporte, extension) => `reporte-diario-${reporte.dia}.${extension}`
