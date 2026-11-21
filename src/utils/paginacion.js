/*
  Reparto en páginas de una lista que ya está cargada. No consulta nada ni
  cambia qué filas se ven: solo cuántas de una vez.
*/
export function rebanada(lista, pagina, porPagina) {
  const inicio = (pagina - 1) * porPagina

  return lista.slice(inicio, inicio + porPagina)
}

export function paginasDe(total, porPagina) {
  return Math.max(1, Math.ceil(total / porPagina))
}
