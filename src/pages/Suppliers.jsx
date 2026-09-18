import { useContext, useMemo, useState } from "react"
import { FaPen, FaPlus, FaSearch, FaTrash, FaTruck } from "react-icons/fa"
import Swal from "sweetalert2"

import { ProductContext } from "../context/contexts"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import { coincideBusqueda } from "../utils/texto"
import FormField from "../components/forms/FormField"
import ModalShell from "../components/forms/ModalShell"

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
    return suppliers.filter((s) => coincideBusqueda(`${s.name} ${s.contact || ""}`, search))
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

  return (
    <div className="view active crud">
      <PageHeader descripcion="Contactos de quienes te abastecen.">
        <button className="btn btn-primary" onClick={openNew}><FaPlus aria-hidden="true" />Nuevo proveedor</button>
      </PageHeader>

      {cargando && <p className="crud-cargando" role="status">Cargando proveedores…</p>}

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar proveedor..."
          etiqueta="Buscar por proveedor o contacto"
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Proveedor</th>
              <th scope="col">Contacto</th>
              <th scope="col">Teléfono</th>
              <th scope="col">Suministra</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td><span className="product-name">{s.name}</span>{s.email && <span className="product-cat">{s.email}</span>}</td>
                <td>{s.contact || "—"}</td>
                <td><span className="celda-codigo">{s.phone || "—"}</span></td>
                <td className="celda-secundaria">{s.notes || "—"}</td>
                <td><div className="row-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}><FaPen aria-hidden="true" />Editar</button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(s.id)}><FaTrash aria-hidden="true" />Eliminar</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (suppliers.length ? (
          <EmptyState
            Icono={FaSearch}
            titulo="No se encontraron resultados"
            descripcion="Prueba con otro proveedor o contacto."
          />
        ) : (
          <EmptyState
            Icono={FaTruck}
            titulo="No hay proveedores todavía"
            descripcion="Usa «Nuevo proveedor» para registrar el primero."
          />
        ))}
      </div>

      {modalOpen && (
        <ModalShell
          titulo={form.id ? "Editar proveedor" : "Nuevo proveedor"}
          onCerrar={() => setModalOpen(false)}
          acciones={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar proveedor"}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <FormField etiqueta="Proveedor" ancho="full">
              <input id="suppliers-proveedor" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </FormField>

            <FormField etiqueta="Contacto">
              <input id="suppliers-contacto" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </FormField>

            <FormField etiqueta="Teléfono">
              <input id="suppliers-telefono" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </FormField>

            <FormField etiqueta="Correo" ancho="full">
              <input id="suppliers-correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </FormField>

            <FormField
              etiqueta="Suministra / Notas"
              ancho="full"
              ayuda="Qué productos entrega o cualquier detalle que convenga recordar."
            >
              <textarea id="suppliers-suministra-notas" rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </FormField>
          </div>
        </ModalShell>
      )}
    </div>
  )
}

export default Suppliers
