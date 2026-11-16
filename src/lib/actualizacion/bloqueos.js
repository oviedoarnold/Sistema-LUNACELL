/*
  Operaciones en curso que una recarga destruiría.

  La actualización es obligatoria, pero espera a que no quede ninguna: un
  carrito con productos, una venta o un pedido que se está enviando, un
  abono abierto, una sincronización de ventas sin conexión. Cada pantalla
  anota la suya mientras dura (useBloqueoDeActualizacion) y la retira al
  terminar; la actualización se instala en cuanto la lista queda vacía.

  Vive fuera de React a propósito: lo consultan componentes que no comparten
  ningún proveedor, y una lista de módulo es lo más simple que lo resuelve.
*/

const activos = new Map()
const oyentes = new Set()
let siguiente = 0

function avisar() {
  for (const oyente of oyentes) oyente(activos.size > 0)
}

// Anota una operación en curso. Devuelve la función que la retira.
export function bloquearActualizacion(motivo = "operacion") {
  siguiente += 1
  const clave = siguiente

  activos.set(clave, motivo)
  avisar()

  return () => {
    if (activos.delete(clave)) avisar()
  }
}

export const hayOperacionEnCurso = () => activos.size > 0

export const motivosEnCurso = () => [...activos.values()]

// El oyente recibe true o false cada vez que cambia la lista.
export function escucharBloqueos(oyente) {
  oyentes.add(oyente)

  return () => oyentes.delete(oyente)
}
