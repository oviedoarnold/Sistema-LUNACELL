import { useContext, useMemo, useState } from "react"
import Swal from "sweetalert2"

import { ProductContext } from "../context/contexts"

const emptyForm = { id: null, name: "", contact: "", phone: "", email: "", notes: "" }

function Suppliers() {
  /*
    Antes esta pantalla guardaba su propia copia y avisaba al inventario
    con un evento del DOM. Ahora ambas leen la misma fuente.
  */
  const {
    suppliers = [],
    cargando,
    agregarProveedor,
    editarProveedor,
    quitarProveedor,
  } = useContext(ProductContext)

  const [search, setSearch] = useState("")
  const [form, setForm] = useState(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return suppliers.filter((s) => `${s.name} ${s.contact || ""}`.toLowerCase().includes(q))
  }, [suppliers, search])

  const openNew = () => { setForm(emptyForm); setModalOpen(true) }
  const openEdit = (s) => { setForm({ ...emptyForm, ...s }); setModalOpen(true) }

  const save = async () => {
    if (!form.name.trim()) { Swal.fire({ icon: "warning", title: "Nombre requerido" }); return }

    setGuardando(true)
    try {
      if (form.id) await editarProveedor(form.id, form)
      else await agregarProveedor(form)

      setModalOpen(false); setForm(emptyForm)
      Swal.fire({ icon: "success", title: form.id ? "Proveedor actualizado" : "Proveedor agregado" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo guardar", text: e.message })
    } finally {
      setGuardando(false)
    }
  }

  const remove = async (id) => {
    const result = await Swal.fire({ title: "¿Eliminar proveedor?", icon: "warning", showCancelButton: true, confirmButtonText: "Sí, eliminar", cancelButtonText: "Cancelar" })
    if (!result.isConfirmed) return
    try {
      await quitarProveedor(id)
      Swal.fire({ icon: "success", title: "Proveedor eliminado" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo eliminar", text: e.message })
    }
  }

  return <div className="view active">
    <div className="view-header"><div><h2>Proveedores</h2><p className="sub">Contactos de quienes te abastecen</p></div><button className="btn btn-primary btn-lg" onClick={openNew}>+ Nuevo proveedor</button></div>
    {cargando && <div className="empty-state">Cargando proveedores…</div>}
    <div className="toolbar"><div className="search-box"><span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>⌕</span><input placeholder="Buscar proveedor..." value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
    <div className="table-wrap"><table><thead><tr><th>Proveedor</th><th>Contacto</th><th>Teléfono</th><th>Suministra</th><th></th></tr></thead><tbody>
      {filtered.map((s) => <tr key={s.id}><td><span className="product-name">{s.name}</span>{s.email && <span className="product-cat">{s.email}</span>}</td><td>{s.contact || "—"}</td><td>{s.phone || "—"}</td><td>{s.notes || "—"}</td><td><div className="row-actions"><button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>Editar</button><button className="btn btn-danger btn-sm" onClick={() => remove(s.id)}>Eliminar</button></div></td></tr>)}
    </tbody></table>{filtered.length === 0 && <div className="empty-state"><strong>{suppliers.length ? "No se encontraron resultados" : "No hay proveedores todavía"}</strong></div>}</div>

    {modalOpen && <div className="modal-overlay open"><div className="modal"><div className="modal-head"><h3>{form.id ? "Editar proveedor" : "Nuevo proveedor"}</h3><button className="icon-btn" aria-label="Cerrar" onClick={() => setModalOpen(false)}>✕</button></div><div className="modal-body"><div className="form-grid">
      <div className="field full"><label htmlFor="suppliers-proveedor">Proveedor</label><input id="suppliers-proveedor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="suppliers-contacto">Contacto</label><input id="suppliers-contacto" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
      <div className="field"><label htmlFor="suppliers-telefono">Teléfono</label><input id="suppliers-telefono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
      <div className="field full"><label htmlFor="suppliers-correo">Correo</label><input id="suppliers-correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <div className="field full"><label htmlFor="suppliers-suministra-notas">Suministra / Notas</label><textarea id="suppliers-suministra-notas" rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
    </div></div><div className="modal-foot"><button className="btn btn-primary" onClick={save} disabled={guardando}>Guardar proveedor</button><button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button></div></div></div>}
  </div>
}

export default Suppliers
