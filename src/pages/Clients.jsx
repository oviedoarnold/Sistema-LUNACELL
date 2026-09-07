import { useContext, useMemo, useState } from "react"
import Swal from "sweetalert2"
import { ClientsContext } from "../context/contexts"

const emptyForm = { id: null, name: "", rtn: "", phone: "", address: "", email: "" }

function Clients() {
  const { clients = [], cargando, addClient, updateClient, deleteClient } = useContext(ClientsContext)
  const [search, setSearch] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [guardando, setGuardando] = useState(false)

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients.filter((c) => [c.name, c.rtn, c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q)))
  }, [clients, search])

  const openNew = () => { setForm(emptyForm); setModalOpen(true) }
  const openEdit = (client) => { setForm({ ...emptyForm, ...client }); setModalOpen(true) }

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) {
      Swal.fire({ icon: "warning", title: "Faltan datos", text: "Nombre, teléfono y dirección son obligatorios" })
      return
    }

    setGuardando(true)
    try {
      if (form.id) await updateClient(form.id, form)
      else await addClient(form)

      setModalOpen(false)
      setForm(emptyForm)
      Swal.fire({ icon: "success", title: form.id ? "Cliente actualizado" : "Cliente agregado" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo guardar", text: e.message })
    } finally {
      setGuardando(false)
    }
  }

  const remove = async (id) => {
    const result = await Swal.fire({ title: "¿Eliminar cliente?", text: "Esta acción no se puede deshacer", icon: "warning", showCancelButton: true, confirmButtonText: "Sí, eliminar", cancelButtonText: "Cancelar" })
    if (!result.isConfirmed) return

    try {
      await deleteClient(id)
      Swal.fire({ icon: "success", title: "Cliente eliminado" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo eliminar", text: e.message })
    }
  }

  return (
    <div className="view active">
      <div className="view-header">
        <div><h2>Clientes</h2><p className="sub">Gestiona tus clientes y su información de contacto</p></div>
        <button className="btn btn-primary btn-lg" onClick={openNew}>+ Nuevo cliente</button>
      </div>
      {cargando && <div className="empty-state">Cargando clientes…</div>}

      <div className="toolbar">
        <div className="search-box"><span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>⌕</span><input placeholder="Buscar cliente..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>RTN</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
          <tbody>
            {filteredClients.map((c) => (
              <tr key={c.id}>
                <td><span className="product-name">{c.name}</span><span className="product-cat">{c.address || "—"}</span></td>
                <td>{c.rtn || "—"}</td><td>{c.phone || "—"}</td><td>{c.email || "—"}</td>
                <td><div className="row-actions"><button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Editar</button><button className="btn btn-danger btn-sm" onClick={() => remove(c.id)}>Eliminar</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredClients.length === 0 && <div className="empty-state"><strong>{clients.length ? "No se encontraron resultados" : "No hay clientes todavía"}</strong></div>}
      </div>

      {modalOpen && <div className="modal-overlay open" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
        <div className="modal">
          <div className="modal-head"><h3>{form.id ? "Editar cliente" : "Nuevo cliente"}</h3><button className="icon-btn" aria-label="Cerrar" onClick={() => setModalOpen(false)}>✕</button></div>
          <div className="modal-body"><div className="form-grid">
            <div className="field"><label htmlFor="clients-nombre">Nombre</label><input id="clients-nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="clients-rtn-opcional">RTN (opcional)</label><input id="clients-rtn-opcional" value={form.rtn} onChange={(e) => setForm({ ...form, rtn: e.target.value })} /></div>
            <div className="field"><label htmlFor="clients-telefono">Teléfono</label><input id="clients-telefono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label htmlFor="clients-correo">Correo</label><input id="clients-correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field full"><label htmlFor="clients-direccion">Dirección</label><input id="clients-direccion" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          </div></div>
          <div className="modal-foot"><button className="btn btn-primary" onClick={save} disabled={guardando}>Guardar cliente</button><button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button></div>
        </div>
      </div>}
    </div>
  )
}

export default Clients
