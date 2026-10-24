/*
  Qué enseña la pantalla sobre anular una venta.

  Nada de esto autoriza: anular_venta() vuelve a comprobarlo todo en la
  base, con su reloj y sus datos. Aquí solo se decide si mostrar el botón y,
  si la venta no se puede anular, decir por qué antes de que alguien lo
  intente. Las reglas y los mensajes son los mismos que los de la base, en
  el mismo orden, para que la pantalla y el motor no se contradigan.
*/

import { getSalePayments } from "./salesUtils"

export const MOTIVO_MINIMO = 10

export const TRATAMIENTOS_DEL_DINERO = [
  { id: "reembolso_pendiente", etiqueta: "Reembolso pendiente", ayuda: "El cliente pagó y el dinero está por devolverse." },
  { id: "no_cobrado", etiqueta: "No se cobró, error de registro", ayuda: "La venta se registró por error y no entró dinero." },
]

const TEXTO_DEL_TRATAMIENTO = {
  reembolso_pendiente: "Reembolso pendiente",
  no_cobrado: "No se cobró, error de registro",
  credito_sin_abonos: "Crédito sin abonos: no entró dinero",
}

export const textoDelTratamiento = (id) => TEXTO_DEL_TRATAMIENTO[id] || id

export const MENSAJE_CON_ABONOS =
  "Esta venta tiene abonos registrados y no puede anularse mediante el procedimiento actual. Contacta con el administrador."

/* El día de una fecha en Honduras, como AAAA-MM-DD. */
const diaEnHonduras = (fecha) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tegucigalpa", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(fecha)
  )

export const esDelMismoDiaEnHonduras = (fecha, ahora = new Date()) => diaEnHonduras(fecha) === diaEnHonduras(ahora)

/*
  ¿Le corresponde a este usuario el botón de anular esta venta? El
  administrador, siempre; el vendedor, si tiene los dos permisos y la venta
  es de la ubicación que tiene asignada ahora.
*/
export function puedeVerAnular(venta, { esAdmin, puedeAnular, ubicacionId }) {
  if (!venta || venta.status === "anulada") return false
  if (esAdmin) return true

  return Boolean(puedeAnular && ubicacionId && venta.locationId === ubicacionId)
}

/* Por qué no se puede anular, o null si se puede. */
export function razonParaNoAnular(venta, { esAdmin }, ahora = new Date()) {
  if (venta.origin === "conciliacion" && !esAdmin) {
    return "Se aplicó por conciliación: solo un administrador puede anularla."
  }

  if (!esAdmin && !esDelMismoDiaEnHonduras(venta.isoDate || venta.timestamp, ahora)) {
    return "Solo puedes anular ventas del mismo día. Para una venta anterior, contacta con el administrador."
  }

  if (venta.isFiscal) {
    return "Las facturas fiscales no se anulan con este procedimiento."
  }

  if (!venta.locationId) {
    return "Es una venta antigua sin ubicación: no se puede anular automáticamente."
  }

  if (getSalePayments(venta).length > 0) {
    return MENSAJE_CON_ABONOS
  }

  return null
}

/*
  El mensaje para un rechazo de la base. Los de negocio ya traen el texto
  que dice qué hacer; el de permisos se traduce para que no diga «42501».
*/
export function mensajeDeRechazo(error) {
  if (error?.motivo === "sin-permiso") {
    return error.message || "No tienes permiso para anular esta venta."
  }

  if (error?.motivo === "con-abonos") return MENSAJE_CON_ABONOS

  return error?.message || "No se pudo anular la venta."
}
