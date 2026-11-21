import { useContext, useRef, useState } from "react"
import { FaExchangeAlt, FaEye, FaLongArrowAltRight, FaPlus, FaSearch, FaTimes, FaTrash } from "react-icons/fa"
import Swal from "sweetalert2"

import { LocationsContext, ProductContext } from "../context/contexts"
import { PERMISSIONS } from "../context/permissions"
import { useAuth } from "../hooks/useAuth"
import { useExistencias } from "../hooks/useExistencias"
import { useTraslados } from "../hooks/useTraslados"
import { registrarTraslado } from "../lib/api/traslados"
import { fechaYHora } from "../utils/format"
import { claveDeIdempotencia } from "../utils/ids"
import { coincideBusqueda } from "../utils/texto"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import FormField from "../components/forms/FormField"
import ModalShell from "../components/forms/ModalShell"
import DetalleDeTraslado from "../components/transfers/DetalleDeTraslado"
import "../styles/transfers.css"
import { CAMPO_DE_CANTIDAD } from "../utils/camposNumericos"

/*
  Traslados de existencia entre ubicaciones.

  La pantalla arma el pedido —de dónde, hacia dónde, qué y cuánto— y lo
  manda en una sola llamada. Si alcanza, quién puede y desde dónde lo
  decide la base; aquí solo se evita ofrecer lo que no se puede pedir:

  - quien ve todas las ubicaciones elige cualquier origen activo;
  - quien solo ve la suya traslada DESDE ella, hacia cualquier otra.
*/

let siguienteRenglon = 0

const renglonVacio = () => ({ clave: ++siguienteRenglon, productId: "", qty: "" })

const ESTADOS = { aplicado: "Aplicado" }

const cuantosProductos = (n) => (n === 1 ? "1 producto" : `${n} productos`)

/*
  La búsqueda revisa los traslados ya cargados: número, ubicaciones,
  productos, usuario, nota y fecha. Ignora tildes y mayúsculas. No
  consulta nada: los filtros de ubicación y fechas siguen siendo los de la
  consulta.
*/
const coincideTraslado = (t, texto) =>
  [t.numero, t.origen, t.destino, t.productos, t.userName, t.note, t.fecha].some((campo) => coincideBusqueda(campo, texto))

/*
  El estado con su color: aplicado es un estado terminado y bueno (verde).
  Uno que el sistema no conozca se muestra tal cual, en gris.
*/
export function EstadoDelTraslado({ estado, texto }) {
  return <span className={estado === "aplicado" ? "badge badge-paid" : "badge badge-neutral"}>{texto}</span>
}

