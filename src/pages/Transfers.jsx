import { useContext, useRef, useState } from "react"
import { FaExchangeAlt, FaEye, FaPlus, FaTrash } from "react-icons/fa"
import Swal from "sweetalert2"

import { LocationsContext, ProductContext } from "../context/contexts"
import { PERMISSIONS } from "../context/permissions"
import { useAuth } from "../hooks/useAuth"
import { useExistencias } from "../hooks/useExistencias"
import { useTraslados } from "../hooks/useTraslados"
import { registrarTraslado } from "../lib/api/traslados"
import { claveDeIdempotencia } from "../utils/ids"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import FormField from "../components/forms/FormField"
import DetalleDeTraslado from "../components/transfers/DetalleDeTraslado"
import "../styles/transfers.css"

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

const aFecha = (iso) =>
  new Date(iso).toLocaleString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

const ESTADOS = { aplicado: "Aplicado" }

function Transfers() {
  const { user, hasPermission } = useAuth()
  const { products = [] } = useContext(ProductContext)
  const { locations = [], ubicacionesActivas = [] } = useContext(LocationsContext)
  const { existencias, recargar: recargarExistencias } = useExistencias()
  const {
    traslados,
    cargando: cargandoHistorial,
    error: errorHistorial,
    recargar: recargarHistorial,
  } = useTraslados()

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
      fecha: aFecha(t.isoDate),
      origen: nombreUbicacion(t.originId),
      destino: nombreUbicacion(t.destinationId),
      ruta: `${nombreUbicacion(t.originId)} → ${nombreUbicacion(t.destinationId)}`,
      estado: ESTADOS[t.status] || t.status,
      renglones: renglonesConNombre,
      productos: renglonesConNombre.map((r) => `${r.nombre} × ${r.qty}`).join(", "),
    }
  })

  const detalle = historial.find((t) => t.id === detalleAbierto)

  return (
    <div className="view active crud transfers">
      <PageHeader descripcion="Mueve mercadería de una ubicación a otra. El traslado se aplica en el acto; uno equivocado se corrige con otro en sentido contrario." />

      <section className="card card-pad transfers-formulario" aria-labelledby="transfers-nuevo">
        <h2 id="transfers-nuevo">Nuevo traslado</h2>

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
                    type="number"
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

          <button
            type="button"
            className="btn btn-primary"
            onClick={enviar}
            disabled={guardando || sinOrigen || sinExistencias}
          >
            <FaExchangeAlt aria-hidden="true" />{guardando ? "Trasladando…" : "Trasladar"}
          </button>
        </div>
      </section>

      <section className="transfers-historial" aria-labelledby="transfers-historial">
        <h2 id="transfers-historial">Historial</h2>

        {cargandoHistorial && <p className="crud-cargando" role="status">Cargando traslados…</p>}

        {errorHistorial && (
          <EmptyState Icono={FaExchangeAlt} titulo="No se pudo cargar el historial" descripcion={errorHistorial} />
        )}

        {!cargandoHistorial && !errorHistorial && historial.length === 0 && (
          <EmptyState
            Icono={FaExchangeAlt}
            titulo="Todavía no hay traslados"
            descripcion="Los traslados que registres aparecerán aquí."
          />
        )}

        {historial.length > 0 && (
          <div className="table-wrap">
            <table aria-label="Historial de traslados">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Usuario</th>
                  <th scope="col">Origen → destino</th>
                  <th scope="col">Productos</th>
                  <th scope="col">Nota</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((t) => (
                  <tr key={t.id}>
                    <td>{t.fecha}</td>
                    <td>{t.userName || "—"}</td>
                    <td>{t.ruta}</td>
                    <td>{t.productos}</td>
                    <td>{t.note || "—"}</td>
                    <td>{t.estado}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm transfers-ver"
                        aria-label={`Ver detalle del traslado ${t.ruta}, ${t.fecha}`}
                        onClick={() => setDetalleAbierto(t.id)}
                      >
                        <FaEye aria-hidden="true" />Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detalle && (
        <DetalleDeTraslado
          traslado={{
            fecha: detalle.fecha,
            origen: detalle.origen,
            destino: detalle.destino,
            estado: detalle.estado,
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
