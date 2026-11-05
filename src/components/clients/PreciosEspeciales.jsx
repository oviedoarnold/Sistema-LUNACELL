import { useMemo, useState } from "react"
import { FaPlus, FaTrash } from "react-icons/fa"

import SearchInput from "../crud/SearchInput"
import { filterProductsBySearchText } from "../../utils/cart"
import { formatMoney } from "../../utils/format"

const RESULTADOS_A_MOSTRAR = 6

/*
  Los productos habituales de un cliente y su precio. Solo guarda el estado en la
  pantalla que lo usa: la lista se envía completa al guardar el cliente.

  Un producto ya agregado no aparece en la búsqueda, para que no se pueda repetir.
*/
function PreciosEspeciales({ filas, onCambiar, productos, editable, cargando, fallo, moneda }) {
  const [busqueda, setBusqueda] = useState("")

  const resultados = useMemo(() => {
    if (!busqueda.trim()) return []

    const agregados = new Set(filas.map((f) => f.productoId))

    return filterProductsBySearchText(productos, busqueda)
      .filter((p) => !agregados.has(p.id))
      .slice(0, RESULTADOS_A_MOSTRAR)
  }, [busqueda, filas, productos])

  const agregar = (producto) => {
    onCambiar([
      ...filas,
      {
        productoId: producto.id,
        nombre: producto.name,
        codigo: producto.code || "",
        precioGeneral: producto.price,
        precio: String(producto.price),
      },
    ])
    setBusqueda("")
  }

  const cambiarPrecio = (productoId, precio) =>
    onCambiar(filas.map((f) => (f.productoId === productoId ? { ...f, precio } : f)))

  const quitar = (productoId) => onCambiar(filas.filter((f) => f.productoId !== productoId))

  return (
    <section className="precios-especiales" aria-labelledby="precios-especiales-titulo">
      <h3 id="precios-especiales-titulo" className="precios-especiales-titulo">Productos y precios especiales</h3>

      {cargando && <p className="crud-cargando" role="status">Cargando precios…</p>}

      {fallo && (
        <p className="precios-especiales-aviso" role="alert">
          No se pudieron cargar los precios. Vuelve a abrir el cliente para cambiarlos.
        </p>
      )}

      {!cargando && !fallo && !editable && (
        <p className="precios-especiales-nota">Solo un administrador puede cambiarlos.</p>
      )}

      {!cargando && !fallo && editable && (
        <>
          <SearchInput
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto para agregar..."
            etiqueta="Buscar producto para agregar a la lista del cliente"
          />

          {resultados.length > 0 && (
            <ul className="precios-especiales-resultados">
              {resultados.map((p) => (
                <li key={p.id}>
                  <span>{p.name} <small>{formatMoney(p.price, moneda)}</small></span>

                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => agregar(p)}>
                    <FaPlus aria-hidden="true" />
                    Agregar
                  </button>
                </li>
              ))}
            </ul>
          )}

          {busqueda.trim() && resultados.length === 0 && (
            <p className="precios-especiales-nota">No hay más productos con ese nombre.</p>
          )}
        </>
      )}

      {!cargando && !fallo && filas.length === 0 && (
        <p className="precios-especiales-nota">Este cliente usa los precios generales.</p>
      )}

      {filas.length > 0 && (
        <ul className="precios-especiales-lista">
          {filas.map((f) => (
            <li key={f.productoId}>
              <div className="precios-especiales-producto">
                <strong>{f.nombre}</strong>
                <small>General: {formatMoney(f.precioGeneral, moneda)}</small>
              </div>

              {editable ? (
                <>
                  <label className="field">
                    <span className="solo-lector">Precio especial de {f.nombre}</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={f.precio}
                      onChange={(e) => cambiarPrecio(f.productoId, e.target.value)}
                    />
                  </label>

                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={`Quitar ${f.nombre} de la lista`}
                    title="Quitar de la lista"
                    onClick={() => quitar(f.productoId)}
                  >
                    <FaTrash aria-hidden="true" />
                  </button>
                </>
              ) : (
                <b>{formatMoney(f.precio, moneda)}</b>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default PreciosEspeciales
