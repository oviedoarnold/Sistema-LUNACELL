/*
  Reglas del precio negociado durante una venta. Son para avisar antes: quien decide
  es la base (0043), con estas mismas reglas.
*/
export const MOTIVOS_DE_NEGOCIACION = [
  { valor: "mayoreo", texto: "Compra al por mayor" },
  { valor: "cliente_frecuente", texto: "Cliente frecuente" },
  { valor: "promocion", texto: "Promoción" },
  { valor: "otro", texto: "Otro" },
]

export const textoDelMotivo = (valor) => MOTIVOS_DE_NEGOCIACION.find((m) => m.valor === valor)?.texto || ""

// Bajar el precio necesita un motivo; subirlo, no.
export const necesitaMotivo = (precio, referencia) => Number(precio) < Number(referencia)

// Mayor que cero, con hasta dos decimales: lo mismo que acepta la base.
export function esPrecioValido(precio) {
  const valor = typeof precio === "string" && precio.trim() === "" ? Number.NaN : Number(precio)

  return valor > 0 && Number.isFinite(valor) && valor === Math.round(valor * 100) / 100 && valor < 10000000000
}

// Null si el precio se puede usar; si no, qué falta.
export function problemaDelPrecioNegociado(precio, referencia, motivo) {
  if (!esPrecioValido(precio)) {
    return "El precio debe ser mayor que cero y tener hasta dos decimales."
  }

  const valor = Number(precio)

  if (necesitaMotivo(valor, referencia) && !MOTIVOS_DE_NEGOCIACION.some((m) => m.valor === motivo)) {
    return "Elige el motivo por el que se baja el precio."
  }

  return null
}
