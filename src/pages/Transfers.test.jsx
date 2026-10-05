import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, act, waitFor, within } from "@testing-library/react"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import LocationsProvider from "../context/LocationsContext"
import { renderizarPantalla } from "../test/pantallas"
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
    await renderTransfers()

    expect(opciones(/^origen$/i)).not.toContain("Camión retirado")

    elegir(/^origen$/i, "bodega")

    const destinos = opciones(/^destino$/i)

    expect(destinos).toContain("Lunacell Store")
    expect(destinos).toContain("Camión 01")
    expect(destinos).not.toContain("Lunacell Bodega")
    expect(destinos).not.toContain("Camión retirado")
  })

  it("muestra cuánto hay del producto en el origen elegido", async () => {
    await renderTransfers()

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
    await renderTransfers({
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
    await renderTransfers({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
    })

    expect(screen.getByText(/no tienes una ubicación operativa/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^trasladar$/i })).toBeDisabled()
  })

  it("con inventory-all el origen puede ser cualquier ubicación activa", async () => {
    await renderTransfers({
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
    const { falso } = await renderTransfers()

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
    const { falso } = await renderTransfers()

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
    const { falso } = await renderTransfers()

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
    const { falso } = await renderTransfers()
    Swal.fire.mockClear()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p1")
    elegir(/cantidad del renglón 1/i, "1")
    await trasladar()

    expect(llamadas(falso)).toHaveLength(0)
    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ icon: "warning" }))
  })

  it("después de trasladar recarga las existencias y lo muestra en el historial", async () => {
    const { falso } = await renderTransfers()

    const consultasDeExistencias = () =>
      falso.from.mock.calls.filter(([t]) => t === "existencias_por_ubicacion").length

    const antes = consultasDeExistencias()

    llenarTraslado()
    await trasladar()

    await waitFor(() => expect(consultasDeExistencias()).toBeGreaterThan(antes))

    const historial = screen.getByRole("table", { name: /historial de traslados/i })

    expect(within(historial).getByText("Lunacell Bodega → Lunacell Store")).toBeInTheDocument()
    expect(within(historial).getByText(/cargador × 3/i)).toBeInTheDocument()
  })

  /*
    Desde INV-4.1 pedir más de lo que se ve disponible ya no llega al
    servidor. Lo que sí puede pasar es que la existencia cambie entre lo
    que vio la pantalla y el traslado —otra venta, otro traslado—, y
    entonces el servidor rechaza con LT005. Ese mensaje es el que se
    simula aquí, y es el que el usuario tiene que ver.
  */
  it("un rechazo del servidor se muestra con su mensaje y no registra nada", async () => {
    const { falso } = await renderTransfers({
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
  it("muestra fecha, usuario, origen y destino, productos, nota y estado", async () => {
    await renderTransfers({
      traslados: [
        {
          id: "t1",
          origen_id: "camion1",
          destino_id: "bodega",
          usuario_id: "u-prueba",
          nota: "Devolución de fin de ruta",
          creado_en: "2026-10-02T15:00:00Z",
          renglones: [{ producto_id: "p1", cantidad: 2 }],
        },
      ],
    })

    const fila = within(screen.getByRole("table", { name: /historial de traslados/i }))
      .getByText("Camión 01 → Lunacell Bodega")
      .closest("tr")

    expect(within(fila).getByText(/cargador × 2/i)).toBeInTheDocument()
    expect(within(fila).getByText("Devolución de fin de ruta")).toBeInTheDocument()
    expect(within(fila).getByText(/aplicado/i)).toBeInTheDocument()
    expect(within(fila).getByText("Administradora")).toBeInTheDocument()
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

  const abrirDetalle = (nombre = /ver detalle del traslado camión 01 → lunacell bodega/i) => {
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
    expect(botones.map((b) => b.textContent)).toEqual(["Ver detalle", "Ver detalle"])
    expect(
      screen.getByRole("button", { name: `Ver detalle del traslado Lunacell Bodega → Lunacell Store, ${aFecha("2026-10-03T15:00:00Z")}` })
    ).toBeInTheDocument()
  })

  it("el detalle muestra fecha y hora, origen, destino, estado, usuario y nota", async () => {
    await renderConHistorial()

    const dialogo = abrirDetalle()

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

  it("el historial también nombra al producto inactivo", async () => {
    await renderConHistorial()

    const fila = within(screen.getByRole("table", { name: /historial de traslados/i }))
      .getByText("Camión 01 → Lunacell Bodega")
      .closest("tr")

    expect(within(fila).getByText("Cargador × 2, Cable descontinuado × 3")).toBeInTheDocument()
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
    await renderTransfers()

    elegir(/^origen$/i, "bodega")

    expect(opcionesDeProducto(1)).toEqual([
      "Cargador — 10 disponibles",
      "Cubo Iphone — 6 disponibles",
    ])
  })

  it("un producto con existencia 0 en el origen no aparece, aunque tenga stock global", async () => {
    await renderTransfers()

    elegir(/^origen$/i, "camion1")

    expect(opcionesDeProducto(1)).toEqual(["Cargador — 2 disponibles"])
  })

  it("un producto elegido en un renglón desaparece de los demás", async () => {
    await renderTransfers()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p1")
    fireEvent.click(screen.getByRole("button", { name: /agregar producto/i }))

    expect(opcionesDeProducto(2)).toEqual(["Cubo Iphone — 6 disponibles"])
    // El propio renglón conserva el suyo.
    expect(opcionesDeProducto(1)).toContain("Cargador — 10 disponibles")
  })

  it("la cantidad no admite más que lo disponible en el origen", async () => {
    await renderTransfers()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p2")

    expect(screen.getByLabelText(/cantidad del renglón 1/i)).toHaveAttribute("max", "6")
  })

  it("si la cantidad supera lo disponible, avisa y no llama a registrar_traslado", async () => {
    const { falso } = await renderTransfers()
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
    await renderTransfers()

    llenarTraslado()
    fireEvent.click(screen.getByRole("button", { name: /agregar producto/i }))

    elegir(/^origen$/i, "camion1")

    expect(screen.queryByLabelText(/producto del renglón 2/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/producto del renglón 1/i)).toHaveValue("")
    expect(screen.getByLabelText(/cantidad del renglón 1/i)).toHaveValue(null)
    expect(opcionesDeProducto(1)).toEqual(["Cargador — 2 disponibles"])
  })

  it("un origen sin existencias lo dice y no deja trasladar", async () => {
    const { falso } = await renderTransfers()

    elegir(/^origen$/i, "store")

    expect(screen.getByText(/no hay productos con existencia en lunacell store/i)).toBeInTheDocument()

    const boton = screen.getByRole("button", { name: /^trasladar$/i })

    expect(boton).toBeDisabled()

    await trasladar()

    expect(llamadas(falso)).toHaveLength(0)
  })

  it("con inventory-own ofrece solo lo que hay en su ubicación", async () => {
    await renderTransfers({
      rolDelUsuario: "vendedor",
      permisosDelUsuario: ["inventory-own"],
      ubicacionOperativa: "camion1",
    })

    expect(opcionesDeProducto(1)).toEqual(["Cargador — 2 disponibles"])
  })

  it("los controles nuevos tienen nombre accesible y la disponibilidad se dice con texto", async () => {
    await renderTransfers()

    elegir(/^origen$/i, "bodega")
    elegir(/producto del renglón 1/i, "p1")
    fireEvent.click(screen.getByRole("button", { name: /agregar producto/i }))

    expect(screen.getByRole("button", { name: "Quitar renglón 2" })).toBeInTheDocument()
    expect(screen.getByText("Disponible en origen: 10")).toBeInTheDocument()
  })
})
