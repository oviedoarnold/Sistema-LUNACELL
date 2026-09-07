import { useContext, useMemo, useState } from "react"
import Swal from "sweetalert2"
import { ProductContext } from "../context/contexts"
import {
  MiniaturaDeProducto,
  SelectorDeImagen,
} from "../components/ImagenDeProducto"

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
    const q = search.trim().toLowerCase()
    return products.filter((p) => [p.name, p.category, p.code].some((v) => String(v || "").toLowerCase().includes(q)))
  }, [products, search])

  const lowProducts = products.filter((p) => Number(p.stock) <= Number(p.minStock ?? 5))
  const outCount = products.filter((p) => Number(p.stock) <= 0).length

  const status = (p) => Number(p.stock) <= 0 ? ["Agotado", "badge-out"] : Number(p.stock) <= Number(p.minStock ?? 5) ? ["Stock bajo", "badge-low"] : ["Disponible", "badge-ok"]
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

  return <div className="view active">
    <div className="view-header"><div><h2>Inventario</h2><p className="sub">Controla tus productos, precios y existencias</p></div><button className="btn btn-primary btn-lg" onClick={openNew}>+ Nuevo producto</button></div>
    {cargando && <div className="empty-state">Cargando inventario…</div>}
    {!!lowProducts.length && <div className="alert-banner"><span>⚠</span><div><strong>{lowProducts.length} producto{lowProducts.length !== 1 ? "s" : ""} con stock bajo{outCount ? ` (${outCount} agotado${outCount !== 1 ? "s" : ""})` : ""}</strong><div className="chips">{lowProducts.map((p) => <span className="chip" key={p.id}>{p.name} · {p.stock}</span>)}</div></div></div>}
    <div className="toolbar"><div className="search-box"><span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>⌕</span><input placeholder="Buscar producto, código o categoría..." value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
    <div className="table-wrap"><table><thead><tr><th className="celda-miniatura"></th><th>Código</th><th>Producto</th><th className="num">Precio</th><th className="num">Costo</th><th className="num">Stock</th><th>Estado</th><th></th></tr></thead><tbody>
      {filtered.map((p) => { const [label, cls] = status(p); return <tr key={p.id}><td className="celda-miniatura"><MiniaturaDeProducto url={p.imageUrl} nombre={p.name} /></td><td><span className="product-cat" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{p.code || "—"}</span></td><td><span className="product-name">{p.name}</span><span className="product-cat">{p.category}</span></td><td className="num">L {Number(p.price || 0).toFixed(2)}</td><td className="num"><span style={{ fontSize: 12.5, color: "var(--steel)" }}>L {Number(p.costPrice || 0).toFixed(2)}</span></td><td className="num">{p.stock} u.</td><td><span className={`badge ${cls}`}><span className="badge-dot"></span>{label}</span></td><td><div className="row-actions"><button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>Editar</button><button className="btn btn-danger btn-sm" onClick={() => remove(p.id)}>Eliminar</button></div></td></tr> })}
    </tbody></table>{filtered.length === 0 && <div className="empty-state"><strong>{products.length ? "No se encontraron resultados" : "No hay productos todavía"}</strong></div>}</div>

    {modalOpen && <div className="modal-overlay open"><div className="modal"><div className="modal-head"><h3>{form.id ? "Editar producto" : "Nuevo producto"}</h3><button className="icon-btn" aria-label="Cerrar" onClick={cerrarModal}>✕</button></div><div className="modal-body"><div className="form-grid">
      <div className="field"><label htmlFor="products-codigo">Código</label><input id="products-codigo" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Ej. CEM-001" /></div>
      <div className="field"><label htmlFor="products-nombre">Nombre</label><input id="products-nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="field full"><label htmlFor="products-categoria">Categoría</label><input id="products-categoria" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
      <div className="field"><label htmlFor="products-precio-de-venta">Precio de venta</label><input id="products-precio-de-venta" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
      <div className="field"><label htmlFor="products-costo">Costo</label><input id="products-costo" type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></div>
      <div className="field"><label htmlFor="products-stock">Stock</label><input id="products-stock" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></div>
      <div className="field"><label htmlFor="products-stock-minimo">Stock mínimo</label><input id="products-stock-minimo" type="number" min="0" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></div>
      <div className="field full"><label htmlFor="products-proveedor">Proveedor</label><select id="products-proveedor" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}><option value="">— Sin proveedor —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="field full"><label htmlFor="products-imagen">Imagen del producto</label>
        <SelectorDeImagen
          urlGuardada={form.imageUrl}
          archivo={imagenElegida}
          nombre={form.name}
          onElegir={setImagenElegida}
          onQuitar={() => { setImagenElegida(null); setForm((actual) => ({ ...actual, imageUrl: "" })) }}
        />
      </div>
    </div></div><div className="modal-foot"><button className="btn btn-primary" onClick={save} disabled={guardando}>{guardando ? "Guardando…" : "Guardar producto"}</button><button className="btn btn-secondary" onClick={cerrarModal}>Cancelar</button></div></div></div>}
  </div>
}

export default Products
