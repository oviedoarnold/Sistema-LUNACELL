/* Null si la lista se puede guardar; si no, qué falta. */
export function problemaDePrecios(filas) {
  for (const { nombre, precio } of filas) {
    const valor = Number(precio)

    if (!(valor > 0) || valor !== Math.round(valor * 100) / 100) {
      return `El precio de «${nombre}» debe ser mayor que cero y tener hasta dos decimales.`
    }
  }

  return null
}
