import { describe, it, expect, vi } from "vitest"
import { act, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import { AuthProvider } from "../../context/AuthContext"
import { renderizarPantalla } from "../../test/pantallas"
import { avisarCambioDeTraslados } from "../../hooks/useTrasladosPorRecibir"
import Sidebar from "../shell/Sidebar"
import AvisoDeRecepciones from "./AvisoDeRecepciones"

vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  El aviso del POS y el contador del menú (0056): cuentan los traslados que
  el usuario puede recibir, en singular o en plural, y desaparecen cuando no
  queda nada por recibir. Solo informan: no tocan la venta.
*/

const UBICACIONES = [
  { id: "bodega", name: "Lunacell Bodega", type: "bodega" },
  { id: "store", name: "Ruta local", type: "camion" },
]

const pendiente = (id, cambios = {}) => ({
  id,
  origen_id: "bodega",
  destino_id: "store",
  usuario_id: "u-gladys",
  estado: "pendiente",
  unidades: 1,
  creado_en: `2026-11-26T15:4${id.slice(-1)}:00Z`,
  renglones: [{ producto_id: "p1", cantidad: 1 }],
  ...cambios,
})

const montar = (ui, { traslados, rol = "vendedor", permisos = ["inventory-own", "pos"], ubicacion = "store" }) =>
  renderizarPantalla(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
    {
      productos: [{ id: "p1", code: "C-1", name: "Cargador", category: "Accesorios", price: 120, stock: 10, minStock: 1 }],
      ubicaciones: UBICACIONES,
      rolDelUsuario: rol,
      permisosDelUsuario: permisos,
      ubicacionOperativa: ubicacion,
      otrosUsuarios: [{ id: "u-gladys", nombre: "Gladys Luna", ubicacion_id: "bodega" }],
      traslados,
    }
  )

describe("aviso de recepciones en el POS", () => {
  it("en singular, con enlace a Traslados", async () => {
    await montar(<AvisoDeRecepciones />, { traslados: [pendiente("t1")] })

    const aviso = await screen.findByRole("status")
    expect(aviso).toHaveTextContent("Tienes 1 traslado por recibir.")
    expect(within(aviso).getByRole("link", { name: "Ver traslado" })).toHaveAttribute("href", "/inventory/transfers")
  })

  it("en plural, contando también los que tienen incidencia", async () => {
    await montar(<AvisoDeRecepciones />, { traslados: [pendiente("t1"), pendiente("t2", { estado: "con_incidencia", incidencia: "Falta uno" })] })

    const aviso = await screen.findByRole("status")
    expect(aviso).toHaveTextContent("Tienes 2 traslados por recibir.")
    expect(within(aviso).getByRole("link", { name: "Ver traslados" })).toBeInTheDocument()
  })

  it("no aparece sin nada por recibir, ni con lo ya recibido o lo que envió él mismo", async () => {
    await montar(<AvisoDeRecepciones />, {
      traslados: [pendiente("t1", { estado: "recibido" }), pendiente("t2", { usuario_id: "u-prueba" }), pendiente("t3", { destino_id: "bodega" })],
    })

    expect(screen.queryByRole("status")).toBeNull()
  })

  it("desaparece cuando se confirma la recepción", async () => {
    const { falso } = await montar(<AvisoDeRecepciones />, { traslados: [pendiente("t1")] })
    await screen.findByRole("status")

    falso.datos.traslados[0].estado = "recibido"
    act(() => avisarCambioDeTraslados())

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull())
  })

  it("el contador no recibe: no hay aviso", async () => {
    await montar(<AvisoDeRecepciones />, { traslados: [pendiente("t1")], rol: "contador", permisos: ["inventory-own"] })

    expect(screen.queryByRole("status")).toBeNull()
  })
})

describe("contador del menú Traslados", () => {
  it("muestra cuántos hay por recibir junto a Traslados", async () => {
    await montar(<Sidebar />, { traslados: [pendiente("t1"), pendiente("t2")] })

    const enlace = await screen.findByRole("link", { name: /traslados/i })
    await waitFor(() => expect(enlace).toHaveTextContent("Traslados2, 2 por recibir"))
  })

  it("sin pendientes, Traslados va sin contador", async () => {
    await montar(<Sidebar />, { traslados: [] })

    const enlace = await screen.findByRole("link", { name: /traslados/i })
    expect(enlace).toHaveTextContent(/^Traslados$/)
  })
})
