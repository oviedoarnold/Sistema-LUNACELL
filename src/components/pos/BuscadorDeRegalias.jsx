import { useMemo, useState } from "react"
import { FaGift, FaPlus, FaSearch } from "react-icons/fa"

import ModalShell from "../forms/ModalShell"
import { MiniaturaDeProducto } from "../ImagenDeProducto"

const TOPE_DE_RESULTADOS = 50

const coincide = (producto, texto) =>
  !texto || `${producto.name} ${producto.code || ""}`.toLowerCase().includes(texto)

/*
  La ventana «Agregar regalía»: busca en el catálogo por nombre o código y
  muestra cuánto se puede regalar en la ubicación, que es lo que hay menos lo
  que ya se vende y lo que ya se regala.
*/
function BuscadorDeRegalias({ productos, disponibleDe, cantidadDe, onAgregar, onCerrar }) {
  const [buscado, setBuscado] = useState("")
  const texto = buscado.trim().toLowerCase()

  const resultados = useMemo(
    () => productos.filter((p) => p.active !== false && coincide(p, texto)).slice(0, TOPE_DE_RESULTADOS),
    [productos, texto]
  )

  return (
    <ModalShell
      titulo="Agregar regalía"
      subtitulo="Productos sin cargo para el cliente de esta venta"
      icono={<FaGift />}
      onCerrar={onCerrar}
      acciones={
        <button type="button" className="btn btn-primary" onClick={onCerrar}>
          Listo
        </button>
      }
    >
      <div className="search-box pos-regalias-buscador">
        <FaSearch aria-hidden="true" />
        <input
          type="search"
          aria-label="Buscar regalía por nombre o código"
          placeholder="Buscar por nombre o código…"
          value={buscado}
          onChange={(e) => setBuscado(e.target.value)}
        />
      </div>

      {resultados.length === 0 ? (
        <p className="pos-regalias-vacio" role="status">
          Ningún producto coincide con «{buscado.trim()}».
        </p>
      ) : (
        <ul className="pos-regalias-catalogo" aria-label="Productos para regalar">
          {resultados.map((p) => {
            const quedan = disponibleDe(p.id) - cantidadDe(p.id)

            return (
              <li key={p.id}>
                <MiniaturaDeProducto url={p.imageUrl} nombre={p.name} tamano={40} />
                <span className="pos-regalias-producto">
                  <strong>{p.name}</strong>
                  <small>Cód: {p.code || "S/C"}</small>
                </span>
                <span className="pos-regalias-quedan">
                  Disponible: <strong>{Math.max(quedan, 0)}</strong>
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-label={`Agregar ${p.name} como regalía`}
                  disabled={quedan < 1}
                  onClick={() => onAgregar(p.id)}
                >
                  <FaPlus aria-hidden="true" />
                  Agregar
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </ModalShell>
  )
}

export default BuscadorDeRegalias
