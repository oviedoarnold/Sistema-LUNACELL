/*
  El carrito del formulario «Nuevo traslado».

  Es solo la preparación en la pantalla: qué productos y cuántos. Quien
  decide si alcanza sigue siendo registrar_traslado(), que vuelve a mirar
  la existencia real del origen bajo candado (LT005). Esto evita pedir lo
  que la pantalla ya sabe que no hay.

  Cada renglón es { productId, cantidad } y la cantidad se guarda como el
  texto que escribe el usuario, para no pelear con él mientras teclea
  («2» → «25»). Se valida al usarla.
*/

const ENTERO_POSITIVO = /^[1-9]\d*$/

// Una cantidad sirve si es un entero mayor que cero y no pasa de lo disponible.
export const cantidadValida = (texto, disponible) =>
  ENTERO_POSITIVO.test(String(texto ?? "").trim()) && Number(texto) <= disponible

const renglonDe = (carrito, productId) => carrito.find((r) => r.productId === productId)

/*
  Agrega una unidad del producto. Si ya está, suma a su renglón en vez de
  repetirlo; si ya tiene todo lo disponible, no cambia nada y lo dice.
*/
export function agregarAlTraslado(carrito, productId, disponible) {
  const actual = renglonDe(carrito, productId)

  if (!actual) {
    if (disponible < 1) return { carrito, agregado: false }

    return { carrito: [...carrito, { productId, cantidad: "1" }], agregado: true }
  }

  const tiene = ENTERO_POSITIVO.test(String(actual.cantidad).trim()) ? Number(actual.cantidad) : 0

  if (tiene >= disponible) return { carrito, agregado: false }

  return { carrito: escribirCantidad(carrito, productId, String(Math.max(tiene, 0) + 1)), agregado: true }
}

// Lo que el usuario escribe en la cantidad, tal cual.
export const escribirCantidad = (carrito, productId, texto) =>
  carrito.map((r) => (r.productId === productId ? { ...r, cantidad: texto } : r))

/*
  «−» y «+»: una unidad menos o más, sin bajar de 1 ni pasar de lo
  disponible. Para dejar el producto fuera está «Eliminar».
*/
export function sumarAlRenglon(carrito, productId, cambio, disponible) {
  const actual = renglonDe(carrito, productId)

  if (!actual) return carrito

  const tiene = ENTERO_POSITIVO.test(String(actual.cantidad).trim()) ? Number(actual.cantidad) : 0
  const nueva = Math.min(Math.max(tiene + cambio, 1), Math.max(disponible, 1))

  return escribirCantidad(carrito, productId, String(nueva))
}

export const quitarDelTraslado = (carrito, productId) => carrito.filter((r) => r.productId !== productId)

/*
  Al cambiar el origen, lo elegido se vuelve a medir contra la existencia
  del origen nuevo: lo que allí no hay se retira y lo que pasa de lo
  disponible se baja a lo disponible. Nada queda con una cantidad que la
  pantalla sepa inválida.
*/
export function revalidarParaOrigen(carrito, disponibleDe) {
  const retirados = []
  const ajustados = []
  const nuevo = []

  for (const renglon of carrito) {
    const disponible = disponibleDe(renglon.productId)

    if (disponible < 1) {
      retirados.push(renglon.productId)
      continue
    }

    if (cantidadValida(renglon.cantidad, disponible)) {
      nuevo.push(renglon)
      continue
    }

    const tiene = ENTERO_POSITIVO.test(String(renglon.cantidad).trim()) ? Number(renglon.cantidad) : 1
    const ajustada = Math.min(tiene, disponible)

    ajustados.push(renglon.productId)
    nuevo.push({ ...renglon, cantidad: String(ajustada) })
  }

  return { carrito: nuevo, retirados, ajustados }
}

// Cuántos productos distintos y cuántas unidades válidas se van a trasladar.
export const resumenDelTraslado = (carrito) => ({
  productos: carrito.length,
  unidades: carrito.reduce(
    (suma, r) => suma + (ENTERO_POSITIVO.test(String(r.cantidad).trim()) ? Number(r.cantidad) : 0),
    0
  ),
})

export const cuantos = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`
