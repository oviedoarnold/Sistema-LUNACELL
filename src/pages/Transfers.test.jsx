import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, act, waitFor, within } from "@testing-library/react"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import LocationsProvider from "../context/LocationsContext"
import { renderizarPantalla } from "../test/pantallas"
import { TAMANO_PAGINA } from "../lib/api/traslados"
import { fechaYHora } from "../utils/format"
import Transfers from "./Transfers"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  La pantalla de traslados. Quién puede trasladar desde dónde lo decide la
  base y se prueba contra PostgreSQL real en
  pruebas-sql/registrar-traslado.test.mjs; aquí se comprueba que la
  pantalla mande exactamente lo que el usuario eligió, no ofrezca lo que
  no puede pedir y muestre lo que la base respondió.
*/

const PRODUCTOS = [
  { id: "p1", code: "C-1", name: "Cargador", category: "Accesorios", price: 120, stock: 10, minStock: 1 },
  { id: "p2", code: "C-2", name: "Cubo Iphone", category: "Accesorios", price: 100, stock: 6, minStock: 1 },
]

const UBICACIONES = [
  { id: "bodega", name: "Lunacell Bodega", type: "bodega" },
  { id: "store", name: "Lunacell Store", type: "tienda" },
  { id: "camion1", name: "Camión 01", type: "camion" },
  { id: "retirado", name: "Camión retirado", type: "camion", active: false },
]

const EXISTENCIAS = [
  { locationId: "bodega", productId: "p1", quantity: 10 },
  { locationId: "bodega", productId: "p2", quantity: 6 },
  { locationId: "camion1", productId: "p1", quantity: 2 },
]

function renderTransfers(extra = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <LocationsProvider>
          <Transfers />
        </LocationsProvider>
      </ProductProvider>
    </AuthProvider>,
    {
      productos: PRODUCTOS,
      ubicaciones: UBICACIONES,
      existencias: EXISTENCIAS,
      esperar: ["productos_con_stock", "ubicaciones", "existencias_por_ubicacion", "traslados"],
      ...extra,
    }
  )
}

// El formulario vive en una ventana que se abre con «Nuevo traslado».
async function renderConFormulario(extra = {}) {
  const resultado = await renderTransfers(extra)

  fireEvent.click(screen.getByRole("button", { name: /^nuevo traslado$/i }))

  return resultado
}

const celdas = (fila) => within(fila).getAllByRole("cell").map((c) => c.textContent)

// La fila del historial que corresponde a una ruta, por el nombre de su botón de detalle.
const filaDeRuta = (ruta) =>
  screen.getByRole("button", { name: new RegExp(String.raw`^ver detalle del traslado TR-\d{6}, ${ruta}`, "i") }).closest("tr")

const elegir = (etiqueta, valor) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

const opciones = (etiqueta) =>
  within(screen.getByLabelText(etiqueta))
    .getAllByRole("option")
    .map((o) => o.textContent)

const trasladar = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^trasladar$/i }))
  })

const llamadas = (falso) =>
  falso.rpc.mock.calls.filter(([nombre]) => nombre === "registrar_traslado")

const llenarTraslado = ({ origen = "bodega", destino = "store", producto = "p1", cantidad = "3" } = {}) => {
  elegir(/^origen$/i, origen)
  elegir(/^destino$/i, destino)
  elegir(/producto del renglón 1/i, producto)
  elegir(/cantidad del renglón 1/i, cantidad)
}

describe("Traslados: lo que se ofrece", () => {
  it("el origen ofrece las ubicaciones activas y el destino excluye al origen", async () => {
    await renderConFormulario()

    expect(opciones(/^origen$/i)).not.toContain("Camión retirado")

    elegir(/^origen$/i, "bodega")

    const destinos = opciones(/^destino$/i)

    expect(destinos).toContain("Lunacell Store")
    expect(destinos).toContain("Camión 01")
    expect(destinos).not.toContain("Lunacell Bodega")
    expect(destinos).not.toContain("Camión retirado")
  })

  it("muestra cuánto hay del producto en el origen elegido", async () => {
    await renderConFormulario()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p2")

    expect(screen.getByText(/disponible en origen: 6/i)).toBeInTheDocument()
  })

  /*
    D1 y D3: con inventory-own solo se traslada desde la ubicación propia,
    pero el destino puede ser cualquiera activa, también la bodega aunque
    no se pueda consultar.
  */
  it("con inventory-own el origen es la ubicación propia y no se puede cambiar", async () => {
    await renderConFormulario({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
      ubicacionOperativa: "camion1",
    })

    const origen = screen.getByLabelText(/^origen$/i)

    expect(origen).toBeDisabled()
    expect(origen).toHaveValue("camion1")
    expect(opciones(/^destino$/i)).toContain("Lunacell Bodega")
  })

  it("con inventory-own y sin ubicación operativa avisa que no puede trasladar", async () => {
    await renderConFormulario({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
    })

    expect(screen.getByText(/no tienes una ubicación operativa/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^trasladar$/i })).toBeDisabled()
  })

  it("con inventory-all el origen puede ser cualquier ubicación activa", async () => {
    await renderConFormulario({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-all"],
      ubicacionOperativa: "store",
    })

    expect(screen.getByLabelText(/^origen$/i)).not.toBeDisabled()
    expect(opciones(/^origen$/i)).toEqual(
      expect.arrayContaining(["Lunacell Bodega", "Lunacell Store", "Camión 01"])
    )
  })
})

