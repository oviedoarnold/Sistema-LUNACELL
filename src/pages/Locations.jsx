import { useContext, useMemo, useState } from "react"
import Swal from "sweetalert2"

import { LocationsContext } from "../context/contexts"

import {
  DEFAULT_LOCATION_TYPE,
  LOCATION_TYPE_OPTIONS,
  filterLocationsBySearchText,
  getLocationNameError,
  getLocationTypeLabel,
} from "../utils/locations"

const emptyForm = { id: null, name: "", type: DEFAULT_LOCATION_TYPE }

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
    <div className="view active">
      <div className="view-header">
        <div><h2>Ubicaciones</h2><p className="sub">Bodegas, tiendas y camiones donde LUNACELL guarda y mueve mercadería</p></div>
        <button className="btn btn-primary btn-lg" onClick={openNew}>+ Nueva ubicación</button>
      </div>
      {cargando && <div className="empty-state">Cargando ubicaciones…</div>}

      <div className="toolbar">
        <div className="search-box"><span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>⌕</span><input placeholder="Buscar ubicación o tipo..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Ubicación</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td><span className="product-name">{u.name}</span></td>
                <td><span className="product-cat">{getLocationTypeLabel(u.type)}</span></td>
                <td>
                  <span className={`badge ${u.active ? "badge-ok" : "badge-out"}`}>
                    <span className="badge-dot" />{u.active ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td><div className="row-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(u)}>Editar</button>
                  <button
                    className={`btn btn-sm ${u.active ? "btn-danger" : "btn-primary"}`}
                    onClick={() => toggleActive(u)}
                  >
                    {u.active ? "Desactivar" : "Activar"}
                  </button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-state"><strong>{locations.length ? "No se encontraron resultados" : "No hay ubicaciones todavía"}</strong></div>}
      </div>

      {inactivas > 0 && <p className="sub">{inactivas} ubicación{inactivas !== 1 ? "es" : ""} inactiva{inactivas !== 1 ? "s" : ""}. Siguen apareciendo en la lista porque conservan su historial.</p>}

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
