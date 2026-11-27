import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent, waitFor, within } from "@testing-library/react"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import ProductProvider from "../context/ProductContext"
import LocationsProvider from "../context/LocationsContext"
import { renderizarPantalla } from "../test/pantallas"
import { formatDateForDisplay, hora } from "../utils/format"
import Transfers from "./Transfers"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  La recepción de traslados en la pantalla (0056). Quién puede recibir y
  que la mercadería entre una sola vez lo decide la base y se prueba contra
  PostgreSQL real en pruebas-sql/recepcion-de-traslados.test.mjs; aquí, que
  la pantalla muestre lo que hay por recibir, pida la confirmación o la
  observación, mande exactamente eso y muestre lo que la base respondió.
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
  nota: "Carga del lunes",
  creado_en: "2026-11-26T15:40:00Z",
  renglones: [
    { producto_id: "p1", cantidad: 3 },
    { producto_id: "p2", cantidad: 2 },
  ],
}

const RECIBIDO = {
  id: "t-rec",
  origen_id: "bodega",
  destino_id: "store",
  usuario_id: "u-gladys",
  estado: "recibido",
  unidades: 1,
  creado_en: "2026-11-25T15:00:00Z",
  recibido_por: "u-otro",
  recibido_por_nombre: "Vendedor Ruta",
  recibido_en: "2026-11-25T15:20:00Z",
  renglones: [{ producto_id: "p1", cantidad: 1 }],
}

const HISTORICO = {
  id: "t-hist",
  origen_id: "bodega",
  destino_id: "store",
  usuario_id: "u-gladys",
  creado_en: "2026-10-22T02:07:00Z",
  renglones: [{ producto_id: "p2", cantidad: 1 }],
}

function renderRecepcion({ rol = "vendedor", permisos = ["inventory-own", "pos"], ubicacion = "store", traslados = [PENDIENTE, RECIBIDO, HISTORICO] } = {}) {
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
      otrosUsuarios: [{ id: "u-gladys", nombre: "Gladys Luna", ubicacion_id: "bodega" }],
      traslados,
      esperar: ["productos_con_stock", "ubicaciones", "existencias_por_ubicacion", "traslados"],
    }
  )
}

const seccionPorRecibir = () => screen.queryByRole("region", { name: /por recibir/i })
const celdas = (fila) => within(fila).getAllByRole("cell").map((c) => c.textContent)
const dato = (dialogo, termino) =>
  within(dialogo).getAllByRole("term").find((dt) => dt.textContent === termino)?.nextElementSibling?.textContent

async function abrirPorRecibir() {
  const seccion = await waitFor(() => {
    const encontrada = seccionPorRecibir()
    expect(encontrada).not.toBeNull()
    return encontrada
  })

  fireEvent.click(within(seccion).getByRole("button", { name: /ver traslado/i }))

  return screen.getByRole("dialog", { name: /detalle del traslado/i })
}

const llamadasA = (falso, nombre) => falso.rpc.mock.calls.filter(([n]) => n === nombre)

beforeEach(() => {
  Swal.fire.mockClear()
})

