import { useContext, useMemo, useState } from "react"
import {
  FaBoxOpen,
  FaExclamationTriangle,
  FaPen,
  FaPlus,
  FaSearch,
  FaTrash,
} from "react-icons/fa"
import Swal from "sweetalert2"
import { ProductContext } from "../context/contexts"
import {
  MiniaturaDeProducto,
  SelectorDeImagen,
} from "../components/ImagenDeProducto"
import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import StatusBadge from "../components/crud/StatusBadge"
import { coincideBusqueda } from "../utils/texto"
import FormField from "../components/forms/FormField"
import ModalShell from "../components/forms/ModalShell"

const emptyForm = { id: null, code: "", name: "", category: "", price: "", costPrice: "", stock: "", minStock: 5, supplierId: "", imageUrl: "" }

function Products() {
  const {
    products = [],
    suppliers = [],
    cargando,
    agregarProducto,
    editarProducto,
    quitarProducto,
  } = useContext(ProductContext)

  const [search, setSearch] = useState("")
  const [form, setForm] = useState(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [guardando, setGuardando] = useState(false)

  // La imagen elegida se sube al guardar, no al seleccionarla: cancelar el
  // formulario no debe dejar archivos sueltos en el almacenamiento.
  const [imagenElegida, setImagenElegida] = useState(null)

  const filtered = useMemo(() => {
    return products.filter((p) => [p.name, p.category, p.code].some((v) => coincideBusqueda(v, search)))
  }, [products, search])

  const lowProducts = products.filter((p) => Number(p.stock) <= Number(p.minStock ?? 5))
  const outCount = products.filter((p) => Number(p.stock) <= 0).length

  /*
    El estado sale del stock que ya trae el producto; la variante es solo
    el nombre del color con el que se pinta.
  */
  const status = (p) => Number(p.stock) <= 0 ? ["Agotado", "out"] : Number(p.stock) <= Number(p.minStock ?? 5) ? ["Stock bajo", "low"] : ["Disponible", "ok"]
  const openNew = () => { setForm(emptyForm); setImagenElegida(null); setModalOpen(true) }
  const openEdit = (p) => { setForm({ ...emptyForm, ...p }); setImagenElegida(null); setModalOpen(true) }
  const cerrarModal = () => { setModalOpen(false); setImagenElegida(null) }

  const save = async () => {
    const code = form.code.trim()
    if (!code || !form.name.trim() || !form.category.trim()) { Swal.fire({ icon: "warning", title: "Faltan datos", text: "Código, nombre y categoría son obligatorios" }); return }
    if (products.some((p) => String(p.code || "").toLowerCase() === code.toLowerCase() && p.id !== form.id)) { Swal.fire({ icon: "error", title: "Producto ya existente", text: `El código ${code} ya está registrado` }); return }
    if (Number(form.stock) < 0) { Swal.fire({ icon: "warning", title: "Stock inválido" }); return }
    const data = { ...form, code, name: form.name.trim(), category: form.category.trim(), price: Math.max(0, Number(form.price) || 0), costPrice: Math.max(0, Number(form.costPrice) || 0), stock: Math.max(0, Number.parseInt(form.stock || 0)), minStock: Math.max(0, Number.parseInt(form.minStock || 0)) }
    setGuardando(true)
    try {
      if (form.id) await editarProducto(form.id, data, imagenElegida)
      else await agregarProducto(data, imagenElegida)
      setModalOpen(false); setForm(emptyForm); setImagenElegida(null)
      Swal.fire({ icon: "success", title: form.id ? "Producto actualizado" : "Producto agregado" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo guardar", text: e.message })
    } finally {
      setGuardando(false)
    }
  }

  const remove = async (id) => {
    const p = products.find((x) => x.id === id)
    const r = await Swal.fire({ title: `¿Eliminar "${p?.name || "producto"}"?`, icon: "warning", showCancelButton: true, confirmButtonText: "Sí, eliminar", cancelButtonText: "Cancelar" })
    if (!r.isConfirmed) return
    try {
      await quitarProducto(id)
      Swal.fire({ icon: "success", title: "Producto eliminado" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo eliminar", text: e.message })
    }
  }

  return <div className="view active crud">
    <PageHeader descripcion="Controla tus productos, precios y existencias.">
      <button className="btn btn-primary" onClick={openNew}><FaPlus aria-hidden="true" />Nuevo producto</button>
    </PageHeader>

    {cargando && <p className="crud-cargando" role="status">Cargando inventario…</p>}

    {!!lowProducts.length && <div className="alert-banner">
      <FaExclamationTriangle aria-hidden="true" />

      <div>
        <strong>{lowProducts.length} producto{lowProducts.length !== 1 ? "s" : ""} con stock bajo{outCount ? ` (${outCount} agotado${outCount !== 1 ? "s" : ""})` : ""}</strong>

        <div className="chips">{lowProducts.map((p) => <span className="chip" key={p.id}>{p.name} · {p.stock}</span>)}</div>
      </div>
    </div>}

    <div className="toolbar">
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar producto, código o categoría..."
        etiqueta="Buscar en el inventario"
      />
    </div>

    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="celda-miniatura"></th>
            <th scope="col">Producto</th>
            <th scope="col">Código</th>
            <th scope="col" className="num">Precio</th>
            <th scope="col" className="num">Costo</th>
            <th scope="col" className="num">Stock</th>
            <th scope="col">Estado</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          {filtered.map((p) => {
            const [label, variante] = status(p)

            return <tr key={p.id}>
              <td className="celda-miniatura"><MiniaturaDeProducto url={p.imageUrl} nombre={p.name} /></td>
              <td><span className="product-name">{p.name}</span><span className="product-cat">{p.category}</span></td>
              <td><span className="celda-codigo">{p.code || "—"}</span></td>
              <td className="num">L {Number(p.price || 0).toFixed(2)}</td>
              <td className="num celda-secundaria">L {Number(p.costPrice || 0).toFixed(2)}</td>
              <td className="num">{p.stock} u.</td>
              <td><StatusBadge variante={variante}>{label}</StatusBadge></td>
              <td><div className="row-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}><FaPen aria-hidden="true" />Editar</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(p.id)}><FaTrash aria-hidden="true" />Eliminar</button>
              </div></td>
            </tr>
          })}
        </tbody>
      </table>

      {filtered.length === 0 && (products.length ? (
        <EmptyState
          Icono={FaSearch}
          titulo="No se encontraron resultados"
          descripcion="Prueba con otro nombre, código o categoría."
        />
      ) : (
        <EmptyState
          Icono={FaBoxOpen}
          titulo="No hay productos todavía"
          descripcion="Usa «Nuevo producto» para registrar el primero."
        />
      ))}
    </div>

    {modalOpen && (
      <ModalShell
        titulo={form.id ? "Editar producto" : "Nuevo producto"}
        onCerrar={cerrarModal}
        ancho="modal-wide"
        acciones={
          <>
            <button type="button" className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar producto"}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <FormField etiqueta="Código">
            <input id="products-codigo" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Ej. CEM-001" />
          </FormField>

          <FormField etiqueta="Nombre">
            <input id="products-nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>

          <FormField etiqueta="Categoría" ancho="full">
            <input id="products-categoria" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </FormField>

          <FormField etiqueta="Precio de venta">
            <input id="products-precio-de-venta" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </FormField>

          <FormField etiqueta="Costo">
            <input id="products-costo" type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} />
          </FormField>

          <FormField etiqueta="Stock">
            <input id="products-stock" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          </FormField>

          <FormField etiqueta="Stock mínimo" ayuda="Por debajo de esta cantidad el producto se marca como escaso.">
            <input id="products-stock-minimo" type="number" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
          </FormField>

          <FormField etiqueta="Proveedor" ancho="full">
            <select id="products-proveedor" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">— Sin proveedor —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </FormField>

          {/*
            El selector de imagen trae su propio control de archivo con el
            id que esperan las pruebas, así que aquí solo se le pone
            etiqueta y se deja el flujo de subida como estaba.
          */}
          <div className="field full">
            <label htmlFor="products-imagen">Imagen del producto</label>

            <SelectorDeImagen
              urlGuardada={form.imageUrl}
              archivo={imagenElegida}
              nombre={form.name}
              onElegir={setImagenElegida}
              onQuitar={() => { setImagenElegida(null); setForm((actual) => ({ ...actual, imageUrl: "" })) }}
            />
          </div>
        </div>
      </ModalShell>
    )}
  </div>
}

export default Products
