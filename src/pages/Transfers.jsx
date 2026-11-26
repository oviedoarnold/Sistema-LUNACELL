import { useContext, useState } from "react"
import { FaExchangeAlt, FaEye, FaLongArrowAltRight, FaPlus, FaSearch, FaTimes } from "react-icons/fa"
import Swal from "sweetalert2"

import { LocationsContext, ProductContext } from "../context/contexts"
import { PERMISSIONS } from "../context/permissions"
import { useAuth } from "../hooks/useAuth"
import { useExistencias } from "../hooks/useExistencias"
import { useNuevoTraslado } from "../hooks/useNuevoTraslado"
import { useTraslados } from "../hooks/useTraslados"
import {
  avisarCambioDeTraslados,
  esConfirmacionAdministrativa,
  puedeRecibirEste,
  useTrasladosPorRecibir,
} from "../hooks/useTrasladosPorRecibir"
import { confirmarRecepcion, reportarIncidencia } from "../lib/api/traslados"
import { fechaYHora } from "../utils/format"
import { coincideBusqueda } from "../utils/texto"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import DetalleDeTraslado from "../components/transfers/DetalleDeTraslado"
import NuevoTraslado from "../components/transfers/NuevoTraslado"
import "../styles/transfers.css"

/*
  Traslados de existencia entre ubicaciones.

  El historial con sus filtros, y el botón «Nuevo traslado», que abre la
  ventana del carrito (NuevoTraslado, con su estado en useNuevoTraslado).
  Si alcanza, quién puede y desde dónde lo decide la base.

  Desde la 0056, arriba, «Por recibir»: los traslados que llegan a la
  ubicación de quien mira (o todos, para el administrador). En su detalle se
  confirma la recepción o se reporta una incidencia; la base vuelve a
  comprobar quién puede.
*/

const ESTADOS = {
  aplicado: "Aplicado",
  pendiente: "Pendiente de recepción",
  con_incidencia: "Con incidencia",
  recibido: "Recibido",
}

const CLASE_DEL_ESTADO = {
  aplicado: "badge badge-paid",
  recibido: "badge badge-paid",
  pendiente: "badge badge-low",
  con_incidencia: "badge badge-out",
}

const cuantosProductos = (n) => (n === 1 ? "1 producto" : `${n} productos`)
const cuantasUnidades = (n) => (n === 1 ? "1 unidad" : `${n} unidades`)

// Quién recibió y cuándo, en una línea; o por qué no hay recepción.
function textoDeRecepcion(t) {
  if (t.status === "recibido") return `${t.receivedBy || "—"} · ${fechaYHora(t.receivedAt)}`
  if (t.status === "aplicado") return "Antes del control de recepción"

  return "Pendiente"
}

// La observación obligatoria: de 5 a 500 caracteres, sin contar espacios de los extremos.
const validarObservacion = (valor) => {
  const largo = String(valor || "").trim().length

  return largo < 5 || largo > 500 ? "Escribe de 5 a 500 caracteres." : undefined
}

/*
  La búsqueda revisa los traslados ya cargados: número, ubicaciones,
  productos, usuario, nota y fecha. Ignora tildes y mayúsculas. No
  consulta nada: los filtros de ubicación y fechas siguen siendo los de la
  consulta.
*/
const coincideTraslado = (t, texto) =>
  [t.numero, t.origen, t.destino, t.productos, t.userName, t.note, t.fecha].some((campo) => coincideBusqueda(campo, texto))