describe("Traslados: registrar", () => {
  it("envía exactamente origen, destino, renglones, nota y clave", async () => {
    const { falso } = await renderConFormulario()

    llenarTraslado()
    fireEvent.change(screen.getByLabelText(/observación/i), { target: { value: "Vitrina" } })
    await trasladar()

    expect(llamadas(falso)).toHaveLength(1)
    expect(llamadas(falso)[0][1]).toEqual({
      p_origen: "bodega",
      p_destino: "store",
      p_items: [{ producto_id: "p1", cantidad: 3 }],
      p_nota: "Vitrina",
      p_clave_idempotencia: expect.any(String),
    })
  })

  it("permite varios productos en un traslado", async () => {
    const { falso } = await renderConFormulario()

    llenarTraslado()
    fireEvent.click(screen.getByRole("button", { name: /agregar producto/i }))
    elegir(/producto del renglón 2/i, "p2")
    elegir(/cantidad del renglón 2/i, "2")
    await trasladar()

    expect(llamadas(falso)[0][1].p_items).toEqual([
      { producto_id: "p1", cantidad: 3 },
      { producto_id: "p2", cantidad: 2 },
    ])
  })

  it("dos clics seguidos registran el traslado una sola vez", async () => {
    const { falso } = await renderConFormulario()

    llenarTraslado()

    await act(async () => {
      const boton = screen.getByRole("button", { name: /^trasladar$/i })
      fireEvent.click(boton)
      fireEvent.click(boton)
    })

    expect(llamadas(falso)).toHaveLength(1)
    expect(falso.datos.traslados).toHaveLength(1)
  })

  it("sin destino no envía nada y lo dice", async () => {
    const { falso } = await renderConFormulario()
    Swal.fire.mockClear()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p1")
    elegir(/cantidad del renglón 1/i, "1")
    await trasladar()

    expect(llamadas(falso)).toHaveLength(0)
    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ icon: "warning" }))
  })

  it("después de trasladar recarga las existencias y lo muestra en el historial", async () => {
    const { falso } = await renderConFormulario()

    const consultasDeExistencias = () =>
      falso.from.mock.calls.filter(([t]) => t === "existencias_por_ubicacion").length

    const antes = consultasDeExistencias()

    llenarTraslado()
    await trasladar()

    await waitFor(() => expect(consultasDeExistencias()).toBeGreaterThan(antes))

    // La ventana se cierra sola y el traslado aparece en el historial.
    expect(screen.queryByRole("dialog", { name: "Nuevo traslado" })).not.toBeInTheDocument()

    const fila = filaDeRuta("lunacell bodega → lunacell store")

    expect(celdas(fila).slice(0, 4)).toEqual(["TR-000001", "Lunacell Bodega", "Lunacell Store", "1 producto"])
    expect(within(fila).getByText("1 producto")).toHaveAttribute("title", "Cargador × 3")
  })

  it("si el servidor rechaza, la ventana sigue abierta con lo escrito", async () => {
    await renderConFormulario({ fallarEn: { registrar_traslado: { code: "LT005", message: "No hay suficiente" } } })

    llenarTraslado({ cantidad: "4" })
    await trasladar()

    expect(screen.getByRole("dialog", { name: "Nuevo traslado" })).toBeInTheDocument()
    expect(screen.getByLabelText(/cantidad del renglón 1/i)).toHaveValue(4)
  })

  /*
    Desde INV-4.1 pedir más de lo que se ve disponible ya no llega al
    servidor. Lo que sí puede pasar es que la existencia cambie entre lo
    que vio la pantalla y el traslado —otra venta, otro traslado—, y
    entonces el servidor rechaza con LT005. Ese mensaje es el que se
    simula aquí, y es el que el usuario tiene que ver.
  */
  it("un rechazo del servidor se muestra con su mensaje y no registra nada", async () => {
    const { falso } = await renderConFormulario({
      fallarEn: {
        registrar_traslado: {
          code: "LT005",
          message: "No hay suficiente «Cargador» en Lunacell Bodega: hay 10, se trasladan 11",
        },
      },
    })
    Swal.fire.mockClear()

    llenarTraslado({ cantidad: "3" })
    await trasladar()

    const aviso = Swal.fire.mock.calls.find(([o]) => o?.icon === "error")

    expect(aviso[0].text).toMatch(/no hay suficiente «cargador» en lunacell bodega: hay 10, se trasladan 11/i)
    expect(falso.datos.traslados).toHaveLength(0)
  })
})

