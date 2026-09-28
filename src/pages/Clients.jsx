import { useContext, useMemo, useState } from "react"
import { FaPen, FaPlus, FaSearch, FaTrash, FaUsers } from "react-icons/fa"
import Swal from "sweetalert2"
import { ClientsContext } from "../context/contexts"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import { coincideBusqueda } from "../utils/texto"
import FormField from "../components/forms/FormField"
import ModalShell from "../components/forms/ModalShell"

const emptyForm = { id: null, name: "", rtn: "", phone: "", address: "", email: "" }

function Clients() {
  const { clients = [], cargando, addClient, updateClient, deleteClient } = useContext(ClientsContext)
  const [search, setSearch] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [guardando, setGuardando] = useState(false)

  const filteredClients = useMemo(() => {
    return clients.filter((c) => [c.name, c.rtn, c.phone, c.email].some((v) => coincideBusqueda(v, search)))
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
    <div className="view active crud">
      <PageHeader descripcion="Gestiona tus clientes y su información de contacto.">
        <button className="btn btn-primary" onClick={openNew}><FaPlus aria-hidden="true" />Nuevo cliente</button>
      </PageHeader>

      {cargando && <p className="crud-cargando" role="status">Cargando clientes…</p>}

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente..."
          etiqueta="Buscar por nombre, RTN, teléfono o correo"
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">RTN</th>
              <th scope="col">Teléfono</th>
              <th scope="col">Correo</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {filteredClients.map((c) => (
              <tr key={c.id}>
                <td><span className="product-name">{c.name}</span><span className="product-cat">{c.address || "—"}</span></td>
                <td><span className="celda-codigo">{c.rtn || "—"}</span></td>
                <td><span className="celda-codigo">{c.phone || "—"}</span></td>
                <td className="celda-secundaria">{c.email || "—"}</td>
                <td><div className="row-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}><FaPen aria-hidden="true" />Editar</button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(c.id)}><FaTrash aria-hidden="true" />Eliminar</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredClients.length === 0 && (clients.length ? (
          <EmptyState
            Icono={FaSearch}
            titulo="No se encontraron resultados"
            descripcion="Prueba con otro nombre, RTN, teléfono o correo."
          />
        ) : (
          <EmptyState
            Icono={FaUsers}
            titulo="No hay clientes todavía"
            descripcion="Usa «Nuevo cliente» para registrar el primero."
          />
        ))}
      </div>

      {modalOpen && (
        <ModalShell
          titulo={form.id ? "Editar cliente" : "Nuevo cliente"}
          onCerrar={() => setModalOpen(false)}
          cerrarAlPulsarFuera
          acciones={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar cliente"}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <FormField etiqueta="Nombre">
              <input id="clients-nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </FormField>

            <FormField etiqueta="RTN (opcional)">
              <input id="clients-rtn-opcional" value={form.rtn} onChange={(e) => setForm({ ...form, rtn: e.target.value })} />
            </FormField>

            <FormField etiqueta="Teléfono">
              <input id="clients-telefono" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </FormField>

            <FormField etiqueta="Correo">
              <input id="clients-correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </FormField>

            <FormField etiqueta="Dirección" ancho="full">
              <input id="clients-direccion" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </FormField>
          </div>
        </ModalShell>
      )}
    </div>
  )
}

export default Clients
