import { FaChevronLeft, FaChevronRight } from "react-icons/fa"

import { paginasDe } from "../../utils/paginacion"

/*
  Páginas de una lista que ya está cargada.

  Solo reparte lo que la pantalla ya tiene: no consulta nada ni cambia qué
  filas se ven, solo cuántas de una vez. Con una sola página no se dibuja.
*/
function Paginacion({ pagina, total, porPagina, onCambiar, etiqueta = "Páginas" }) {
  const paginas = paginasDe(total, porPagina)

  if (paginas <= 1) return null

  const desde = (pagina - 1) * porPagina + 1
  const hasta = Math.min(total, pagina * porPagina)

  return (
    <nav className="paginacion" aria-label={etiqueta}>
      <span>
        {desde}–{hasta} de {total}
      </span>

      <span className="paginacion-botones">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pagina <= 1}
          onClick={() => onCambiar(pagina - 1)}
        >
          <FaChevronLeft aria-hidden="true" />Anterior
        </button>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pagina >= paginas}
          onClick={() => onCambiar(pagina + 1)}
        >
          Siguiente<FaChevronRight aria-hidden="true" />
        </button>
      </span>
    </nav>
  )
}

export default Paginacion
