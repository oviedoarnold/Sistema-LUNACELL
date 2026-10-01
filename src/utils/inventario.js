import { coincideBusqueda } from "./texto"

/*
  Cómo se agrupa y se filtra la existencia por ubicación.

  Vive aparte de la pantalla porque es la parte que se puede equivocar en
  silencio: una fila de más o de menos aquí no rompe nada visible, solo
  cambia una cantidad, y eso no se nota mirando.

  La regla que gobierna todo este archivo: **las ubicaciones salen de las
  filas que llegaron, nunca de un catálogo aparte.** Si alguna función de
  aquí cruzara los productos con la lista de ubicaciones de la empresa
  para «completar» la cuadrícula, inventaría un 0 para las ubicaciones que
  el usuario no puede ver, que es justo lo que la vista de la base se
  molestó en evitar. Lo que no llegó no se dibuja.
*/

export const LOCATION_TYPE_LABEL = {
  bodega: "Bodega",
  tienda: "Tienda",
  camion: "Camión",
  otro: "Otra",
}

export function etiquetaDeTipo(tipo) {
  return LOCATION_TYPE_LABEL[tipo] || LOCATION_TYPE_LABEL.otro
}

/*
  De filas sueltas a un producto con sus ubicaciones.

  El orden se fija aquí, por nombre, y no se hereda del transporte. La
  consulta ya pide a la base que ordene —es gratis y ayuda cuando los datos
  crezcan—, pero quien garantiza lo que ve el usuario es esta función: una
  lista cuyo orden dependa de cómo llegaron las filas cambia de orden sola
  el día que cambie la consulta, y nadie lo nota hasta que alguien busca un
  producto donde estaba ayer.
*/
export function agruparPorProducto(filas = []) {
  const porProducto = new Map()

  for (const fila of filas) {
    if (!porProducto.has(fila.productId)) {
      porProducto.set(fila.productId, {
        productId: fila.productId,
        code: fila.code,
        productName: fila.productName,
        total: 0,
        ubicaciones: [],
      })
    }

    const grupo = porProducto.get(fila.productId)

    grupo.ubicaciones.push({
      locationId: fila.locationId,
      locationName: fila.locationName,
      locationType: fila.locationType,
      quantity: fila.quantity,
    })

    grupo.total += fila.quantity
  }

  const grupos = [...porProducto.values()]

  for (const grupo of grupos) {
    grupo.ubicaciones.sort((a, b) =>
      a.locationName.localeCompare(b.locationName, "es")
    )
  }

  return grupos.sort((a, b) =>
    a.productName.localeCompare(b.productName, "es")
  )
}

/*
  El total que se muestra es el de lo VISIBLE, y no el de lo que existe.

  Para un vendedor que solo ve su camión, «total 3» significa «3 donde
  puedo mirar». Mostrarle el total real de la empresa sería contarle lo
  que la ubicación prohibida tiene, con otro formato.
*/
export function totalVisible(grupos = []) {
  return grupos.reduce((suma, grupo) => suma + grupo.total, 0)
}

/*
  La búsqueda principal: por código o por nombre del producto.

  Son los dos datos que alguien tiene a mano. El del mostrador lee el
  código de la caja; quien pregunta por teléfono dice el nombre. Buscar
  por ubicación es otra pregunta y tiene su propio filtro.

  coincideBusqueda ignora tildes y mayúsculas, así que «camion» encuentra
  «Camión» y «cubo» encuentra «Cubo Iphone».
*/
export function filtrarPorTexto(filas = [], texto = "") {
  const buscado = String(texto || "").trim()

  if (!buscado) return filas

  return filas.filter(
    (fila) =>
      coincideBusqueda(fila.code, buscado) ||
      coincideBusqueda(fila.productName, buscado)
  )
}

/*
  El filtro secundario, que contesta la pregunta inversa: «¿qué tiene esta
  ubicación?».

  No reemplaza al principal. Con una ubicación elegida, cada producto sigue
  mostrándose con sus ubicaciones, solo que la lista queda en una. Así el
  mismo recorrido sirve para las dos preguntas sin una segunda pantalla.

  El identificador se compara como texto porque llega de un <select>, que
  siempre entrega cadenas.
*/
export function filtrarPorUbicacion(filas = [], locationId = "") {
  if (!locationId) return filas

  return filas.filter((fila) => String(fila.locationId) === String(locationId))
}

/*
  Las ubicaciones que ofrece el selector salen de las filas, no de la lista
  de ubicaciones de la empresa.

  Es la misma regla de arriba y aquí es más fácil de romper sin darse
  cuenta: ofrecer «Camión 02» a quien no puede verlo ya le dice que
  existe, aunque elegirlo no devuelva nada.
*/
export function ubicacionesPresentes(filas = []) {
  const vistas = new Map()

  for (const fila of filas) {
    if (!vistas.has(fila.locationId)) {
      vistas.set(fila.locationId, {
        locationId: fila.locationId,
        locationName: fila.locationName,
        locationType: fila.locationType,
      })
    }
  }

  return [...vistas.values()]
}