describe("Traslados: historial", () => {
  const DEVOLUCION = {
    id: "t1",
    origen_id: "camion1",
    destino_id: "bodega",
    usuario_id: "u-prueba",
    nota: "Devolución de fin de ruta",
    creado_en: "2026-10-02T15:00:00Z",
    renglones: [{ producto_id: "p1", cantidad: 2 }],
  }

  it("una fila compacta: número, origen, destino, cuántos productos, fecha, estado y el detalle", async () => {
    await renderTransfers({ traslados: [DEVOLUCION] })

    const tabla = screen.getByRole("table", { name: /historial de traslados/i })

    expect(within(tabla).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "N.º traslado",
      "Origen",
      "Destino",
      "Productos",
      "Fecha",
      "Estado",
      "Acciones",
    ])

    const fila = filaDeRuta("camión 01 → lunacell bodega")

    expect(celdas(fila)).toEqual([
      "TR-000001",
      "Camión 01",
      "Lunacell Bodega",
      "1 producto",
      fechaYHora(DEVOLUCION.creado_en),
      "Aplicado",
      "",
    ])
    expect(within(fila).getByText("1 producto")).toHaveAttribute("title", "Cargador × 2")
    expect(within(fila).getByText("Aplicado")).toHaveClass("badge-paid")
  })

  it("Nuevo traslado abre el formulario en una ventana; cerrarla conserva lo escrito", async () => {
    await renderTransfers()

    expect(screen.queryByLabelText(/^origen$/i)).not.toBeInTheDocument()

    const boton = screen.getByRole("button", { name: /^nuevo traslado$/i })
    boton.focus()
    fireEvent.click(boton)

    const ventana = screen.getByRole("dialog", { name: "Nuevo traslado" })
    elegir(/^origen$/i, "bodega")

    fireEvent.click(within(ventana).getByRole("button", { name: /^cancelar$/i }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(boton).toHaveFocus()

    fireEvent.click(boton)
    expect(screen.getByLabelText(/^origen$/i)).toHaveValue("bodega")

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("la búsqueda encuentra entre lo cargado por producto, nota, número o usuario, sin consultar", async () => {
    const { falso } = await renderTransfers({
      traslados: [
        DEVOLUCION,
        { ...DEVOLUCION, id: "t2", origen_id: "bodega", destino_id: "store", nota: "Vitrina", creado_en: "2026-10-03T15:00:00Z", renglones: [{ producto_id: "p2", cantidad: 1 }] },
      ],
    })

    const consultas = () => falso.from.mock.calls.filter(([t]) => t === "traslados").length
    const antes = consultas()
    const buscar = (texto) => fireEvent.change(screen.getByRole("searchbox", { name: "Buscar traslado" }), { target: { value: texto } })
    const rutas = () =>
      within(screen.getByRole("table", { name: /historial de traslados/i }))
        .getAllByRole("row")
        .slice(1)
        .map((f) => celdas(f).slice(1, 3).join(" → "))

    buscar("cubo")
    expect(rutas()).toEqual(["Lunacell Bodega → Lunacell Store"])

    buscar("devolucion")
    expect(rutas()).toEqual(["Camión 01 → Lunacell Bodega"])

    buscar("tr-000002")
    expect(rutas()).toEqual(["Lunacell Bodega → Lunacell Store"])

    buscar("administradora")
    expect(rutas()).toHaveLength(2)

    buscar("nada parecido")
    expect(screen.getByText("Ningún traslado coincide con la búsqueda")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /limpiar filtros/i }))
    expect(rutas()).toHaveLength(2)
    expect(consultas()).toBe(antes)
  })

  it("sin traslados muestra un estado vacío", async () => {
    await renderTransfers()

    expect(screen.getByText(/todavía no hay traslados/i)).toBeInTheDocument()
  })
})

/*
  INV-4.2: cada traslado del historial se puede abrir para ver qué se
  movió, de dónde, hacia dónde, cuándo y quién, aunque un producto ya
  no esté activo en el catálogo.
*/
describe("Traslados: detalle", () => {
  const INACTIVO = { id: "p9", code: "C-9", name: "Cable descontinuado", category: "Accesorios", price: 50, stock: 0, minStock: 0, active: false }

  const DEVOLUCION = {
    id: "t1",
    origen_id: "camion1",
    destino_id: "bodega",
    usuario_id: "u-prueba",
    nota: "Devolución de fin de ruta",
    creado_en: "2026-10-02T15:00:00Z",
    renglones: [
      { producto_id: "p1", cantidad: 2 },
      { producto_id: "p9", cantidad: 3 },
    ],
  }

  const aFecha = (iso) =>
    new Date(iso).toLocaleString("es-HN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })

  const renderConHistorial = (traslados = [DEVOLUCION]) =>
    renderTransfers({ productos: [...PRODUCTOS, INACTIVO], traslados })

  const abrirDetalle = (nombre = /ver detalle del traslado TR-\d{6}, camión 01 → lunacell bodega/i) => {
    fireEvent.click(screen.getByRole("button", { name: nombre }))
    return screen.getByRole("dialog", { name: /detalle del traslado/i })
  }

  // El valor que acompaña a un dato del detalle: el <dd> que sigue a su <dt>.
  const dato = (dialogo, termino) =>
    within(dialogo).getAllByRole("term").find((dt) => dt.textContent === termino)
      ?.nextElementSibling.textContent

  it("cada traslado del historial tiene una acción Ver detalle con nombre propio", async () => {
    await renderConHistorial([
      DEVOLUCION,
      { ...DEVOLUCION, id: "t2", origen_id: "bodega", destino_id: "store", creado_en: "2026-10-03T15:00:00Z" },
    ])

    const botones = screen.getAllByRole("button", { name: /ver detalle del traslado/i })

    expect(botones).toHaveLength(2)
    // Solo el icono del ojo: el nombre lo da aria-label y el rótulo flotante, title.
    expect(botones.map((b) => b.getAttribute("title"))).toEqual(["Ver detalle", "Ver detalle"])
    expect(
      screen.getByRole("button", { name: `Ver detalle del traslado TR-000002, Lunacell Bodega → Lunacell Store, ${aFecha("2026-10-03T15:00:00Z")}` })
    ).toBeInTheDocument()
  })

  it("el detalle muestra número, fecha y hora, origen, destino, estado, usuario y nota", async () => {
    await renderConHistorial()

    const dialogo = abrirDetalle()

    expect(dato(dialogo, "Número")).toBe("TR-000001")
    expect(dato(dialogo, "Fecha y hora")).toBe(aFecha(DEVOLUCION.creado_en))
    expect(dato(dialogo, "Origen")).toBe("Camión 01")
    expect(dato(dialogo, "Destino")).toBe("Lunacell Bodega")
    expect(dato(dialogo, "Estado")).toBe("Aplicado")
    expect(dato(dialogo, "Usuario")).toBe("Administradora")
    expect(dato(dialogo, "Nota")).toBe("Devolución de fin de ruta")
  })

  it("los productos se listan en una tabla con su cantidad, incluido uno inactivo", async () => {
    await renderConHistorial()

    const dialogo = abrirDetalle()
    const tabla = within(dialogo).getByRole("table", { name: /productos trasladados/i })
    const filas = within(tabla)
      .getAllByRole("row")
      .slice(1)
      .map((fila) => within(fila).getAllByRole("cell").map((c) => c.textContent))

    expect(filas).toEqual([
      ["Cargador", "2"],
      ["Cable descontinuado", "3"],
      ["Total", "5"],
    ])
  })

  it("el historial cuenta los productos y también nombra al inactivo", async () => {
    await renderConHistorial()

    const productos = within(filaDeRuta("camión 01 → lunacell bodega")).getByText("2 productos")

    expect(productos).toHaveAttribute("title", "Cargador × 2, Cable descontinuado × 3")
  })

  it("sin nombre de usuario ni nota muestra un guion", async () => {
    await renderConHistorial([{ ...DEVOLUCION, usuario_id: "u-ajeno", nota: "" }])

    const dialogo = abrirDetalle()

    expect(dato(dialogo, "Usuario")).toBe("—")
    expect(dato(dialogo, "Nota")).toBe("—")
  })

  it("se cierra con el botón Cerrar y con Escape, y devuelve el foco a Ver detalle", async () => {
    await renderConHistorial()

    const boton = screen.getByRole("button", { name: /ver detalle del traslado/i })

    boton.focus()
    const dialogo = abrirDetalle()
    fireEvent.click(within(dialogo).getAllByRole("button", { name: /^cerrar$/i }).at(-1))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(boton).toHaveFocus()

    expect(abrirDetalle()).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("es un diálogo modal con título asociado y no cambia nada al abrirse", async () => {
    const { falso } = await renderConHistorial()

    const dialogo = abrirDetalle()

    expect(dialogo).toHaveAttribute("aria-modal", "true")
    expect(within(dialogo).getByRole("heading", { name: "Detalle del traslado" })).toBeInTheDocument()
    expect(llamadas(falso)).toHaveLength(0)
  })
})

/*
  INV-4.1: lo que la pantalla ofrece y deja enviar sale de la existencia
  de la UBICACIÓN de origen, no del stock global. Es una ayuda para no
  pedir lo que no hay; quien decide sigue siendo registrar_traslado.
*/
describe("Traslados: validación previa por ubicación", () => {
  const opcionesDeProducto = (renglon) =>
    opciones(new RegExp(`producto del renglón ${renglon}`, "i")).filter((t) => !t.startsWith("—"))

  it("solo ofrece productos con existencia en el origen, con la cantidad disponible", async () => {
    await renderConFormulario()

    elegir(/^origen$/i, "bodega")

    expect(opcionesDeProducto(1)).toEqual([
      "Cargador — 10 disponibles",
      "Cubo Iphone — 6 disponibles",
    ])
  })

  it("un producto con existencia 0 en el origen no aparece, aunque tenga stock global", async () => {
    await renderConFormulario()

    elegir(/^origen$/i, "camion1")

    expect(opcionesDeProducto(1)).toEqual(["Cargador — 2 disponibles"])
  })

  it("un producto elegido en un renglón desaparece de los demás", async () => {
    await renderConFormulario()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p1")
    fireEvent.click(screen.getByRole("button", { name: /agregar producto/i }))

    expect(opcionesDeProducto(2)).toEqual(["Cubo Iphone — 6 disponibles"])
    // El propio renglón conserva el suyo.
    expect(opcionesDeProducto(1)).toContain("Cargador — 10 disponibles")
  })

  it("la cantidad no admite más que lo disponible en el origen", async () => {
    await renderConFormulario()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p2")

    expect(screen.getByLabelText(/cantidad del renglón 1/i)).toHaveAttribute("max", "6")
  })

  it("si la cantidad supera lo disponible, avisa y no llama a registrar_traslado", async () => {
    const { falso } = await renderConFormulario()
    Swal.fire.mockClear()

    llenarTraslado({ cantidad: "11" })
    await trasladar()

    expect(llamadas(falso)).toHaveLength(0)
    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        icon: "warning",
        text: expect.stringMatching(/cargador: hay 10 en lunacell bodega, pides 11/i),
      })
    )
  })

  it("cambiar el origen vacía los renglones y recalcula lo disponible", async () => {
    await renderConFormulario()

    llenarTraslado()
    fireEvent.click(screen.getByRole("button", { name: /agregar producto/i }))

    elegir(/^origen$/i, "camion1")

    expect(screen.queryByLabelText(/producto del renglón 2/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/producto del renglón 1/i)).toHaveValue("")
    expect(screen.getByLabelText(/cantidad del renglón 1/i)).toHaveValue(null)
    expect(opcionesDeProducto(1)).toEqual(["Cargador — 2 disponibles"])
  })

  it("un origen sin existencias lo dice y no deja trasladar", async () => {
    const { falso } = await renderConFormulario()

    elegir(/^origen$/i, "store")

    expect(screen.getByText(/no hay productos con existencia en lunacell store/i)).toBeInTheDocument()

    const boton = screen.getByRole("button", { name: /^trasladar$/i })

    expect(boton).toBeDisabled()

    await trasladar()

    expect(llamadas(falso)).toHaveLength(0)
  })

  it("con inventory-own ofrece solo lo que hay en su ubicación", async () => {
    await renderConFormulario({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
      ubicacionOperativa: "camion1",
    })

    expect(opcionesDeProducto(1)).toEqual(["Cargador — 2 disponibles"])
  })

  it("los controles nuevos tienen nombre accesible y la disponibilidad se dice con texto", async () => {
    await renderConFormulario()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p1")
    fireEvent.click(screen.getByRole("button", { name: /agregar producto/i }))

    expect(screen.getByRole("button", { name: "Quitar renglón 2" })).toBeInTheDocument()
    expect(screen.getByText("Disponible en origen: 10")).toBeInTheDocument()
  })
})

/*
  INV-4.3: el historial se filtra por ubicación y por fechas, y se recorre
  por páginas con "Cargar más". Filtrar y paginar lo hace la consulta; la
  pantalla solo pide y agrega lo que llega.
*/
describe("Traslados: filtros y Cargar más", () => {
  const HORA = 60 * 60 * 1000

  // Una serie de traslados, uno por hora; cada uno se reconoce por su nota.
  const serie = (n, { inicio = Date.UTC(2026, 9, 1), prefijo = "Serie", ...cambios } = {}) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefijo}-${String(i).padStart(3, "0")}`,
      origen_id: "bodega",
      destino_id: "store",
      usuario_id: "u-prueba",
      nota: `${prefijo} ${i}`,
      creado_en: new Date(inicio + i * HORA).toISOString(),
      renglones: [{ producto_id: "p1", cantidad: 1 }],
      ...cambios,
    }))

  // Notas de la serie, de la más reciente a la más antigua.
  const notasEsperadas = (n, prefijo = "Serie") =>
    Array.from({ length: n }, (_, i) => `${prefijo} ${n - 1 - i}`)

  const tablaHistorial = () => screen.getByRole("table", { name: /historial de traslados/i })

  /*
    La nota ya no va en la fila: cada traslado de la serie se reconoce por
    su fecha, que es única (uno por hora), y de ella se vuelve a su nota.
  */
  let notaPorFecha = new Map()

  const renderSerie = (extra = {}) => {
    notaPorFecha = new Map((extra.traslados || []).map((t) => [fechaYHora(t.creado_en), t.nota]))
    return renderTransfers(extra)
  }

  const filas = () => within(tablaHistorial()).getAllByRole("row").slice(1)

  const notaDe = (fila) => notaPorFecha.get(within(fila).getAllByRole("cell")[4].textContent)

  const notas = () => filas().map(notaDe)

  const filaDeNota = (nota) => filas().find((fila) => notaDe(fila) === nota)

  const consultasDeTraslados = (falso) =>
    falso.from.mock.calls.filter(([tabla]) => tabla === "traslados").length

  const cargarMas = () => screen.getByRole("button", { name: /^cargar más$/i })

  const pulsarCargarMas = async () => {
    await act(async () => {
      fireEvent.click(cargarMas())
    })
  }

  const filtrar = async (etiqueta, valor) => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })
    })
  }

  // La hora local, que es la que el usuario elige en los campos de fecha.
  const local = (anio, mes, dia, h = 0, m = 0) => new Date(anio, mes - 1, dia, h, m).toISOString()

  it("muestra los controles de filtro con nombre accesible", async () => {
    await renderSerie()

    const ubicacion = screen.getByLabelText("Ubicación")

    // Todas las ubicaciones, también las inactivas: un traslado viejo pudo pasar por ellas.
    expect(within(ubicacion).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todas",
      "Camión 01",
      "Camión retirado",
      "Lunacell Bodega",
      "Lunacell Store",
    ])
    expect(screen.getByLabelText("Desde")).toHaveAttribute("type", "date")
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("type", "date")
    expect(screen.getByRole("button", { name: /limpiar filtros/i })).toBeInTheDocument()
  })

  it("con más de una página muestra solo la primera y ofrece Cargar más", async () => {
    await renderSerie({ traslados: serie(TAMANO_PAGINA + 3) })

    expect(notas()).toEqual(notasEsperadas(TAMANO_PAGINA + 3).slice(0, TAMANO_PAGINA))
    expect(cargarMas()).toBeEnabled()
  })

  it("Cargar más agrega la página siguiente debajo, sin reemplazar ni repetir, y desaparece al llegar al final", async () => {
    await renderSerie({ traslados: serie(TAMANO_PAGINA * 2 + 2) })

    await pulsarCargarMas()

    expect(notas()).toEqual(notasEsperadas(TAMANO_PAGINA * 2 + 2).slice(0, TAMANO_PAGINA * 2))
    expect(cargarMas()).toBeEnabled()

    await pulsarCargarMas()

    expect(notas()).toEqual(notasEsperadas(TAMANO_PAGINA * 2 + 2))
    expect(new Set(notas()).size).toBe(TAMANO_PAGINA * 2 + 2)
    expect(screen.queryByRole("button", { name: /^cargar más$/i })).not.toBeInTheDocument()
  })

  it("sin más páginas no ofrece Cargar más", async () => {
    await renderSerie({ traslados: serie(3) })

    expect(notas()).toHaveLength(3)
    expect(screen.queryByRole("button", { name: /cargar más/i })).not.toBeInTheDocument()
  })

  it("mientras carga la página siguiente lo dice y no deja pedirla otra vez", async () => {
    const { falso } = await renderSerie({ traslados: serie(TAMANO_PAGINA + 3) })
    const antes = consultasDeTraslados(falso)

    fireEvent.click(cargarMas())

    const cargando = screen.getByRole("button", { name: /cargando más/i })
    expect(cargando).toBeDisabled()

    fireEvent.click(cargando)
    fireEvent.click(cargando)

    await waitFor(() => expect(notas()).toHaveLength(TAMANO_PAGINA + 3))
    expect(consultasDeTraslados(falso)).toBe(antes + 1)
  })

  it("dos pulsaciones seguidas de Cargar más piden una sola página", async () => {
    const { falso } = await renderSerie({ traslados: serie(TAMANO_PAGINA * 3) })
    const antes = consultasDeTraslados(falso)

    await act(async () => {
      const boton = cargarMas()
      fireEvent.click(boton)
      fireEvent.click(boton)
    })

    expect(consultasDeTraslados(falso)).toBe(antes + 1)
    expect(notas()).toEqual(notasEsperadas(TAMANO_PAGINA * 3).slice(0, TAMANO_PAGINA * 2))
  })

  it("si falla Cargar más conserva lo que ya se ve, lo dice y deja reintentar", async () => {
    const fallarEn = {}
    await renderSerie({ traslados: serie(TAMANO_PAGINA + 3), fallarEn })

    fallarEn.traslados = { message: "sin conexión" }
    await pulsarCargarMas()

    expect(notas()).toEqual(notasEsperadas(TAMANO_PAGINA + 3).slice(0, TAMANO_PAGINA))
    expect(screen.getByRole("alert")).toHaveTextContent(/no se pudieron cargar más traslados/i)

    delete fallarEn.traslados
    await pulsarCargarMas()

    expect(notas()).toEqual(notasEsperadas(TAMANO_PAGINA + 3))
    expect(screen.queryByText(/no se pudieron cargar más traslados/i)).not.toBeInTheDocument()
  })

  it("filtrar por ubicación vuelve a la primera página e incluye origen y destino", async () => {
    await renderSerie({
      traslados: [
        ...serie(TAMANO_PAGINA + 3),
        ...serie(2, { prefijo: "Sale", inicio: Date.UTC(2026, 10, 1), origen_id: "camion1", destino_id: "store" }),
        ...serie(1, { prefijo: "Entra", inicio: Date.UTC(2026, 10, 5), origen_id: "store", destino_id: "camion1" }),
      ],
    })

    await pulsarCargarMas()
    await filtrar("Ubicación", "camion1")

    await waitFor(() => expect(notas()).toEqual(["Entra 0", "Sale 1", "Sale 0"]))
    expect(screen.queryByRole("button", { name: /^cargar más$/i })).not.toBeInTheDocument()
  })

  it("la fecha desde filtra desde el inicio de ese día y vuelve a la primera página", async () => {
    await renderSerie({
      traslados: [
        ...serie(1, { prefijo: "Antes", inicio: Date.parse(local(2026, 10, 1, 23, 59)) }),
        ...serie(2, { prefijo: "Dentro", inicio: Date.parse(local(2026, 10, 2)) }),
      ],
    })

    await filtrar("Desde", "2026-10-02")

    await waitFor(() => expect(notas()).toEqual(["Dentro 1", "Dentro 0"]))
  })

  it("la fecha hasta incluye todo ese día y vuelve a la primera página", async () => {
    await renderSerie({
      traslados: [
        ...serie(1, { prefijo: "Ultimo", inicio: Date.parse(local(2026, 10, 5, 23, 30)) }),
        ...serie(1, { prefijo: "Despues", inicio: Date.parse(local(2026, 10, 6)) }),
      ],
    })

    await filtrar("Hasta", "2026-10-05")

    await waitFor(() => expect(notas()).toEqual(["Ultimo 0"]))
  })

  it("si la fecha desde es posterior a la fecha hasta lo dice y no consulta", async () => {
    const { falso } = await renderSerie({ traslados: serie(3) })

    await filtrar("Desde", "2026-10-06")
    const antes = consultasDeTraslados(falso)
    await filtrar("Hasta", "2026-10-05")

    expect(screen.getByText("La fecha desde no puede ser posterior a la fecha hasta.")).toBeInTheDocument()
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("aria-invalid", "true")
    expect(screen.queryByRole("table", { name: /historial de traslados/i })).not.toBeInTheDocument()
    expect(consultasDeTraslados(falso)).toBe(antes)
  })

  it("sin resultados por los filtros lo dice distinto que un historial vacío", async () => {
    await renderSerie({ traslados: serie(3) })

    await filtrar("Ubicación", "camion1")

    await waitFor(() => expect(screen.getByText("No hay traslados con estos filtros")).toBeInTheDocument())
    expect(screen.queryByText(/todavía no hay traslados/i)).not.toBeInTheDocument()
  })

  it("Limpiar filtros deja todas las ubicaciones, fechas vacías y la primera página sin filtros", async () => {
    const { falso } = await renderSerie({ traslados: serie(TAMANO_PAGINA + 3) })

    await filtrar("Ubicación", "camion1")
    await filtrar("Desde", "2026-10-01")
    await filtrar("Hasta", "2026-10-31")
    const antes = consultasDeTraslados(falso)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /limpiar filtros/i }))
    })

    expect(screen.getByLabelText("Ubicación")).toHaveValue("")
    expect(screen.getByLabelText("Desde")).toHaveValue("")
    expect(screen.getByLabelText("Hasta")).toHaveValue("")
    await waitFor(() =>
      expect(notas()).toEqual(notasEsperadas(TAMANO_PAGINA + 3).slice(0, TAMANO_PAGINA))
    )
    expect(cargarMas()).toBeEnabled()
    expect(consultasDeTraslados(falso)).toBe(antes + 1)
  })

  it("Ver detalle funciona sobre un traslado traído con Cargar más", async () => {
    await renderSerie({ traslados: serie(TAMANO_PAGINA + 2) })

    await pulsarCargarMas()
    fireEvent.click(
      within(filaDeNota("Serie 0")).getByRole("button", {
        name: /ver detalle/i,
      })
    )

    const dialogo = screen.getByRole("dialog", { name: /detalle del traslado/i })
    expect(within(dialogo).getByText("Serie 0")).toBeInTheDocument()
  })

  it("después de filtrar, el detalle nombra al producto inactivo, muestra guion sin usuario y se cierra con Escape devolviendo el foco", async () => {
    const INACTIVO = { id: "p9", code: "C-9", name: "Cable descontinuado", category: "Accesorios", price: 50, stock: 0, minStock: 0, active: false }

    await renderSerie({
      productos: [...PRODUCTOS, INACTIVO],
      traslados: [
        ...serie(3),
        ...serie(1, {
          prefijo: "Ruta",
          origen_id: "camion1",
          destino_id: "bodega",
          usuario_id: "u-ajeno",
          renglones: [{ producto_id: "p9", cantidad: 4 }],
        }),
      ],
    })

    await filtrar("Ubicación", "camion1")
    await waitFor(() => expect(notas()).toEqual(["Ruta 0"]))

    const fila = filaDeNota("Ruta 0")
    expect(within(fila).getByText("1 producto")).toHaveAttribute("title", "Cable descontinuado × 4")

    const boton = within(fila).getByRole("button", { name: /ver detalle/i })
    boton.focus()
    fireEvent.click(boton)

    const dialogo = screen.getByRole("dialog", { name: /detalle del traslado/i })
    const usuario = within(dialogo).getAllByRole("term").find((dt) => dt.textContent === "Usuario")
    expect(usuario.nextElementSibling).toHaveTextContent("—")
    expect(within(dialogo).getByText("Cable descontinuado")).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(boton).toHaveFocus()
  })
})

/*
  INV-4.4: un vendedor ve quién hizo cada traslado aunque haya sido un
  compañero. El nombre lo da nombres_de_usuarios(); si no lo da, "—".
*/
describe("Traslados: autor visible para quien no es administrador", () => {
  const DE_COMPANERA = {
    id: "t-comp",
    origen_id: "bodega",
    destino_id: "store",
    usuario_id: "u-companera",
    nota: "Reposición",
    creado_en: "2026-10-02T15:00:00Z",
    renglones: [{ producto_id: "p1", cantidad: 2 }],
  }

  const comoVendedor = (extra = {}) =>
    renderTransfers({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
      ubicacionOperativa: "bodega",
      otrosUsuarios: [{ id: "u-companera", auth_id: "auth-companera", nombre: "Carla Compañera" }],
      traslados: [DE_COMPANERA],
      ...extra,
    })

  const filaDelTraslado = () => filaDeRuta("lunacell bodega → lunacell store")

  const buscar = (texto) =>
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar traslado" }), { target: { value: texto } })

  it("el detalle muestra a la compañera que lo hizo y la búsqueda la encuentra", async () => {
    await comoVendedor()

    buscar("carla")
    expect(filaDelTraslado()).toBeInTheDocument()

    fireEvent.click(within(filaDelTraslado()).getByRole("button", { name: /ver detalle/i }))
    const dialogo = screen.getByRole("dialog", { name: /detalle del traslado/i })
    const usuario = within(dialogo).getAllByRole("term").find((dt) => dt.textContent === "Usuario")
    expect(usuario.nextElementSibling).toHaveTextContent("Carla Compañera")
  })

  it("si no se pueden resolver los nombres, el historial se ve igual y el detalle con un guion", async () => {
    await comoVendedor({ fallarEn: { nombres_de_usuarios: { message: "sin red" } } })

    const fila = filaDelTraslado()
    expect(celdas(fila).slice(0, 4)).toEqual(["TR-000001", "Lunacell Bodega", "Lunacell Store", "1 producto"])

    fireEvent.click(within(fila).getByRole("button", { name: /ver detalle/i }))
    const dialogo = screen.getByRole("dialog", { name: /detalle del traslado/i })
    const usuario = within(dialogo).getAllByRole("term").find((dt) => dt.textContent === "Usuario")
    expect(usuario.nextElementSibling).toHaveTextContent("—")
    expect(within(dialogo).getByText("Reposición")).toBeInTheDocument()
  })
})