/*
  El estado con su color: aplicado y recibido son estados terminados y
  buenos (verde); pendiente, ámbar; con incidencia, rojo. Uno que el sistema
  no conozca se muestra tal cual, en gris.
*/
export function EstadoDelTraslado({ estado, texto }) {
  return <span className={CLASE_DEL_ESTADO[estado] || "badge badge-neutral"}>{texto}</span>
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

  const [detalleAbierto, setDetalleAbierto] = useState(null)
  const [procesando, setProcesando] = useState(false)

  const { traslados: pendientes, recargar: recargarPendientes } = useTrasladosPorRecibir()

  const nombreUbicacion = (id) => locations.find((u) => u.id === id)?.name || "—"
  const nombreProducto = (id) => products.find((p) => String(p.id) === String(id))?.name || "Producto"

  /*
    El formulario vive en una ventana. Cerrarla no borra lo preparado: el
    estado es de la pantalla (useNuevoTraslado), no de la ventana. Mientras
    se registra no se cierra, para que nadie crea que lo canceló.
  */
  const [formularioAbierto, setFormularioAbierto] = useState(false)

  const nuevoTraslado = useNuevoTraslado({
    veTodas,
    propia,
    ubicacionesActivas,
    existencias,
    nombreUbicacion,
    nombreProducto,
    alRegistrar: async () => {
      setFormularioAbierto(false)
      await Promise.all([recargarExistencias(), recargarHistorial()])
      avisarCambioDeTraslados()
    },
  })

  const cerrarFormulario = () => {
    if (!nuevoTraslado.estaEnviando()) setFormularioAbierto(false)
  }

  /*
    El nombre del producto viene con el traslado, resuelto aunque ya no
    esté activo; el catálogo de la pantalla queda solo de respaldo.
  */
  const nombrado = (t) => {
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
      recepcion: textoDeRecepcion(t),
      renglones: renglonesConNombre,
      productos: renglonesConNombre.map((r) => `${r.nombre} × ${r.qty}`).join(", "),
    }
  }

  const historial = traslados.map(nombrado)
  const porRecibir = pendientes.map(nombrado)

  const buscado = busqueda.trim()
  const visibles = buscado ? historial.filter((t) => coincideTraslado(t, buscado)) : historial

  const detalle = porRecibir.find((t) => t.id === detalleAbierto) || historial.find((t) => t.id === detalleAbierto)

  // Después de confirmar o reportar: todo lo que muestra el traslado, al día.
  const alCambiarRecepcion = async () => {
    avisarCambioDeTraslados()
    await Promise.all([recargarExistencias(), recargarHistorial(), recargarPendientes()])
  }

  /*
    Confirmar pide una confirmación explícita. Si es una confirmación
    administrativa, además la observación que explica el motivo; la base lo
    decide igual y la exige.
  */
  const confirmar = async (t) => {
    const administrativa = esConfirmacionAdministrativa(t, user)
    const pregunta = administrativa
      ? await Swal.fire({
          icon: "warning",
          title: "Confirmación administrativa",
          text: `Confirmarás como administrador la recepción de ${t.numero} en ${t.destino}. Explica el motivo real (de 5 a 500 caracteres).`,
          input: "textarea",
          inputLabel: "Observación",
          inputPlaceholder: "Motivo de la confirmación administrativa",
          inputValidator: validarObservacion,
          showCancelButton: true,
          confirmButtonText: "Confirmar recepción",
          cancelButtonText: "Volver",
        })
      : await Swal.fire({
          icon: "question",
          title: "Confirmar recepción",
          text: "¿Confirmas que recibiste físicamente todas las unidades de este traslado? Los productos se incorporarán al inventario de tu ubicación.",
          showCancelButton: true,
          confirmButtonText: "Confirmar recepción",
          cancelButtonText: "Volver",
        })

    if (!pregunta.isConfirmed) return

    setProcesando(true)

    try {
      await confirmarRecepcion(t.id, administrativa ? String(pregunta.value).trim() : null)
      await alCambiarRecepcion()
      setDetalleAbierto(null)
      Swal.fire({ icon: "success", title: "Recepción confirmada", text: `${t.numero}: ${cuantasUnidades(t.units)} en ${t.destino}.` })
    } catch (problema) {
      Swal.fire({ icon: "error", title: "No se pudo confirmar la recepción", text: problema.message })
    } finally {
      setProcesando(false)
    }
  }

  const reportar = async (t) => {
    const pregunta = await Swal.fire({
      icon: "warning",
      title: "Reportar incidencia",
      text: "Describe la diferencia con lo enviado (de 5 a 500 caracteres). El traslado quedará sin confirmar hasta resolverla.",
      input: "textarea",
      inputLabel: "Observación",
      inputPlaceholder: "Por ejemplo: llegaron 4 cargadores, se enviaron 5",
      inputValidator: validarObservacion,
      showCancelButton: true,
      confirmButtonText: "Reportar incidencia",
      cancelButtonText: "Volver",
    })

    if (!pregunta.isConfirmed) return

    setProcesando(true)

    try {
      await reportarIncidencia(t.id, String(pregunta.value).trim())
      await alCambiarRecepcion()
      Swal.fire({ icon: "success", title: "Incidencia reportada", text: `${t.numero} queda sin confirmar hasta resolver la diferencia.` })
    } catch (problema) {
      Swal.fire({ icon: "error", title: "No se pudo reportar la incidencia", text: problema.message })
    } finally {
      setProcesando(false)
    }
  }

  return (
    <div className="view active crud transfers">
      <PageHeader descripcion="Movimientos de mercadería entre ubicaciones. Lo enviado sale del origen al enviarlo y entra al destino cuando alguien de esa ubicación confirma la recepción.">
        {!soloLectura && (
          <button type="button" className="btn btn-primary" onClick={() => setFormularioAbierto(true)}>
            <FaPlus aria-hidden="true" />Nuevo traslado
          </button>
        )}
      </PageHeader>

      {!soloLectura && formularioAbierto && (
        <NuevoTraslado
          traslado={nuevoTraslado}
          productos={products}
          nombreUbicacion={nombreUbicacion}
          onCerrar={cerrarFormulario}
        />
      )}

      {porRecibir.length > 0 && (
        <section className="transfers-por-recibir" aria-labelledby="transfers-por-recibir">
          <h2 id="transfers-por-recibir" className="transfers-por-recibir-titulo">
            Por recibir <span className="transfers-por-recibir-cantidad">{porRecibir.length}</span>
          </h2>

          <div className="table-wrap">
            <table aria-label="Traslados por recibir" className="tabla-adaptable transfers-tabla">
              <thead>
                <tr>
                  <th scope="col">N.º traslado</th>
                  <th scope="col">Origen</th>
                  <th scope="col">Enviado</th>
                  <th scope="col">Remitente</th>
                  <th scope="col" className="num">Unidades</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="th-acciones">Acción</th>
                </tr>
              </thead>
              <tbody>
                {porRecibir.map((t) => (
                  <tr key={t.id}>
                    <td className="transfers-numero">{t.numero || "—"}</td>
                    <td data-etiqueta="Origen">{t.origen}</td>
                    <td data-etiqueta="Enviado" className="transfers-fecha">{t.fecha}</td>
                    <td data-etiqueta="Remitente">{t.userName || "—"}</td>
                    <td data-etiqueta="Unidades" className="num">{t.units}</td>
                    <td data-etiqueta="Estado"><EstadoDelTraslado estado={t.status} texto={t.estado} /></td>
                    <td className="celda-acciones">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        aria-label={`Ver traslado ${t.numero} desde ${t.origen}`}
                        onClick={() => setDetalleAbierto(t.id)}
                      >
                        <FaEye aria-hidden="true" />Ver traslado
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
                  <th scope="col">Recepción</th>
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
                    <td data-etiqueta="Recepción" className="transfers-recepcion">
                      {t.recepcion}
                      {t.administrative && <span className="transfers-administrativa">Confirmación administrativa</span>}
                    </td>
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
            unidades: detalle.units,
            recibidoPor: detalle.receivedBy,
            recibidoEn: detalle.receivedAt ? fechaYHora(detalle.receivedAt) : "",
            administrativa: detalle.administrative,
            observacion: detalle.receptionNote,
            incidencia: detalle.incident,
            incidenciaPor: detalle.incidentBy,
            incidenciaEn: detalle.incidentAt ? fechaYHora(detalle.incidentAt) : "",
          }}
          puedeRecibir={!soloLectura && puedeRecibirEste(detalle, user, hasPermission)}
          procesando={procesando}
          onConfirmar={() => confirmar(detalle)}
          onReportar={() => reportar(detalle)}
          onCerrar={() => setDetalleAbierto(null)}
        />
      )}
    </div>
  )
}

export default Transfers