describe("Traslados: por recibir", () => {
  it("el receptor ve lo que le llega: número, origen, fecha, remitente, unidades y estado", async () => {
    await renderRecepcion()

    const seccion = await waitFor(() => {
      const encontrada = seccionPorRecibir()
      expect(encontrada).not.toBeNull()
      return encontrada
    })

    expect(within(seccion).getByRole("heading")).toHaveTextContent("Por recibir 1")
    const [fila] = within(seccion).getAllByRole("row").slice(1)
    expect(celdas(fila).slice(0, 2)).toEqual(["TR-000003", "Lunacell Bodega"])
    expect(celdas(fila).slice(3, 6)).toEqual(["Gladys Luna", "5", "Pendiente de recepción"])
  })

  it("el detalle muestra envío, productos con código y total, y las dos acciones", async () => {
    await renderRecepcion()
    const dialogo = await abrirPorRecibir()

    expect(dato(dialogo, "Enviado por")).toBe("Gladys Luna")
    expect(dato(dialogo, "Origen")).toBe("Lunacell Bodega")
    expect(dato(dialogo, "Destino")).toBe("Ruta local")
    expect(dato(dialogo, "Nota")).toBe("Carga del lunes")

    const filas = within(within(dialogo).getByRole("table", { name: /productos trasladados/i })).getAllByRole("row").slice(1)
    expect(filas.map((f) => within(f).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["Cargador", "C-1", "3"],
      ["Cubo Iphone", "C-2", "2"],
      ["Total de unidades", "5"],
    ])

    expect(within(dialogo).getByRole("button", { name: /confirmar recepción/i })).toBeEnabled()
    expect(within(dialogo).getByRole("button", { name: /reportar incidencia/i })).toBeEnabled()
  })

  it("confirmar pide la confirmación explícita, manda solo el traslado y suma al destino", async () => {
    const { falso } = await renderRecepcion()
    const dialogo = await abrirPorRecibir()

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(within(dialogo).getByRole("button", { name: /confirmar recepción/i }))

    await waitFor(() => expect(llamadasA(falso, "confirmar_recepcion_traslado")).toHaveLength(1))
    expect(Swal.fire.mock.calls[0][0].text).toBe(
      "¿Confirmas que recibiste físicamente todas las unidades de este traslado? Los productos se incorporarán al inventario de tu ubicación."
    )
    expect(llamadasA(falso, "confirmar_recepcion_traslado")[0][1]).toEqual({ p_traslado: "t-pend", p_observacion: null })

    const celda = (u, p) => falso.datos.inventario_ubicacion.find((c) => c.ubicacion_id === u && c.producto_id === p)?.cantidad
    expect([celda("store", "p1"), celda("store", "p2")]).toEqual([3, 2])
    await waitFor(() => expect(seccionPorRecibir()).toBeNull())
    expect(screen.queryByRole("dialog", { name: /detalle del traslado/i })).toBeNull()
  })

  it("si se descarta la confirmación no se llama a la base", async () => {
    const { falso } = await renderRecepcion()
    const dialogo = await abrirPorRecibir()

    fireEvent.click(within(dialogo).getByRole("button", { name: /confirmar recepción/i }))

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())
    expect(llamadasA(falso, "confirmar_recepcion_traslado")).toHaveLength(0)
  })

  it("reportar una incidencia pide la observación y deja el traslado con incidencia, sin sumar nada", async () => {
    const { falso } = await renderRecepcion()
    const dialogo = await abrirPorRecibir()

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: "  Llegaron 2 cubos, se enviaron 3  " })
    fireEvent.click(within(dialogo).getByRole("button", { name: /reportar incidencia/i }))

    await waitFor(() => expect(llamadasA(falso, "reportar_incidencia_traslado")).toHaveLength(1))
    expect(Swal.fire.mock.calls[0][0]).toMatchObject({ input: "textarea", title: "Reportar incidencia" })
    expect(Swal.fire.mock.calls[0][0].inputValidator("abc")).toMatch(/5 a 500/)
    expect(Swal.fire.mock.calls[0][0].inputValidator("Faltan dos")).toBeUndefined()
    expect(llamadasA(falso, "reportar_incidencia_traslado")[0][1]).toEqual({ p_traslado: "t-pend", p_nota: "Llegaron 2 cubos, se enviaron 3" })
    expect(falso.datos.inventario_ubicacion.find((c) => c.ubicacion_id === "store")).toBeUndefined()

    const seccion = await waitFor(() => {
      expect(within(seccionPorRecibir()).getByText("Con incidencia")).toBeInTheDocument()
      return seccionPorRecibir()
    })

    fireEvent.click(within(seccion).getByRole("button", { name: /ver traslado/i }))
    const otraVez = screen.getByRole("dialog", { name: /detalle del traslado/i })
    expect(within(otraVez).getByRole("region", { name: /incidencia/i })).toHaveTextContent("Llegaron 2 cubos, se enviaron 3")
    expect(within(otraVez).queryByRole("button", { name: /reportar incidencia/i })).toBeNull()
    expect(within(otraVez).getByRole("button", { name: /confirmar recepción/i })).toBeEnabled()
  })

  it("un rechazo de la base se muestra con su mensaje", async () => {
    const { falso } = await renderRecepcion()
    falso.rpc.mockImplementationOnce(() => Promise.resolve({ data: null, error: { code: "LT014", message: "El contenido del traslado TR-000003 cambió desde el envío; no se puede confirmar. Comunícate con el administrador." } }))
    const dialogo = await abrirPorRecibir()

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(within(dialogo).getByRole("button", { name: /confirmar recepción/i }))

    await waitFor(() => expect(Swal.fire.mock.calls.find(([o]) => o?.icon === "error")).toBeTruthy())
    expect(Swal.fire.mock.calls.find(([o]) => o?.icon === "error")[0].text).toMatch(/Comunícate con el administrador/)
  })
})

describe("Traslados: confirmación administrativa", () => {
  it("el administrador en otra ubicación debe escribir el motivo; queda marcada en el historial", async () => {
    const { falso } = await renderRecepcion({ rol: "admin", permisos: [], ubicacion: "bodega" })
    const dialogo = await abrirPorRecibir()

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true, value: " Ruta local no tiene a nadie hoy " })
    fireEvent.click(within(dialogo).getByRole("button", { name: /confirmar recepción/i }))

    await waitFor(() => expect(llamadasA(falso, "confirmar_recepcion_traslado")).toHaveLength(1))
    expect(Swal.fire.mock.calls[0][0]).toMatchObject({ title: "Confirmación administrativa", input: "textarea" })
    expect(Swal.fire.mock.calls[0][0].inputValidator("   ")).toMatch(/5 a 500/)
    expect(llamadasA(falso, "confirmar_recepcion_traslado")[0][1]).toEqual({ p_traslado: "t-pend", p_observacion: "Ruta local no tiene a nadie hoy" })

    await waitFor(() => expect(screen.getAllByText("Confirmación administrativa").length).toBeGreaterThan(0))
    const fila = screen.getAllByRole("row").find((f) => f.textContent.includes("TR-000003"))
    fireEvent.click(within(fila).getByRole("button", { name: /ver detalle/i }))
    const detalle = screen.getByRole("dialog", { name: /detalle del traslado/i })
    expect(within(detalle).getByRole("region", { name: /confirmación administrativa/i })).toHaveTextContent("Ruta local no tiene a nadie hoy")
    expect(within(detalle).queryByRole("button", { name: /confirmar recepción/i })).toBeNull()
  })
})

