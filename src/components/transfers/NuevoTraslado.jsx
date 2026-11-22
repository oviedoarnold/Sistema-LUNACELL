import { useEffect, useRef, useState } from "react"
import {
  FaBoxOpen,
  FaExchangeAlt,
  FaLayerGroup,
  FaMapMarkerAlt,
  FaMinus,
  FaPlus,
  FaRegStickyNote,
  FaSearch,
  FaTrashAlt,
  FaTruck,
} from "react-icons/fa"

import FormField from "../forms/FormField"
import ModalShell from "../forms/ModalShell"
import { MiniaturaDeProducto } from "../ImagenDeProducto"
import { CAMPO_DE_CANTIDAD } from "../../utils/camposNumericos"
import { cantidadValida, cuantos } from "../../utils/carritoDeTraslado"
import { mostrarDentroDeLista } from "../../utils/desplazamiento"
import { coincideBusqueda } from "../../utils/texto"

/*
  La ventana «Nuevo traslado», como un carrito pequeño.

  A la izquierda, de dónde y hacia dónde, y el buscador de los productos
  con existencia en el origen. A la derecha, lo elegido con su cantidad,
  el total y la observación. Todo el estado viene de useNuevoTraslado: aquí
  solo se muestra y se escucha al usuario.

  Teclado: en el buscador, ↑ y ↓ cambian el resultado resaltado y Enter lo
  agrega y deja el buscador listo para el siguiente.
*/
function NuevoTraslado({ traslado: t, productos = [], nombreUbicacion, onCerrar }) {
  const [buscado, setBuscado] = useState("")
  const [resaltado, setResaltado] = useState(0)
  const lista = useRef(null)

  const delCatalogo = (productId) => productos.find((p) => String(p.id) === String(productId))

  const infoDe = (productId) => {
    const existencia = t.disponibles.find((e) => e.productId === productId)
    const producto = delCatalogo(productId)

    return {
      nombre: existencia?.productName || producto?.name || "Producto",
      codigo: existencia?.code || producto?.code || "",
      imagen: producto?.imageUrl || "",
    }
  }

  const texto = buscado.trim()
  const resultados = texto
    ? t.disponibles.filter((e) => coincideBusqueda(e.productName, texto) || coincideBusqueda(e.code, texto))
    : t.disponibles

  const indice = Math.min(resaltado, Math.max(resultados.length - 1, 0))

  const enCarrito = (productId) => {
    const renglon = t.carrito.find((r) => r.productId === productId)
    return renglon ? Number(renglon.cantidad) || 0 : 0
  }

  /*
    Con las flechas, el resultado resaltado queda a la vista moviendo SOLO
    la lista de resultados. Nada se desplaza al abrir la ventana ni al
    escribir: la ventana empieza arriba, con las ubicaciones a la vista.
  */
  const conFlechas = useRef(false)

  useEffect(() => {
    if (!conFlechas.current) return
    conFlechas.current = false
    mostrarDentroDeLista(lista.current, lista.current?.querySelector(".is-resaltado"))
  }, [indice])

  const alTeclear = (evento) => {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault()
      conFlechas.current = true
      const paso = evento.key === "ArrowDown" ? 1 : -1
      setResaltado(Math.min(Math.max(indice + paso, 0), Math.max(resultados.length - 1, 0)))
      return
    }

    if (evento.key === "Enter") {
      evento.preventDefault()
      const elegido = resultados[indice]

      if (elegido && t.agregar(elegido.productId)) {
        setBuscado("")
        setResaltado(0)
      }
    }
  }

  const nombreOrigen = t.origen ? nombreUbicacion(t.origen) : ""

  return (
    <ModalShell
      titulo="Nuevo traslado"
      subtitulo="Transfiere productos entre ubicaciones"
      icono={<FaTruck />}
      onCerrar={onCerrar}
      ancho="modal-traslado"
      acciones={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={t.guardando}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={t.enviar} disabled={!t.puedeEnviar}>
            <FaExchangeAlt aria-hidden="true" />
            {t.guardando ? "Trasladando…" : "Realizar traslado"}
          </button>
        </>
      }
    >
      <div className="traslado-formulario">
        <div className="traslado-columna">
          <section className="traslado-tarjeta" aria-labelledby="traslado-ubicaciones">
            <h4 id="traslado-ubicaciones" className="traslado-titulo">
              <FaMapMarkerAlt aria-hidden="true" />
              Ubicaciones
            </h4>

            {t.sinOrigen && (
              <p className="alert-banner" role="status">
                No tienes una ubicación operativa asignada: pide que te asignen una para poder trasladar desde ella.
              </p>
            )}

            <div className="traslado-ubicaciones">
              <FormField etiqueta="Origen">
                <select
                  id="transfers-origen"
                  value={t.origen}
                  onChange={(e) => t.cambiarOrigen(e.target.value)}
                  disabled={!t.puedeElegirOrigen}
                >
                  {t.puedeElegirOrigen && <option value="">— Elige el origen —</option>}
                  {t.origenes.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </FormField>

              <button
                type="button"
                className="btn-icono traslado-intercambiar"
                aria-label="Intercambiar origen y destino"
                title="Intercambiar origen y destino"
                onClick={t.intercambiar}
                disabled={!t.puedeIntercambiar}
              >
                <FaExchangeAlt aria-hidden="true" />
              </button>

              <FormField etiqueta="Destino">
                <select id="transfers-destino" value={t.destino} onChange={(e) => t.setDestino(e.target.value)}>
                  <option value="">— Elige el destino —</option>
                  {t.destinos.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </FormField>
            </div>
          </section>

          <section className="traslado-tarjeta" aria-labelledby="traslado-agregar">
            <h4 id="traslado-agregar" className="traslado-titulo">
              <FaBoxOpen aria-hidden="true" />
              Agregar productos
            </h4>

            <div className="search-box traslado-buscador">
              <FaSearch aria-hidden="true" />
              <input
                type="search"
                aria-label="Buscar producto por nombre o código"
                aria-describedby="traslado-ayuda-buscador"
                placeholder="Buscar por nombre o código…"
                value={buscado}
                onChange={(e) => {
                  setBuscado(e.target.value)
                  setResaltado(0)
                }}
                onKeyDown={alTeclear}
                disabled={!t.origen}
              />
            </div>
            <p id="traslado-ayuda-buscador" className="traslado-ayuda">
              Enter agrega el resultado resaltado; ↑ y ↓ eligen otro.
            </p>

            {!t.origen && !t.sinOrigen && <p className="traslado-vacio">Elige el origen para ver sus productos.</p>}

            {t.sinExistencias && (
              <p className="alert-banner" role="status">
                No hay productos con existencia en {nombreOrigen}. Elige otro origen para trasladar.
              </p>
            )}

            {t.disponibles.length > 0 && resultados.length === 0 && (
              <p className="traslado-vacio" role="status">
                Ningún producto con existencia en {nombreOrigen} coincide con «{texto}».
              </p>
            )}

            {resultados.length > 0 && (
              <ul ref={lista} className="traslado-catalogo" aria-label={`Productos disponibles en ${nombreOrigen}`}>
                {resultados.map((e, i) => {
                  const { imagen } = infoDe(e.productId)
                  const lleno = enCarrito(e.productId) >= e.quantity

                  return (
                    <li key={e.productId} className={i === indice ? "is-resaltado" : undefined}>
                      <MiniaturaDeProducto url={imagen} nombre={e.productName} tamano={40} />
                      <div className="traslado-producto">
                        <strong>{e.productName}</strong>
                        <span>Cód: {e.code || "S/C"}</span>
                      </div>
                      <span className="traslado-disponible">
                        Disponible: <strong>{e.quantity}</strong>
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm traslado-agregar"
                        aria-label={`Agregar ${e.productName}`}
                        title={lleno ? "Ya están todas las unidades disponibles" : undefined}
                        onClick={() => t.agregar(e.productId)}
                        disabled={lleno}
                      >
                        <FaPlus aria-hidden="true" />
                        Agregar
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="traslado-columna">
          <section className="traslado-tarjeta" aria-labelledby="traslado-productos">
            <div className="traslado-encabezado">
              <h4 id="traslado-productos" className="traslado-titulo">
                <FaLayerGroup aria-hidden="true" />
                Productos del traslado
              </h4>
              <span className="badge traslado-insignia">{cuantos(t.resumen.productos, "producto", "productos")}</span>
            </div>

            {t.aviso && (
              <p className="traslado-aviso" role="status">
                {t.aviso}
              </p>
            )}

            {t.carrito.length === 0 ? (
              <p className="traslado-vacio">Todavía no hay productos. Búscalos a la izquierda y pulsa «Agregar».</p>
            ) : (
              <>
                <div className="traslado-carrito-encabezado" aria-hidden="true">
                  <span>Producto</span>
                  <span>Cantidad</span>
                </div>

                <ul className="traslado-carrito" aria-label="Productos del traslado">
                  {t.carrito.map((r) => {
                    const { nombre, codigo, imagen } = infoDe(r.productId)
                    const tope = t.disponible(r.productId)
                    const valida = cantidadValida(r.cantidad, tope)
                    const idAyuda = `traslado-cantidad-${r.productId}`
                    const actual = Number(r.cantidad) || 0

                    return (
                      <li key={r.productId}>
                        <MiniaturaDeProducto url={imagen} nombre={nombre} tamano={40} />
                        <div className="traslado-producto">
                          <strong>{nombre}</strong>
                          <span>Cód: {codigo || "S/C"}</span>
                          <span id={idAyuda} className={valida ? "traslado-tope" : "traslado-tope is-error"}>
                            {valida ? `Disponible: ${tope}` : `Escribe una cantidad entera de 1 a ${tope}.`}
                          </span>
                        </div>

                        <div className="traslado-cantidad">
                          <button
                            type="button"
                            aria-label={`Quitar una unidad de ${nombre}`}
                            onClick={() => t.sumar(r.productId, -1)}
                            disabled={actual <= 1}
                          >
                            <FaMinus aria-hidden="true" />
                          </button>
                          <input
                            type="number"
                            {...CAMPO_DE_CANTIDAD}
                            min="1"
                            max={tope}
                            step="1"
                            aria-label={`Cantidad de ${nombre}`}
                            aria-describedby={idAyuda}
                            aria-invalid={valida ? undefined : "true"}
                            value={r.cantidad}
                            onChange={(e) => t.escribir(r.productId, e.target.value)}
                          />
                          <button
                            type="button"
                            aria-label={`Agregar una unidad de ${nombre}`}
                            onClick={() => t.sumar(r.productId, 1)}
                            disabled={actual >= tope}
                          >
                            <FaPlus aria-hidden="true" />
                          </button>
                        </div>

                        <button
                          type="button"
                          className="btn-icono is-peligro"
                          aria-label={`Eliminar ${nombre} del traslado`}
                          title="Eliminar del traslado"
                          onClick={() => t.quitar(r.productId)}
                        >
                          <FaTrashAlt aria-hidden="true" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            <p className="traslado-total" aria-live="polite">
              <FaBoxOpen aria-hidden="true" />
              <span>
                {cuantos(t.resumen.productos, "producto", "productos")} — Total:{" "}
                <strong>{cuantos(t.resumen.unidades, "unidad", "unidades")}</strong>
              </span>
            </p>
          </section>

          <section className="traslado-tarjeta">
            <label htmlFor="transfers-nota" className="traslado-titulo">
              <FaRegStickyNote aria-hidden="true" />
              Observación (opcional)
            </label>
            <textarea
              id="transfers-nota"
              rows={3}
              placeholder="Escribe una observación (opcional)…"
              value={t.nota}
              onChange={(e) => t.setNota(e.target.value)}
            />
          </section>
        </div>
      </div>
    </ModalShell>
  )
}

export default NuevoTraslado
