/*
  Deja a la vista un elemento DENTRO de su lista desplazable, moviendo
  solo esa lista.

  scrollIntoView() mueve también todos los contenedores de arriba —el
  cuerpo de una ventana, la página—, y al abrir «Nuevo traslado» eso
  escondía la sección de ubicaciones. Aquí solo cambia el scrollTop de la
  lista, y solo si el elemento quedó por arriba o por debajo de lo visible.

  La lista tiene que ser el offsetParent del elemento (position: relative)
  para que offsetTop se mida desde ella.
*/
export function mostrarDentroDeLista(lista, elemento) {
  if (!lista || !elemento) return

  const arriba = elemento.offsetTop
  const abajo = arriba + elemento.offsetHeight

  if (arriba < lista.scrollTop) {
    lista.scrollTop = arriba
  } else if (abajo > lista.scrollTop + lista.clientHeight) {
    lista.scrollTop = abajo - lista.clientHeight
  }
}
