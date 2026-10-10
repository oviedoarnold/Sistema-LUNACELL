/*
  La copia local con la que se vende sin conexión: catálogo con precios,
  existencias de la ubicación, clientes y tasa de ISV, tal como estaban en
  el servidor cuando se tomó.

  Hay una copia por empresa, usuario y ubicación: si cambia el usuario o su
  ubicación, se usa otra copia y no se mezclan.
*/

export const idDeCopia = ({ empresaId, usuarioAuth, ubicacionId }) => `${empresaId}|${usuarioAuth}|${ubicacionId}`

export const mismoDueno = (a, b) =>
  a.empresaId === b.empresaId && a.usuarioAuth === b.usuarioAuth && a.ubicacionId === b.ubicacionId

export async function guardarCopia(almacen, copia) {
  const completa = { ...copia, id: idDeCopia(copia) }

  await almacen.transaccion(["copias"], "readwrite", (t) => t.poner("copias", completa))

  return completa
}

export const leerCopia = (almacen, dueno) => almacen.leer("copias", idDeCopia(dueno))

/*
  Lo que todavía se puede vender de un producto EN ESTE DISPOSITIVO:
  la existencia de la copia menos lo que este usuario vendió aquí y la copia
  todavía no refleja.

  - pendiente, sincronizando, error: el servidor aún no la descontó;
  - en conciliación: el servidor no la aplicó, pero el producto ya salió.
    Se resta mientras un administrador no decida; si decidió (aplicar o
    anular) ANTES de tomar la copia, la copia ya refleja esa decisión y no
    se resta otra vez;
  - registrada: ya está en el servidor; solo se resta si se confirmó después
    de tomar la copia (la copia es anterior y no la incluye).

  Otros dispositivos de la misma ubicación pueden haber vendido sin que este
  lo sepa: eso lo resuelve el servidor al sincronizar (conciliación).
*/
const DECISIONES = new Set(["aplicada", "anulada"])

const decididaAntesDe = (venta, momento) =>
  DECISIONES.has(venta.conciliacion?.estado) && Date.parse(venta.conciliacion.resueltaEn) <= momento

export function disponibleLocal(copia, ventas, productoId) {
  const existencia = Number(copia.existencias?.[productoId] ?? 0)
  const tomadaEn = Date.parse(copia.tomadaEn)

  const comprometido = ventas
    .filter((v) => mismoDueno(v, copia))
    .filter((v) => v.estado !== "registrada" || Date.parse(v.confirmadaEn) > tomadaEn)
    .filter((v) => !(v.estado === "en_conciliacion" && decididaAntesDe(v, tomadaEn)))
    .flatMap((v) => v.renglones)
    .filter((r) => r.producto_id === productoId)
    .reduce((suma, r) => suma + Number(r.cantidad), 0)

  return existencia - comprometido
}

const HORA = 3600000

// Aviso a las 12 horas y fuerte a las 24. Nunca bloquea la venta.
export function antiguedadDeCopia(copia, ahora = new Date()) {
  const horas = (ahora.getTime() - Date.parse(copia.tomadaEn)) / HORA

  return { horas, aviso: horas >= 24 ? "fuerte" : horas >= 12 ? "leve" : "ninguno" }
}
