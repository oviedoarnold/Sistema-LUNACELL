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
} from "react-icons/fa"
import Swal from "sweetalert2"

import { LocationsContext } from "../context/contexts"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import StatusBadge from "../components/crud/StatusBadge"

import {
  DEFAULT_LOCATION_TYPE,
  LOCATION_TYPE_OPTIONS,
  filterLocationsBySearchText,
  getLocationNameError,
  getLocationTypeLabel,
} from "../utils/locations"

const emptyForm = { id: null, name: "", type: DEFAULT_LOCATION_TYPE }

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

  const [search, setSearch] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [guardando, setGuardando] = useState(false)

  const filtered = useMemo(
    () => filterLocationsBySearchText(locations, search),
    [locations, search]
  )

  const inactivas = locations.filter((ubicacion) => !ubicacion.active).length

  const openNew = () => { setForm(emptyForm); setModalOpen(true) }
  const openEdit = (ubicacion) => { setForm({ ...emptyForm, ...ubicacion }); setModalOpen(true) }
  const closeModal = () => setModalOpen(false)

  const save = async () => {
    const aviso = getLocationNameError(form.name)

    if (aviso) {
      Swal.fire({ icon: "warning", title: "Falta el nombre", text: aviso })
      return
    }

    setGuardando(true)
    try {
      if (form.id) await editarUbicacion(form.id, form)
      else await agregarUbicacion(form)

      setModalOpen(false)
      setForm(emptyForm)
      Swal.fire({ icon: "success", title: form.id ? "Ubicación actualizada" : "Ubicación agregada" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo guardar", text: e.message })
    } finally {
      setGuardando(false)
    }
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

      {modalOpen && <div className="modal-overlay open" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
        <div className="modal">
          <div className="modal-head"><h3>{form.id ? "Editar ubicación" : "Nueva ubicación"}</h3><button className="icon-btn" aria-label="Cerrar" onClick={closeModal}>✕</button></div>
          <div className="modal-body"><div className="form-grid">
            <div className="field full"><label htmlFor="locations-nombre">Nombre</label><input id="locations-nombre" value={form.name} placeholder="Ej. Bodega Principal" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field full"><label htmlFor="locations-tipo">Tipo</label>
              <select id="locations-tipo" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {LOCATION_TYPE_OPTIONS.map((opcion) => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}
              </select>
            </div>
          </div></div>
          <div className="modal-foot"><button className="btn btn-primary" onClick={save} disabled={guardando}>{guardando ? "Guardando…" : "Guardar ubicación"}</button><button className="btn btn-secondary" onClick={closeModal}>Cancelar</button></div>
        </div>
      </div>}
    </div>
  )
}

export default Locations
