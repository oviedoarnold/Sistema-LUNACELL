import { useContext, useRef, useState } from "react"
import { FaExchangeAlt, FaPlus, FaTrash } from "react-icons/fa"
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

  const disponible = (productId) =>
    existencias.find((e) => e.locationId === origen && e.productId === productId)?.quantity ?? 0

  const cambiarOrigen = (valor) => {
    setOrigenElegido(valor)
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

  const historial = traslados.map((t) => ({
    ...t,
    ruta: `${nombreUbicacion(t.originId)} → ${nombreUbicacion(t.destinationId)}`,
    productos: t.items.map((i) => `${nombreProducto(i.productId)} × ${i.qty}`).join(", "),
  }))

  return (
    <div className="view active crud transfers">
      <PageHeader descripcion="Mueve mercadería de una ubicación a otra. El traslado se aplica en el acto; uno equivocado se corrige con otro en sentido contrario." />

      <section className="card" aria-labelledby="transfers-nuevo">
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

        {renglones.map((r, indice) => {
          const numero = indice + 1

          return (
            <div className="form-grid transfers-renglon" key={r.clave}>
              <FormField etiqueta={`Producto del renglón ${numero}`}>
                <select
                  id={`transfers-producto-${r.clave}`}
                  value={r.productId}
                  onChange={(e) => cambiarRenglon(r.clave, { productId: e.target.value })}
                >
                  <option value="">— Elige un producto —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                  step="1"
                  value={r.qty}
                  onChange={(e) => cambiarRenglon(r.clave, { qty: e.target.value })}
                />
              </FormField>

              {renglones.length > 1 && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  aria-label={`Quitar renglón ${numero}`}
                  onClick={() => setRenglones((actuales) => actuales.filter((x) => x.clave !== r.clave))}
                >
                  <FaTrash aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setRenglones((actuales) => [...actuales, renglonVacio()])}
        >
          <FaPlus aria-hidden="true" />Agregar producto
        </button>

        <FormField etiqueta="Observación" ancho="full">
          <textarea id="transfers-nota" value={nota} onChange={(e) => setNota(e.target.value)} rows={2} />
        </FormField>

        <button
          type="button"
          className="btn btn-primary"
          onClick={enviar}
          disabled={guardando || sinOrigen}
        >
          <FaExchangeAlt aria-hidden="true" />{guardando ? "Trasladando…" : "Trasladar"}
        </button>
      </section>

      <section aria-labelledby="transfers-historial">
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
                </tr>
              </thead>
              <tbody>
                {historial.map((t) => (
                  <tr key={t.id}>
                    <td>{aFecha(t.isoDate)}</td>
                    <td>{t.userName || "—"}</td>
                    <td>{t.ruta}</td>
                    <td>{t.productos}</td>
                    <td>{t.note || "—"}</td>
                    <td>{ESTADOS[t.status] || t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default Transfers
