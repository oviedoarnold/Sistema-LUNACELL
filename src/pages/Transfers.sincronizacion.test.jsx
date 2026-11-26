import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import LocationsProvider from "../context/LocationsContext"
import { CADA_CUANTO } from "../hooks/useTraslados"
import { renderizarPantalla } from "../test/pantallas"
import Transfers from "./Transfers"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  Traslados al día entre dispositivos. El remitente deja la pantalla
  abierta en su PC; quien recibe confirma o reporta desde su teléfono. Aquí
  «el otro dispositivo» es un cambio directo en los datos del doble de
  Supabase, como el que dejaría su confirmación en la base, y el reloj de
  30 s se adelanta a mano. La pantalla no se recarga nunca.
*/

const PRODUCTOS = [
  { id: "p1", code: "C-1", name: "Cargador", category: "Accesorios", price: 120, stock: 10, minStock: 1 },
  { id: "p2", code: "C-2", name: "Cubo Iphone", category: "Accesorios", price: 100, stock: 6, minStock: 1 },
]

const UBICACIONES = [
  { id: "bodega", name: "Lunacell Bodega", type: "bodega" },
  { id: "store", name: "Ruta local", type: "camion" },
]

const PENDIENTE = {
  id: "t-pend",
  origen_id: "bodega",
  destino_id: "store",
  usuario_id: "u-gladys",
  estado: "pendiente",
  unidades: 5,
  creado_en: "2026-11-26T15:40:00Z",
  renglones: [
    { producto_id: "p1", cantidad: 3 },
    { producto_id: "p2", cantidad: 2 },
  ],
}

const ANTERIOR = {
  id: "t-hist",
  origen_id: "bodega",
  destino_id: "store",
  usuario_id: "u-gladys",
  creado_en: "2026-10-22T02:07:00Z",
  renglones: [{ producto_id: "p2", cantidad: 1 }],
}

const RECIBIDO_POR_OTRO = {
  estado: "recibido",
  recibido_por: "u-ruta",
  recibido_por_nombre: "Vendedor Ruta",
  recibido_en: "2026-11-26T15:45:00Z",
}

const CON_INCIDENCIA = {
  estado: "con_incidencia",
  incidencia: "Llegaron 2 cargadores, se enviaron 3",
  incidencia_por: "u-ruta",
  incidencia_por_nombre: "Vendedor Ruta",
  incidencia_en: "2026-11-26T15:44:00Z",
}

function renderTraslados({ rol = "admin", permisos = ["inventory-all", "inventory-own"], ubicacion = "bodega", fallarEn = {} } = {}) {
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
      existencias: [{ locationId: "bodega", productId: "p1", quantity: 7 }],
      rolDelUsuario: rol,
      permisosDelUsuario: permisos,
      ubicacionOperativa: ubicacion,
      otrosUsuarios: [
        { id: "u-gladys", nombre: "Gladys Luna", ubicacion_id: "bodega" },
        { id: "u-ruta", nombre: "Vendedor Ruta", ubicacion_id: "store" },
      ],
      traslados: [PENDIENTE, ANTERIOR],
      fallarEn,
      esperar: ["productos_con_stock", "ubicaciones", "existencias_por_ubicacion", "traslados"],
    }
  )
}

// Lo que dejaría en la base la operación hecha en el otro dispositivo.
const enElOtroDispositivo = (falso, id, cambios) => {
  falso.datos.traslados = falso.datos.traslados.map((t) => (t.id === id ? { ...t, ...cambios } : t))
}

const pasan30s = () => act(async () => vi.advanceTimersByTime(CADA_CUANTO))

const historial = () => screen.getByRole("table", { name: /historial de traslados/i })
const filaDelHistorial = (numero) => within(historial()).getAllByRole("row").find((f) => f.textContent.includes(numero))
const columna = (fila, etiqueta) => fila.querySelector(`[data-etiqueta="${etiqueta}"]`)?.textContent
const seccionPorRecibir = () => screen.queryByRole("region", { name: /por recibir/i })
const dato = (dialogo, termino) =>
  within(dialogo).getAllByRole("term").find((dt) => dt.textContent === termino)?.nextElementSibling?.textContent

