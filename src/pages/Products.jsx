import { useContext, useMemo, useRef, useState } from "react"
import {
  FaBoxOpen,
  FaExclamationTriangle,
  FaPen,
  FaPlus,
  FaSearch,
  FaTrash,
} from "react-icons/fa"
import Swal from "sweetalert2"
import { LocationsContext, ProductContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"
import { useExistencias } from "../hooks/useExistencias"
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

  /*
    El estado se pinta en el siguiente render; dos clics dentro del mismo
    turno verían los dos `guardando` en falso. La referencia se apaga y se
    enciende en el acto, y es la que impide registrar la misma entrada dos
    veces.
  */
  const enviando = useRef(false)

  const { user } = useAuth()
  const { ubicacionesActivas = [] } = useContext(LocationsContext)

  /*
    La existencia se carga y se corrige en UNA ubicación, no en el total.
    La de la ubicación elegida es la referencia del ajuste: el formulario
    la muestra para que quede claro qué número se está cambiando.
  */
  const {
    existencias,
    cargando: cargandoExistencias,
    recargar: recargarExistencias,
  } = useExistencias()

  const [ubicacionId, setUbicacionId] = useState("")

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
  // La ubicación operativa del usuario, si sigue activa; si no, que elija.
  const ubicacionPorOmision = () =>
    ubicacionesActivas.some((u) => u.id === user?.locationId) ? user.locationId : ""

  const ubicacionElegida = ubicacionesActivas.find((u) => u.id === ubicacionId)

  /*
    Cuánto hay de este producto en la ubicación elegida. Null cuando no se
    sabe: todavía cargando, o una ubicación que este usuario no puede
    consultar. Sin referencia no se ofrece ajustar, porque la diferencia
    se calcularía contra un número inventado.
  */
  const referencia = useMemo(() => {
    if (!form.id || !ubicacionId) return null

    const fila = existencias.find(
      (e) => String(e.productId) === String(form.id) && e.locationId === ubicacionId
    )

    return fila ? fila.quantity : null
  }, [existencias, form.id, ubicacionId])

  const openNew = () => { setForm(emptyForm); setUbicacionId(ubicacionPorOmision()); setImagenElegida(null); setModalOpen(true) }

  /*
    Al editar, el campo de existencia arranca vacío: vacío es «no cambiar».
    No se precarga con el total, que es justo el número que no se corrige
    aquí, y se pide la existencia fresca porque desde la última carga pudo
    haber ventas.
  */
  const openEdit = (p) => {
    setForm({ ...emptyForm, ...p, stock: "" })
    setUbicacionId(ubicacionPorOmision())
    setImagenElegida(null)
    setModalOpen(true)
    recargarExistencias()
  }

  const cerrarModal = () => { setModalOpen(false); setImagenElegida(null) }

  // Otra ubicación es otra referencia: lo escrito para la anterior no vale.
  const cambiarUbicacion = (e) => {
    setUbicacionId(e.target.value)
    if (form.id) setForm((actual) => ({ ...actual, stock: "" }))
  }

  const save = async () => {
    if (enviando.current) return
    const code = form.code.trim()
    if (!code || !form.name.trim() || !form.category.trim()) { Swal.fire({ icon: "warning", title: "Faltan datos", text: "Código, nombre y categoría son obligatorios" }); return }
    if (products.some((p) => String(p.code || "").toLowerCase() === code.toLowerCase() && p.id !== form.id)) { Swal.fire({ icon: "error", title: "Producto ya existente", text: `El código ${code} ya está registrado` }); return }
    if (Number(form.stock) < 0) { Swal.fire({ icon: "warning", title: "Stock inválido" }); return }

    const existencia = Math.max(0, Number.parseInt(form.stock || 0))
    const cambiaExistencia = form.id ? String(form.stock).trim() !== "" : existencia > 0

    if (cambiaExistencia && !ubicacionId) { Swal.fire({ icon: "warning", title: "Falta la ubicación", text: "Elige en qué ubicación se registra la existencia." }); return }
    if (form.id && cambiaExistencia && referencia === null) { Swal.fire({ icon: "warning", title: "Sin existencia de referencia", text: "No se pudo leer la existencia de esa ubicación, así que no se puede ajustar desde aquí." }); return }

    const data = { ...form, code, name: form.name.trim(), category: form.category.trim(), price: Math.max(0, Number(form.price) || 0), costPrice: Math.max(0, Number(form.costPrice) || 0), stock: existencia, minStock: Math.max(0, Number.parseInt(form.minStock || 0)) }

    enviando.current = true
    setGuardando(true)
    try {
      if (form.id) {
        await editarProducto(form.id, data, imagenElegida, cambiaExistencia ? { ubicacionId, existenciaAnterior: referencia } : {})
      } else {
        await agregarProducto(data, imagenElegida, { ubicacionId })
      }
      setModalOpen(false); setForm(emptyForm); setImagenElegida(null)
      recargarExistencias()
      Swal.fire({ icon: "success", title: form.id ? "Producto actualizado" : "Producto agregado" })
    } catch (e) {
      Swal.fire({ icon: "error", title: "No se pudo guardar", text: e.message })
    } finally {
      enviando.current = false
      setGuardando(false)
    }
  }

  /*
    Lo que se le dice al usuario bajo el campo de existencia. Al editar
    nombra la ubicación y el número de partida, y aparte el total, para que
    no se confunda uno con otro.
  */
  const nombreUbicacion = ubicacionElegida?.name || "la ubicación elegida"

  let ayudaExistencia = `Entra como existencia de ${nombreUbicacion}.`

  if (form.id) {
    if (!ubicacionId) ayudaExistencia = "Elige primero la ubicación que vas a ajustar."
    else if (referencia === null) ayudaExistencia = cargandoExistencias ? "Cargando la existencia de esta ubicación…" : `No se puede leer la existencia de ${nombreUbicacion}, así que no se puede ajustar desde aquí.`
    else ayudaExistencia = `Hoy hay ${referencia} en ${nombreUbicacion} (${products.find((p) => p.id === form.id)?.stock ?? 0} en todas las ubicaciones). Déjalo vacío para no cambiarla; el cambio se registra como ajuste solo en ${nombreUbicacion}.`
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

          <FormField etiqueta={form.id ? "Ubicación del ajuste" : "Ubicación de la existencia"}>
            <select id="products-ubicacion" value={ubicacionId} onChange={cambiarUbicacion}>
              <option value="">— Elige una ubicación —</option>
              {ubicacionesActivas.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FormField>

          <FormField etiqueta={form.id ? "Nueva existencia en esta ubicación" : "Existencia inicial"} ayuda={ayudaExistencia}>
            <input
              id="products-stock"
              type="number"
              min="0"
              value={form.stock}
              placeholder={referencia === null ? "" : String(referencia)}
              disabled={Boolean(form.id) && referencia === null}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
            />
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
