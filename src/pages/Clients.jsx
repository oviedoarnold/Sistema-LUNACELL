import { useContext, useMemo, useState } from "react"
import { FaPen, FaPlus, FaSearch, FaUsers } from "react-icons/fa"
import Swal from "sweetalert2"
import { ClientsContext, ProductContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import { coincideBusqueda } from "../utils/texto"
import FormField from "../components/forms/FormField"
import ModalShell from "../components/forms/ModalShell"
import PreciosEspeciales from "../components/clients/PreciosEspeciales"
import { problemaDePrecios } from "../utils/preciosPorCliente"
import { guardarPreciosDeCliente, traerPreciosDeCliente } from "../lib/api/preciosPorCliente"

const emptyForm = { id: null, name: "", rtn: "", phone: "", address: "", email: "" }

function Clients() {
  const { clients = [], cargando, addClient, updateClient } = useContext(ClientsContext)

  // El contador consulta: sin alta ni edición (0036).
  const { soloLectura, isAdmin } = useAuth()
  const { products = [], company } = useContext(ProductContext) || {}
  const [search, setSearch] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [guardando, setGuardando] = useState(false)

  /*
    Lo que se leyó, para enviar la lista solo si cambió. Si no se pudo leer, no se
    envía: guardar una lista vacía borraría los precios que el cliente ya tiene.
  */
  const [precios, setPrecios] = useState({ filas: [], leidas: [], cargando: false, fallo: false })

  const filteredClients = useMemo(() => {
    return clients.filter((c) => [c.name, c.rtn, c.phone, c.email].some((v) => coincideBusqueda(v, search)))
  }, [clients, search])

  const aFilas = (porProducto) =>
    Object.entries(porProducto).map(([productoId, precio]) => {
      const producto = products.find((p) => p.id === productoId)

      return {
        productoId,
        nombre: producto?.name || "Producto inactivo",
        codigo: producto?.code || "",
        precioGeneral: producto?.price ?? 0,
        precio: String(precio),
      }
    })

  const openNew = () => {
    setForm(emptyForm)
    setPrecios({ filas: [], leidas: [], cargando: false, fallo: false })
    setModalOpen(true)
  }

  const openEdit = async (client) => {
    setForm({ ...emptyForm, ...client })
    setPrecios({ filas: [], leidas: [], cargando: true, fallo: false })
    setModalOpen(true)

    try {
      const filas = aFilas(await traerPreciosDeCliente(client.id))

      setPrecios({ filas, leidas: filas, cargando: false, fallo: false })
    } catch {
      setPrecios({ filas: [], leidas: [], cargando: false, fallo: true })
    }
  }

  const huella = (filas) =>
    JSON.stringify(filas.map((f) => [f.productoId, Number(f.precio)]).sort(([a], [b]) => String(a).localeCompare(String(b))))

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) {
      Swal.fire({ icon: "warning", title: "Faltan datos", text: "Nombre, teléfono y dirección son obligatorios" })
      return
    }

    const conPrecios = isAdmin && !precios.cargando && !precios.fallo
    const problema = conPrecios ? problemaDePrecios(precios.filas) : null

    if (problema) {
      Swal.fire({ icon: "warning", title: "Revisa los precios", text: problema })
      return
    }

    setGuardando(true)
    try {
      let clienteId = form.id

      if (form.id) await updateClient(form.id, form)
      else clienteId = (await addClient(form))?.id

      // Si los precios fallan, el cliente ya existe: el siguiente intento lo edita.
      setForm((actual) => ({ ...actual, id: clienteId }))

      if (conPrecios && clienteId && huella(precios.filas) !== huella(precios.leidas)) {
        await guardarPreciosDeCliente(clienteId, precios.filas)
      }

      setModalOpen(false)
      setForm(emptyForm)
      Swal.fire({ icon: "success", title: form.id ? "Cliente actualizado" : "Cliente agregado" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo guardar", text: e.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="view active crud">
      <PageHeader descripcion="Gestiona tus clientes y su información de contacto.">
        {!soloLectura && <button className="btn btn-primary" onClick={openNew}><FaPlus aria-hidden="true" />Nuevo cliente</button>}
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
                  {!soloLectura && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}><FaPen aria-hidden="true" />Editar</button>}
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

          {(isAdmin || form.id) && (
            <PreciosEspeciales
              filas={precios.filas}
              onCambiar={(filas) => setPrecios((actual) => ({ ...actual, filas }))}
              productos={products}
              editable={isAdmin}
              cargando={precios.cargando}
              fallo={precios.fallo}
              moneda={company?.currency}
            />
          )}
        </ModalShell>
      )}
    </div>
  )
}

export default Clients