describe("Traslados: actualización entre dispositivos", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("el remitente ve «Recibido», con quién y cuándo, sin recargar la pantalla", async () => {
    const { falso } = await renderTraslados()

    expect(columna(filaDelHistorial("TR-000002"), "Estado")).toBe("Pendiente de recepción")
    expect(columna(filaDelHistorial("TR-000002"), "Recepción")).toBe("Pendiente")

    enElOtroDispositivo(falso, "t-pend", RECIBIDO_POR_OTRO)
    await pasan30s()

    await waitFor(() => expect(columna(filaDelHistorial("TR-000002"), "Estado")).toBe("Recibido"))
    expect(columna(filaDelHistorial("TR-000002"), "Recepción")).toMatch(/^Vendedor Ruta · /)
    expect(columna(filaDelHistorial("TR-000001"), "Recepción")).toBe("Antes del control de recepción")
  })

  it("una incidencia reportada en el otro dispositivo también aparece sola", async () => {
    const { falso } = await renderTraslados()

    enElOtroDispositivo(falso, "t-pend", CON_INCIDENCIA)
    await pasan30s()

    await waitFor(() => expect(columna(filaDelHistorial("TR-000002"), "Estado")).toBe("Con incidencia"))
  })

  it("el detalle que el remitente tiene abierto se pone al día", async () => {
    const { falso } = await renderTraslados()

    fireEvent.click(within(filaDelHistorial("TR-000002")).getByRole("button", { name: /ver detalle/i }))
    const dialogo = screen.getByRole("dialog", { name: /detalle del traslado/i })
    expect(dato(dialogo, "Estado")).toBe("Pendiente de recepción")

    enElOtroDispositivo(falso, "t-pend", CON_INCIDENCIA)
    await pasan30s()
    await waitFor(() => expect(dato(dialogo, "Estado")).toBe("Con incidencia"))
    expect(within(dialogo).getByRole("region", { name: "Incidencia" })).toHaveTextContent("Llegaron 2 cargadores, se enviaron 3")

    enElOtroDispositivo(falso, "t-pend", RECIBIDO_POR_OTRO)
    await pasan30s()
    await waitFor(() => expect(dato(dialogo, "Estado")).toBe("Recibido"))
    expect(dato(dialogo, "Recibido")).toMatch(/^Vendedor Ruta · /)
  })

  it("lo que otro recibió sale de «Por recibir» del administrador, y el historial lo muestra recibido", async () => {
    const { falso } = await renderTraslados()

    await waitFor(() => expect(seccionPorRecibir()).not.toBeNull())

    enElOtroDispositivo(falso, "t-pend", RECIBIDO_POR_OTRO)
    await pasan30s()

    await waitFor(() => expect(seccionPorRecibir()).toBeNull())
    expect(columna(filaDelHistorial("TR-000002"), "Estado")).toBe("Recibido")
  })

  it("un detalle que ya no está en las listas no se cierra de golpe y se consulta por su id", async () => {
    const { falso } = await renderTraslados()

    // El historial filtrado hasta el 25: el pendiente (del 26) queda fuera.
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-11-25" } })
    await waitFor(() => expect(filaDelHistorial("TR-000002")).toBeUndefined())

    const seccion = await waitFor(() => {
      const encontrada = seccionPorRecibir()
      expect(encontrada).not.toBeNull()
      return encontrada
    })
    fireEvent.click(within(seccion).getByRole("button", { name: /ver traslado/i }))
    const dialogo = screen.getByRole("dialog", { name: /detalle del traslado/i })

    enElOtroDispositivo(falso, "t-pend", RECIBIDO_POR_OTRO)
    await pasan30s()

    await waitFor(() => expect(seccionPorRecibir()).toBeNull())
    expect(screen.getByRole("dialog", { name: /detalle del traslado/i })).toBe(dialogo)
    await waitFor(() => expect(dato(dialogo, "Estado")).toBe("Recibido"))
    expect(dato(dialogo, "Recibido")).toMatch(/^Vendedor Ruta · /)
  })

  it("sin conexión conserva la tabla tal cual, sin errores, y se pone al día al volver la conexión", async () => {
    const fallarEn = {}
    const { falso } = await renderTraslados({ fallarEn })

    enElOtroDispositivo(falso, "t-pend", RECIBIDO_POR_OTRO)
    fallarEn.traslados = { code: "PGRST000", message: "sin red" }
    await pasan30s()

    expect(columna(filaDelHistorial("TR-000002"), "Estado")).toBe("Pendiente de recepción")
    expect(screen.queryByText(/sin red/i)).toBeNull()
    expect(screen.queryByText(/cargando/i)).toBeNull()

    delete fallarEn.traslados
    await pasan30s()

    await waitFor(() => expect(columna(filaDelHistorial("TR-000002"), "Estado")).toBe("Recibido"))
  })

  it("conserva el filtro elegido al refrescar", async () => {
    const { falso } = await renderTraslados()

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-11-01" } })
    await waitFor(() => expect(filaDelHistorial("TR-000001")).toBeUndefined())

    enElOtroDispositivo(falso, "t-pend", RECIBIDO_POR_OTRO)
    await pasan30s()

    await waitFor(() => expect(columna(filaDelHistorial("TR-000002"), "Estado")).toBe("Recibido"))
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-11-01")
    expect(filaDelHistorial("TR-000001")).toBeUndefined()
  })
})