function Transfers() {
  // El contador consulta el historial; no registra traslados (0036).
  const { user, hasPermission, soloLectura } = useAuth()
  const { products = [] } = useContext(ProductContext)
  const { locations = [], ubicacionesActivas = [] } = useContext(LocationsContext)
  const { existencias, recargar: recargarExistencias } = useExistencias()

  /*
    Filtros del historial. Los aplica la consulta, no esta pantalla: aquí
    solo se eligen. Un rango con desde después de hasta no se consulta.
  */
  const [filtroUbicacion, setFiltroUbicacion] = useState("")
  const [filtroDesde, setFiltroDesde] = useState("")
  const [filtroHasta, setFiltroHasta] = useState("")

  const [busqueda, setBusqueda] = useState("")

  const rangoInvalido = Boolean(filtroDesde && filtroHasta && filtroDesde > filtroHasta)
  const hayFiltros = Boolean(filtroUbicacion || filtroDesde || filtroHasta)

  const {
    traslados,
    cargando: cargandoHistorial,
    error: errorHistorial,
    recargar: recargarHistorial,
    hayMas,
    cargandoMas,
    errorMas,
    cargarMas,
  } = useTraslados({
    ubicacionId: filtroUbicacion,
    desde: filtroDesde,
    hasta: filtroHasta,
    activo: !rangoInvalido,
  })

  const limpiarFiltros = () => {
    setFiltroUbicacion("")
    setFiltroDesde("")
    setFiltroHasta("")
    setBusqueda("")
  }

  const veTodas = hasPermission(PERMISSIONS.INVENTORY_ALL)
  const propia = user?.locationId || ""

  const origenes = veTodas
    ? ubicacionesActivas
    : ubicacionesActivas.filter((u) => u.id === propia)

  const [origenElegido, setOrigenElegido] = useState("")
  const [destino, setDestino] = useState("")
  const [renglones, setRenglones] = useState(() => [renglonVacio()])
  const [nota, setNota] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [detalleAbierto, setDetalleAbierto] = useState(null)

  /*
    El formulario vive en una ventana. Cerrarla no borra lo escrito: el
    estado es de la pantalla, no de la ventana. Mientras se registra no se
    cierra, para que nadie crea que lo canceló.
  */
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const cerrarFormulario = () => {
    if (!enviando.current) setFormularioAbierto(false)
  }

  // Un intento de traslado, no un clic: se renueva solo cuando se registra.
  const [clave, setClave] = useState(claveDeIdempotencia)

  // El estado se pinta en el render siguiente; dos clics seguidos no lo verían.
  const enviando = useRef(false)

  // Quien solo ve su ubicación no elige: el origen es la suya.
  const origen = veTodas ? origenElegido : origenes[0]?.id || ""
  const sinOrigen = !veTodas && !origen

  const destinos = ubicacionesActivas.filter((u) => u.id !== origen)

  const nombreUbicacion = (id) => locations.find((u) => u.id === id)?.name || "—"
  const nombreProducto = (id) => products.find((p) => String(p.id) === String(id))?.name || "Producto"

  /*
    Lo que se puede trasladar sale de la existencia de la UBICACIÓN de
    origen, no del stock global: un producto con 20 en total y 0 en este
    camión no se ofrece. Es una ayuda para no pedir lo que no hay; si la
    existencia cambia entre esta lectura y el traslado, registrar_traslado
    lo rechaza igual (LT005) y la pantalla muestra su mensaje.
  */
  const disponibles = origen
    ? existencias.filter((e) => e.locationId === origen && e.quantity > 0)
    : []

  const sinExistencias = Boolean(origen) && disponibles.length === 0

  const disponible = (productId) =>
    disponibles.find((e) => e.productId === productId)?.quantity ?? 0

  // Cada producto en un solo renglón: lo elegido en los demás no se ofrece.
  const opcionesPara = (claveRenglon) => {
    const elegidosEnOtros = new Set(
      renglones.filter((r) => r.clave !== claveRenglon && r.productId).map((r) => r.productId)
    )

    return disponibles.filter((e) => !elegidosEnOtros.has(e.productId))
  }

  /*
    Otro origen es otra referencia: lo elegido y las cantidades del
    anterior no valen para este.
  */
  const cambiarOrigen = (valor) => {
    setOrigenElegido(valor)
    setRenglones([renglonVacio()])
    if (valor === destino) setDestino("")
  }

  const cambiarRenglon = (claveRenglon, cambios) =>
    setRenglones((actuales) =>
      actuales.map((r) => (r.clave === claveRenglon ? { ...r, ...cambios } : r))
    )

  const enviar = async () => {
    if (enviando.current) return

    const items = renglones
      .filter((r) => r.productId)
      .map((r) => ({ productId: r.productId, qty: Number(r.qty) }))

    if (!origen || !destino) {
      Swal.fire({ icon: "warning", title: "Faltan datos", text: "Elige el origen y el destino del traslado." })
      return
    }

    if (items.length === 0 || items.some((i) => !Number.isInteger(i.qty) || i.qty <= 0)) {
      Swal.fire({
        icon: "warning",
        title: "Revisa los productos",
        text: "Cada producto necesita una cantidad entera mayor que cero.",
      })
      return
    }

    const excedidos = items.filter((i) => i.qty > disponible(i.productId))

    if (excedidos.length > 0) {
      Swal.fire({
        icon: "warning",
        title: "Cantidad mayor que la disponible",
        text: excedidos
          .map((i) => `${nombreProducto(i.productId)}: hay ${disponible(i.productId)} en ${nombreUbicacion(origen)}, pides ${i.qty}.`)
          .join(" "),
      })
      return
    }

    enviando.current = true
    setGuardando(true)

    try {
      await registrarTraslado(
        { origenId: origen, destinoId: destino, items, nota: nota.trim() },
        { clave }
      )

      setClave(claveDeIdempotencia())
      setRenglones([renglonVacio()])
      setNota("")
      setFormularioAbierto(false)

      await Promise.all([recargarExistencias(), recargarHistorial()])

      Swal.fire({ icon: "success", title: "Traslado registrado" })
    } catch (problema) {
      Swal.fire({ icon: "error", title: "No se pudo trasladar", text: problema.message })
    } finally {
      enviando.current = false
      setGuardando(false)
    }
  }

  /*
    El nombre del producto viene con el traslado, resuelto aunque ya no
    esté activo; el catálogo de la pantalla queda solo de respaldo.
  */
  const historial = traslados.map((t) => {
    const renglonesConNombre = t.items.map((i) => ({
      ...i,
      nombre: i.productName || nombreProducto(i.productId),
    }))

    return {
      ...t,
      fecha: fechaYHora(t.isoDate),
      origen: nombreUbicacion(t.originId),
      destino: nombreUbicacion(t.destinationId),
      ruta: `${nombreUbicacion(t.originId)} → ${nombreUbicacion(t.destinationId)}`,
      estado: ESTADOS[t.status] || t.status,
      renglones: renglonesConNombre,
      productos: renglonesConNombre.map((r) => `${r.nombre} × ${r.qty}`).join(", "),
    }
  })

  const buscado = busqueda.trim()
  const visibles = buscado ? historial.filter((t) => coincideTraslado(t, buscado)) : historial

  const detalle = historial.find((t) => t.id === detalleAbierto)

  return (
    <div className="view active crud transfers">
      <PageHeader descripcion="Movimientos de mercadería entre ubicaciones. El traslado se aplica en el acto; uno equivocado se corrige con otro en sentido contrario.">
        {!soloLectura && (
          <button type="button" className="btn btn-primary" onClick={() => setFormularioAbierto(true)}>
            <FaPlus aria-hidden="true" />Nuevo traslado
          </button>
        )}
      </PageHeader>

      {!soloLectura && formularioAbierto && <ModalShell
        titulo="Nuevo traslado"
        onCerrar={cerrarFormulario}
        ancho="modal-wide"
        acciones={
          <>
            <button type="button" className="btn btn-secondary" onClick={cerrarFormulario} disabled={guardando}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={enviar}
              disabled={guardando || sinOrigen || sinExistencias}
            >
              <FaExchangeAlt aria-hidden="true" />{guardando ? "Trasladando…" : "Trasladar"}
            </button>
          </>
        }
      >
       <div className="transfers-formulario">

        {sinOrigen && (
          <p className="alert-banner" role="status">
            No tienes una ubicación operativa asignada: pide que te asignen una para poder trasladar desde ella.
          </p>
        )}

        <div className="form-grid">
          <FormField etiqueta="Origen">
            <select
              id="transfers-origen"
              value={origen}
              onChange={(e) => cambiarOrigen(e.target.value)}
              disabled={!veTodas}
            >
              {veTodas && <option value="">— Elige el origen —</option>}
              {origenes.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FormField>

          <FormField etiqueta="Destino">
            <select id="transfers-destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">— Elige el destino —</option>
              {destinos.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FormField>
        </div>

        {sinExistencias && (
          <p className="alert-banner" role="status">
            No hay productos con existencia en {nombreUbicacion(origen)}. Elige otro origen para trasladar.
          </p>
        )}

        <div className="transfers-renglones">
          {renglones.map((r, indice) => {
            const numero = indice + 1

            return (
              <div className="transfers-renglon" key={r.clave}>
                <FormField etiqueta={`Producto del renglón ${numero}`}>
                  <select
                    id={`transfers-producto-${r.clave}`}
                    value={r.productId}
                    onChange={(e) => cambiarRenglon(r.clave, { productId: e.target.value })}
                  >
                    <option value="">{origen ? "— Elige un producto —" : "— Elige primero el origen —"}</option>
                    {opcionesPara(r.clave).map((e) => (
                      <option key={e.productId} value={e.productId}>
                        {`${e.productName} — ${e.quantity} disponibles`}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField
                  etiqueta={`Cantidad del renglón ${numero}`}
                  ayuda={r.productId && origen ? `Disponible en origen: ${disponible(r.productId)}` : undefined}
                >
                  <input
                    id={`transfers-cantidad-${r.clave}`}
                    type="number" {...CAMPO_DE_CANTIDAD}
                    min="1"
                    max={r.productId ? disponible(r.productId) : undefined}
                    step="1"
                    value={r.qty}
                    onChange={(e) => cambiarRenglon(r.clave, { qty: e.target.value })}
                  />
                </FormField>

                {renglones.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm transfers-quitar"
                    aria-label={`Quitar renglón ${numero}`}
                    onClick={() => setRenglones((actuales) => actuales.filter((x) => x.clave !== r.clave))}
                  >
                    <FaTrash aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <FormField etiqueta="Observación" ancho="full">
          <textarea id="transfers-nota" value={nota} onChange={(e) => setNota(e.target.value)} rows={2} />
        </FormField>

        <div className="transfers-acciones">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRenglones((actuales) => [...actuales, renglonVacio()])}
          >
            <FaPlus aria-hidden="true" />Agregar producto
          </button>
        </div>
       </div>
      </ModalShell>}

      <section className="transfers-historial" aria-labelledby="transfers-historial">
        <h2 id="transfers-historial" className="solo-lector">Historial</h2>

        {/*
          Búsqueda y filtros en una línea, cada filtro con su rótulo dentro
          de la caja. Ubicación y fechas los aplica la consulta; la búsqueda,
          lo ya cargado.
        */}
        <div className="transfers-filtros">
          <div className="search-box">
            <FaSearch aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar traslado"
              placeholder="Buscar traslado…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          <div className="filtro-en-linea">
            <label htmlFor="transfers-filtro-ubicacion">Ubicación</label>
            <select
              id="transfers-filtro-ubicacion"
              value={filtroUbicacion}
              onChange={(e) => setFiltroUbicacion(e.target.value)}
            >
              <option value="">Todas</option>
              {locations.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div className="filtro-en-linea">
            <label htmlFor="transfers-filtro-desde">Desde</label>
            <input
              id="transfers-filtro-desde"
              type="date"
              value={filtroDesde}
              max={filtroHasta || undefined}
              onChange={(e) => setFiltroDesde(e.target.value)}
            />
          </div>

          <div className={rangoInvalido ? "filtro-en-linea is-error" : "filtro-en-linea"}>
            <label htmlFor="transfers-filtro-hasta">Hasta</label>
            <input
              id="transfers-filtro-hasta"
              type="date"
              value={filtroHasta}
              min={filtroDesde || undefined}
              aria-invalid={rangoInvalido ? "true" : undefined}
              aria-describedby={rangoInvalido ? "transfers-error-fechas" : undefined}
              onChange={(e) => setFiltroHasta(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm transfers-limpiar"
            onClick={limpiarFiltros}
            disabled={!hayFiltros && !busqueda}
          >
            <FaTimes aria-hidden="true" />Limpiar filtros
          </button>
        </div>

        {rangoInvalido && (
          <p className="error-msg show transfers-error-fechas" id="transfers-error-fechas" role="alert">
            La fecha desde no puede ser posterior a la fecha hasta.
          </p>
        )}

        {cargandoHistorial && <p className="crud-cargando" role="status">Cargando traslados…</p>}

        {errorHistorial && (
          <EmptyState Icono={FaExchangeAlt} titulo="No se pudo cargar el historial" descripcion={errorHistorial} />
        )}

        {!rangoInvalido && !cargandoHistorial && !errorHistorial && historial.length === 0 && (
          hayFiltros ? (
            <EmptyState
              Icono={FaSearch}
              titulo="No hay traslados con estos filtros"
              descripcion="Cambia los filtros o límpialos."
            />
          ) : (
            <EmptyState
              Icono={FaExchangeAlt}
              titulo="Todavía no hay traslados"
              descripcion="Los traslados que registres aparecerán aquí."
            />
          )
        )}

        {historial.length > 0 && visibles.length === 0 && (
          <EmptyState
            Icono={FaSearch}
            titulo="Ningún traslado coincide con la búsqueda"
            descripcion={hayMas ? "La búsqueda revisa los traslados cargados: carga más o cambia la búsqueda." : "Cambia la búsqueda o límpiala."}
          />
        )}

        {/*
          Una fila por traslado, en una sola línea: número, origen, destino,
          cuántos productos, fecha y estado. Qué productos y cuántos de cada
          uno, quién lo hizo y la nota están en el detalle (el ojo).
        */}
        {visibles.length > 0 && (
          <div className="table-wrap">
            <table aria-label="Historial de traslados" className="tabla-adaptable transfers-tabla">
              <thead>
                <tr>
                  <th scope="col">N.º traslado</th>
                  <th scope="col">Origen</th>
                  <th scope="col">Destino</th>
                  <th scope="col">Productos</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="th-acciones">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((t) => (
                  <tr key={t.id}>
                    <td className="transfers-numero">{t.numero || "—"}</td>
                    <td data-etiqueta="Origen" className="transfers-origen">
                      <span>{t.origen}</span>
                      <FaLongArrowAltRight aria-hidden="true" className="transfers-flecha" />
                    </td>
                    <td data-etiqueta="Destino" className="transfers-destino">{t.destino}</td>
                    <td data-etiqueta="Productos" className="transfers-productos" title={t.productos}>
                      {cuantosProductos(t.renglones.length)}
                    </td>
                    <td data-etiqueta="Fecha" className="transfers-fecha">{t.fecha}</td>
                    <td data-etiqueta="Estado"><EstadoDelTraslado estado={t.status} texto={t.estado} /></td>
                    <td className="celda-acciones">
                      <button
                        type="button"
                        className="btn-icono"
                        title="Ver detalle"
                        aria-label={`Ver detalle del traslado ${[t.numero, t.ruta, t.fecha].filter(Boolean).join(", ")}`}
                        onClick={() => setDetalleAbierto(t.id)}
                      >
                        <FaEye aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          Si la página siguiente falla, lo ya visto se queda y el mismo
          botón sirve para intentarlo otra vez.
        */}
        {errorMas && (
          <p className="alert-banner" role="alert">
            No se pudieron cargar más traslados. Inténtalo de nuevo.
          </p>
        )}

        {hayMas && (
          <div className="transfers-mas">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={cargarMas}
              disabled={cargandoMas}
              aria-busy={cargandoMas || undefined}
            >
              {cargandoMas ? "Cargando más…" : "Cargar más"}
            </button>
          </div>
        )}
      </section>

      {detalle && (
        <DetalleDeTraslado
          traslado={{
            numero: detalle.numero,
            fecha: detalle.fecha,
            origen: detalle.origen,
            destino: detalle.destino,
            estado: detalle.estado,
            status: detalle.status,
            usuario: detalle.userName,
            nota: detalle.note,
            renglones: detalle.renglones,
          }}
          onCerrar={() => setDetalleAbierto(null)}
        />
      )}
    </div>
  )
}

export default Transfers
