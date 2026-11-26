/*
  Regalías a clientes (0054): productos entregados sin cargo junto con una
  venta. No son renglones de la factura ni cambian su total; la base las
  guarda aparte y las descuenta de la ubicación de quien vende.

  Aquí solo vive lo que la pantalla necesita para avisar antes: los motivos
  y por qué todavía no se pueden registrar. Quien decide es
  registrar_venta_con_regalias().
*/

export const MOTIVOS_DE_REGALIA = [
  { id: "cliente_frecuente", etiqueta: "Cliente frecuente" },
  { id: "cortesia_comercial", etiqueta: "Cortesía comercial" },
  { id: "compra_volumen", etiqueta: "Compra por volumen" },
  { id: "promocion_autorizada", etiqueta: "Promoción autorizada" },
  { id: "otro", etiqueta: "Otro" },
]

export const etiquetaDelMotivo = (id) => MOTIVOS_DE_REGALIA.find((m) => m.id === id)?.etiqueta || id || ""

// El motivo con su descripción, como se lee en la factura y en el reporte.
export const motivoParaLeer = (motivo, detalle) =>
  motivo === "otro" && String(detalle || "").trim() ? `Otro: ${String(detalle).trim()}` : etiquetaDelMotivo(motivo)

export const DETALLE_MINIMO = 5

/*
  Por qué la venta todavía no puede llevar regalías, o null si puede. El
  orden es el de lo que el vendedor tiene que resolver primero.
*/
export function bloqueoDeRegalias({ sinConexion, esPedido, clienteRegistrado, ventaFiscal }) {
  if (esPedido) return "Los pedidos para otra ubicación no llevan regalías."
  if (sinConexion) return "Las regalías necesitan conexión: no se registran sin conexión."
  if (ventaFiscal) return "Las regalías no se registran en facturas fiscales hasta que el contador defina su tratamiento."
  if (!clienteRegistrado) return "Elige un cliente registrado para agregar regalías."

  return null
}

/*
  El resumen del reporte de regalías (0055): cuántas, cuántas unidades y su
  valor comercial. Las regalías sin precio guardado (null, anteriores a la
  0055) cuentan en regalías y unidades, pero no en el valor; si ninguna lo
  tiene, el valor es null, no cero. Se suma en centavos.
*/
export function resumenDeRegalias(filas) {
  const conPrecio = filas.filter((f) => f.valorComercial !== null && f.valorComercial !== undefined)
  const centavos = conPrecio.reduce((suma, f) => suma + Math.round(Number(f.valorComercial) * 100), 0)

  return {
    regalias: filas.length,
    unidades: filas.reduce((suma, f) => suma + Number(f.cantidad || 0), 0),
    sinPrecio: filas.length - conPrecio.length,
    valorComercial: conPrecio.length ? centavos / 100 : null,
  }
}

// Qué falta en el motivo, o null.
export function problemaDelMotivo(motivo, detalle) {
  if (!MOTIVOS_DE_REGALIA.some((m) => m.id === motivo)) return "Elige el motivo de la regalía."

  if (motivo === "otro" && String(detalle || "").trim().length < DETALLE_MINIMO) {
    return `Describe el motivo de la regalía (al menos ${DETALLE_MINIMO} caracteres).`
  }

  return null
}
