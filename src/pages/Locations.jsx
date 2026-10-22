import { useContext, useMemo, useState } from "react"
import {
  FaBoxOpen,
  FaMapMarkerAlt,
  FaPen,
  FaPlus,
  FaPowerOff,
  FaSearch,
  FaStore,
  FaTruck,
  FaWarehouse,
  FaWifi,
} from "react-icons/fa"
import Swal from "sweetalert2"

import { LocationsContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"
import DesactivarSinConexion from "../components/sinConexion/DesactivarSinConexion"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import StatusBadge from "../components/crud/StatusBadge"
import FormField from "../components/forms/FormField"
import ModalShell from "../components/forms/ModalShell"

import {
  DEFAULT_LOCATION_TYPE,
  LOCATION_TYPE_OPTIONS,
  filterLocationsBySearchText,
  getLocationNameError,
  getLocationTypeLabel,
  LOCATION_TYPES,
  puedeVenderSinConexion,
} from "../utils/locations"

const emptyForm = { id: null, name: "", type: DEFAULT_LOCATION_TYPE, offline: false }

/*
  Lo que explica la casilla de ventas sin conexión según el caso. La base
  decide de todos modos (0027 y 0030); esto evita ofrecer lo que rechazaría.
*/
function ayudaSinConexion(tipo, esAdmin) {
  if (!puedeVenderSinConexion(tipo)) {
    return tipo === LOCATION_TYPES.STORE
      ? "Las tiendas no están autorizadas para vender sin conexión."
      : "Solo los camiones y las bodegas pueden vender sin conexión."
  }

  if (!esAdmin) return "Solo un administrador puede cambiar esta opción."

  return "Los teléfonos de esta ubicación podrán facturar sin señal. El cambio les llega cuando abren el POS con conexión."
}

/*
  Cada tipo de ubicación lleva su propio icono además del texto. El color
  no distingue nada aquí a propósito: quien no percibe la diferencia entre
  dos grises tiene que poder separar una bodega de un camión igual de
  rápido, y para eso sirven la forma y la palabra.
*/
const ICONO_POR_TIPO = {
  bodega: FaWarehouse,
  tienda: FaStore,
  camion: FaTruck,
  otro: FaMapMarkerAlt,
}

function Locations() {
  const {
    locations = [],
    cargando,
    agregarUbicacion,
    editarUbicacion,
    cambiarEstado,
  } = useContext(LocationsContext)
  const { isAdmin } = useAuth()

  const [search, setSearch] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  // La ubicación como estaba al abrir el formulario: con ella se sabe si la marca cambió.
  const [original, setOriginal] = useState(null)
  const [confirmandoDesactivar, setConfirmandoDesactivar] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const filtered = useMemo(
    () => filterLocationsBySearchText(locations, search),
    [locations, search]
  )

  const inactivas = locations.filter((ubicacion) => !ubicacion.active).length

  const openNew = () => { setForm(emptyForm); setOriginal(null); setModalOpen(true) }
  const openEdit = (ubicacion) => { setForm({ ...emptyForm, ...ubicacion }); setOriginal(ubicacion); setModalOpen(true) }
  const closeModal = () => { setModalOpen(false); setConfirmandoDesactivar(false) }

  const sinConexionEditable = isAdmin && puedeVenderSinConexion(form.type)
  const cambiaSinConexion = Boolean(form.id && original && isAdmin && Boolean(form.offline) !== Boolean(original.offline))

  /*
    Mientras la casilla está marcada, el tipo solo puede ser camión o
    bodega: lo contrario es justo lo que la base rechaza (0030).
  */
  const tiposDisponibles = form.offline
    ? LOCATION_TYPE_OPTIONS.filter((opcion) => puedeVenderSinConexion(opcion.value))
    : LOCATION_TYPE_OPTIONS

  const avisoDeExito = () => {
    const nombre = form.name.trim()

    if (!cambiaSinConexion) return { icon: "success", title: form.id ? "Ubicación actualizada" : "Ubicación agregada" }

    return {
      icon: "success",
      title: "Ubicación actualizada",
      text: form.offline
        ? `«${nombre}» ya puede vender sin conexión. Los teléfonos lo reciben al abrir el POS con conexión.`
        : `«${nombre}» ya no vende sin conexión. Lo que llegue de sus teléfonos irá a Conciliación.`,
    }
  }

  const guardar = async () => {
    setGuardando(true)
    try {
      if (form.id) {
        // Quien no es administrador nunca cambia la marca, aunque la casilla dijera otra cosa.
        const datos = isAdmin ? form : { ...form, offline: original?.offline }
        await editarUbicacion(form.id, datos, original)
      } else {
        await agregarUbicacion({ ...form, offline: false })
      }

      setModalOpen(false)
      Swal.fire(avisoDeExito())
      setForm(emptyForm)
      setOriginal(null)
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo guardar", text: e.message })
    } finally {
      setGuardando(false)
    }
  }

  const save = async () => {
    const aviso = getLocationNameError(form.name)

    if (aviso) {
      Swal.fire({ icon: "warning", title: "Falta el nombre", text: aviso })
      return
    }

    // Quitar las ventas sin conexión pasa antes por la confirmación.
    if (cambiaSinConexion && !form.offline) {
      setConfirmandoDesactivar(true)
      return
    }

    await guardar()
  }

  /*
    No se borra, se apaga. Una ubicación que ya movió mercadería tiene que
    seguir existiendo para que su historial siga teniendo sentido.
  */
  const toggleActive = async (ubicacion) => {
    const desactivando = ubicacion.active

    if (desactivando) {
      const result = await Swal.fire({
        icon: "warning",
        title: `¿Desactivar "${ubicacion.name}"?`,
        text: "Dejará de estar disponible para nuevas operaciones. Su historial se conserva y puedes volver a activarla.",
        showCancelButton: true,
        confirmButtonText: "Sí, desactivar",
        cancelButtonText: "Cancelar",
      })

      if (!result.isConfirmed) return
    }

    try {
      await cambiarEstado(ubicacion.id, !ubicacion.active)
      Swal.fire({ icon: "success", title: desactivando ? "Ubicación desactivada" : "Ubicación activada" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo cambiar el estado", text: e.message })
    }
  }

  return (
    <div className="view active crud">
      <PageHeader descripcion="Bodegas, tiendas y camiones donde LUNACELL guarda y mueve mercadería.">
        <button className="btn btn-primary" onClick={openNew}><FaPlus aria-hidden="true" />Nueva ubicación</button>
      </PageHeader>

      {cargando && <p className="crud-cargando" role="status">Cargando ubicaciones…</p>}

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar ubicación o tipo..."
          etiqueta="Buscar por ubicación o tipo"
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Ubicación</th>
              <th scope="col">Tipo</th>
              <th scope="col">Estado</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td><span className="product-name">{u.name}</span></td>
                <td>
                  <StatusBadge variante="neutral" Icono={ICONO_POR_TIPO[u.type] || FaMapMarkerAlt}>
                    {getLocationTypeLabel(u.type)}
                  </StatusBadge>
                </td>
                <td>
                  <StatusBadge variante={u.active ? "ok" : "out"}>
                    {u.active ? "Activa" : "Inactiva"}
                  </StatusBadge>
                  {u.offline && (
                    <>
                      {" "}
                      <StatusBadge variante="neutral" Icono={FaWifi}>Vende sin conexión</StatusBadge>
                    </>
                  )}
                </td>
                <td><div className="row-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(u)}><FaPen aria-hidden="true" />Editar</button>
                  <button
                    className={`btn btn-sm ${u.active ? "btn-danger" : "btn-primary"}`}
                    onClick={() => toggleActive(u)}
                  >
                    <FaPowerOff aria-hidden="true" />{u.active ? "Desactivar" : "Activar"}
                  </button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (locations.length ? (
          <EmptyState
            Icono={FaSearch}
            titulo="No se encontraron resultados"
            descripcion="Prueba con otro nombre o tipo de ubicación."
          />
        ) : (
          <EmptyState
            Icono={FaBoxOpen}
            titulo="No hay ubicaciones todavía"
            descripcion="Usa «Nueva ubicación» para registrar la primera."
          />
        ))}
      </div>

      {inactivas > 0 && <p className="crud-nota">{inactivas} ubicación{inactivas !== 1 ? "es" : ""} inactiva{inactivas !== 1 ? "s" : ""}. Siguen apareciendo en la lista porque conservan su historial.</p>}

      {modalOpen && confirmandoDesactivar && (
        <DesactivarSinConexion
          ubicacion={original}
          onCancelar={() => setConfirmandoDesactivar(false)}
          onConfirmar={() => {
            setConfirmandoDesactivar(false)
            void guardar()
          }}
        />
      )}

      {modalOpen && !confirmandoDesactivar && (
        <ModalShell
          titulo={form.id ? "Editar ubicación" : "Nueva ubicación"}
          onCerrar={closeModal}
          cerrarAlPulsarFuera
          acciones={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar ubicación"}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <FormField etiqueta="Nombre" ancho="full">
              <input id="locations-nombre" value={form.name} placeholder="Ej. Bodega Principal" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </FormField>

            <FormField
              etiqueta="Tipo"
              ancho="full"
              ayuda="Determina con qué icono aparece la ubicación en el listado."
            >
              <select id="locations-tipo" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {tiposDisponibles.map((opcion) => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}
              </select>
            </FormField>
            {form.id && (
              <div className="config-casilla field full">
                <label htmlFor="locations-sin-conexion">
                  <input
                    id="locations-sin-conexion"
                    type="checkbox"
                    checked={Boolean(form.offline)}
                    disabled={!sinConexionEditable}
                    onChange={(e) => setForm({ ...form, offline: e.target.checked })}
                    aria-describedby="locations-sin-conexion-ayuda"
                  />
                  <strong>Permitir ventas sin conexión</strong>
                </label>
                <p className="config-descripcion" id="locations-sin-conexion-ayuda">
                  {ayudaSinConexion(form.type, isAdmin)}
                </p>
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  )
}

export default Locations