describe("Traslados: quién no ve acciones de recepción", () => {
  it("quien lo envió no lo tiene por recibir ni ve los botones en el detalle", async () => {
    await renderRecepcion({ permisos: ["inventory-all"], traslados: [{ ...PENDIENTE, usuario_id: "u-prueba" }] })

    await screen.findByRole("table", { name: /historial de traslados/i })
    expect(seccionPorRecibir()).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /ver detalle/i }))
    const dialogo = screen.getByRole("dialog", { name: /detalle del traslado/i })
    expect(within(dialogo).queryByRole("button", { name: /confirmar recepción/i })).toBeNull()
  })

  it("el contador no recibe: sin sección y sin botones", async () => {
    await renderRecepcion({ rol: "contador", permisos: ["inventory-own"] })

    await screen.findByRole("table", { name: /historial de traslados/i })
    expect(seccionPorRecibir()).toBeNull()

    const fila = screen.getAllByRole("row").find((f) => f.textContent.includes("TR-000003"))
    fireEvent.click(within(fila).getByRole("button", { name: /ver detalle/i }))
    expect(within(screen.getByRole("dialog", { name: /detalle del traslado/i })).queryByRole("button", { name: /confirmar recepción/i })).toBeNull()
  })

  it("alguien de otra ubicación no lo tiene por recibir", async () => {
    await renderRecepcion({ ubicacion: "bodega" })

    await screen.findByRole("table", { name: /historial de traslados/i })
    expect(seccionPorRecibir()).toBeNull()
  })
})

describe("Traslados: el historial con la recepción", () => {
  it("recibido con quién y cuándo, pendiente, y el histórico sin receptor inventado", async () => {
    await renderRecepcion()

    const tabla = await screen.findByRole("table", { name: /historial de traslados/i })
    const recepcionDe = (numero) => {
      const fila = within(tabla).getAllByRole("row").find((f) => f.textContent.includes(numero))
      return within(fila).getAllByRole("cell")[6].textContent
    }

    expect(recepcionDe("TR-000002")).toMatch(/^Vendedor Ruta\d{2}\/\d{2}\/\d{4} · /)
    expect(recepcionDe("TR-000003")).toBe("Pendiente")
    expect(recepcionDe("TR-000001")).toBe("Antes del control de recepción")
    expect(within(tabla).getByText("Pendiente de recepción")).toHaveClass("badge-low")
    expect(within(tabla).getByText("Recibido")).toHaveClass("badge-paid")
  })

  it("Recepción en dos líneas: quién recibió arriba, la fecha y la hora debajo; el nombre largo completo y la confirmación administrativa", async () => {
    const LARGO = "María Fernanda de los Ángeles Rodríguez Castellanos"
    const ADMINISTRATIVO = {
      ...RECIBIDO,
      id: "t-adm",
      creado_en: "2026-11-25T16:00:00Z",
      recibido_por_nombre: LARGO,
      recibido_en: "2026-11-25T19:05:00Z",
      confirmacion_administrativa: true,
      observacion_recepcion: "Confirmado por teléfono.",
    }
    await renderRecepcion({ traslados: [ADMINISTRATIVO, RECIBIDO, HISTORICO] })

    const tabla = await screen.findByRole("table", { name: /historial de traslados/i })
    const recepciones = within(tabla).getAllByRole("row").slice(1).map((f) => f.querySelector('[data-etiqueta="Recepción"]'))
    const celdaCon = (texto) => recepciones.find((c) => c.textContent.includes(texto))
    const lineas = (celda) => [...celda.firstElementChild.children].map((e) => e.textContent)
    const cuando = (iso) => `${formatDateForDisplay(new Date(iso))} · ${hora(iso)}`

    expect(lineas(celdaCon(LARGO))).toEqual([LARGO, cuando("2026-11-25T19:05:00Z"), "Confirmación administrativa"])
    expect(lineas(celdaCon("Vendedor Ruta"))).toEqual(["Vendedor Ruta", cuando("2026-11-25T15:20:00Z")])
    expect(cuando("2026-11-25T15:20:00Z")).toMatch(/^\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}\s[ap]\.\s?m\.$/u)
    expect(celdaCon("Antes del control")).toHaveTextContent(/^Antes del control de recepción$/)
  })
})
