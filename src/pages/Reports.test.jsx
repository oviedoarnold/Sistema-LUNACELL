import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor, within } from "@testing-library/react"

import { AuthProvider } from "../context/AuthContext"
import LocationsProvider from "../context/LocationsContext"
import { hoyEnHonduras } from "../utils/reporteDiario"
import { renderizarPantalla } from "../test/pantallas"
import { REPORTE, REPORTE_VACIO } from "../test/reporteDePrueba"
import Reports from "./Reports"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const UBICACIONES = [
  { id: "camion-1", name: "Camión 01", type: "camion" },
  { id: "camion-2", name: "Camión 02", type: "camion" },
]

const montar = ({
  responder = () => ({ data: REPORTE, error: null }),
  responderMedios = () => ({ data: REPORTE.medios, error: null }),
  ...extra
} = {}) => {
  const reporteDiario = vi.fn(responder)
  const medios = vi.fn(responderMedios)

  return renderizarPantalla(
    <AuthProvider><LocationsProvider><Reports /></LocationsProvider></AuthProvider>,
    {
      ubicaciones: UBICACIONES,
      esperar: ["ubicaciones"],
      rpcsExtra: { reporte_diario: reporteDiario, reporte_medios_de_pago: medios },
      ...extra,
    }
  ).then((resultado) => ({ ...resultado, reporteDiario, medios }))
}

describe("Reportes: el administrador", () => {
  it("pide el día de hoy en Honduras y todas las ubicaciones", async () => {
    const { reporteDiario } = await montar()

    await waitFor(() => expect(reporteDiario).toHaveBeenCalled())

    expect(reporteDiario).toHaveBeenCalledWith({ p_dia: hoyEnHonduras(), p_ubicacion: null }, expect.anything())
    expect(screen.getByLabelText("Día")).toHaveValue(hoyEnHonduras())
    expect(screen.getByLabelText("Ubicación")).toHaveValue("")
  })

  it("muestra los indicadores que calculó la base, sin recalcularlos", async () => {
    await montar()

    const indicadores = await screen.findByRole("region", { name: /indicadores del día/i })

    expect(within(indicadores).getByText("Ventas válidas").closest(".stat-card")).toHaveTextContent("L 345.10")
    expect(within(indicadores).getByText("Ticket promedio").closest(".stat-card")).toHaveTextContent("L 172.55")
    expect(within(indicadores).getByText("Cobros recibidos").closest(".stat-card")).toHaveTextContent("L 165.00")
    expect(within(indicadores).getByText("Abonos cobrados").closest(".stat-card")).toHaveTextContent("L 50.00")
    expect(within(indicadores).getByText("Anulaciones del día").closest(".stat-card")).toHaveTextContent("L 80.00")
  })

  it("muestra todas las tablas, y las anuladas con su estado", async () => {
    await montar()

    for (const titulo of [
      "Ventas por ubicación", "Ventas por vendedor", "Detalle de operaciones",
      "Abonos cobrados", "Anulaciones", "Resumen de movimientos de inventario", "Movimientos de inventario",
    ]) {
      expect(await screen.findByRole("heading", { name: titulo })).toBeInTheDocument()
    }

    expect(screen.getByRole("cell", { name: "Anulada" })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "Pagada (Sin conexión)" })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "1 x Cargador, 2 x Cubo" })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/costo|margen|utilidad/i)
  })

  it("muestra los cobros por medio y por ubicación, sin inventar el medio de lo anterior", async () => {
    const { medios } = await montar()

    const seccion = (await screen.findByRole("heading", { name: "Cobros por medio de pago" })).closest("section")

    expect(medios).toHaveBeenCalledWith({ p_dia: hoyEnHonduras(), p_ubicacion: null }, expect.anything())
    expect(within(seccion).getByRole("cell", { name: "Tarjeta" })).toBeInTheDocument()
    expect(within(seccion).getByRole("cell", { name: "Sin registrar" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Cobros por ubicación y medio de pago" })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "Efectivo 15.00, Tarjeta 100.00 (AUT-9)" })).toBeInTheDocument()

    const indicadores = screen.getByRole("region", { name: /indicadores del día/i })

    expect(within(indicadores).getByText("Cargos por medio de pago").closest(".stat-card")).toHaveTextContent("L 7.00")
    expect(within(indicadores).getByText("Total cobrado con cargos").closest(".stat-card")).toHaveTextContent("L 172.00")
  })

  it("si fallan los medios no muestra un reporte a medias", async () => {
    await montar({ responderMedios: () => ({ data: null, error: { code: "XX000", message: "fallo" } }) })

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el reporte.")
    expect(screen.queryByRole("region", { name: /indicadores del día/i })).not.toBeInTheDocument()
  })

  it("avisa de las ventas por conciliar, que no están en las cifras", async () => {
    await montar()

    expect(await screen.findByText(/1 venta de este día por conciliar/i)).toBeInTheDocument()
  })

  it("al cambiar la ubicación o el día vuelve a preguntar, y no deja ver las cifras anteriores", async () => {
    const { reporteDiario } = await montar()

    await screen.findByRole("region", { name: /indicadores del día/i })

    reporteDiario.mockImplementation(() => new Promise(() => {}))
    fireEvent.change(screen.getByLabelText("Ubicación"), { target: { value: "camion-2" } })

    expect(screen.queryByRole("region", { name: /indicadores del día/i })).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(/cargando el reporte/i)
    await waitFor(() => expect(reporteDiario).toHaveBeenLastCalledWith({ p_dia: hoyEnHonduras(), p_ubicacion: "camion-2" }, expect.anything()))

    fireEvent.change(screen.getByLabelText("Día"), { target: { value: "2026-03-10" } })
    await waitFor(() => expect(reporteDiario).toHaveBeenLastCalledWith({ p_dia: "2026-03-10", p_ubicacion: "camion-2" }, expect.anything()))
  })

  it("un día sin datos lo dice en cada tabla", async () => {
    await montar({ responder: () => ({ data: REPORTE_VACIO, error: null }) })

    expect(await screen.findByText("No hay ventas registradas este día.")).toBeInTheDocument()
    expect(screen.getByText("No se anularon ventas este día.")).toBeInTheDocument()
  })

  it("si falla, dice el motivo sin cifras y permite reintentar", async () => {
    const { reporteDiario } = await montar({
      responder: () => ({ data: null, error: { code: "XX000", message: "fallo" } }),
    })

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el reporte.")
    expect(screen.queryByRole("region", { name: /indicadores del día/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "CSV" })).toBeDisabled()

    reporteDiario.mockImplementation(() => ({ data: REPORTE, error: null }))
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }))

    expect(await screen.findByRole("region", { name: /indicadores del día/i })).toBeInTheDocument()
  })

  it("si la base lo rechaza, dice que es solo para administradores", async () => {
    await montar({ responder: () => ({ data: null, error: { code: "42501", message: "rechazo" } }) })

    expect(await screen.findByRole("alert")).toHaveTextContent(/solo para administradores/i)
  })

  it("exporta el CSV con el nombre de la ubicación elegida", async () => {
    const crear = vi.fn(() => "blob:reporte")
    const revocar = vi.fn()
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: crear, revokeObjectURL: revocar }))

    await montar()
    await screen.findByRole("region", { name: /indicadores del día/i })

    fireEvent.change(screen.getByLabelText("Ubicación"), { target: { value: "camion-1" } })
    await screen.findByRole("region", { name: /indicadores del día/i })
    fireEvent.click(screen.getByRole("button", { name: "CSV" }))

    expect(clic).toHaveBeenCalled()

    const blob = crear.mock.calls[0][0]
    const contenido = await new Promise((resolver) => {
      const lector = new FileReader()

      lector.onload = () => resolver(lector.result)
      lector.readAsText(blob)
    })

    expect(contenido).toContain("Ubicación,Camión 01")
    expect(contenido).toContain("Ventas válidas,345.10")

    clic.mockRestore()
    vi.unstubAllGlobals()
  })
})

describe("Reportes: los demás roles", () => {
  it.each([
    ["vendedor con Configuración", { rolDelUsuario: "vendedor", permisosDelUsuario: ["settings"] }],
    ["contador", { rolDelUsuario: "contador", permisosDelUsuario: ["sales-history", "settings"] }],
  ])("%s: no ve el reporte y ni siquiera se le pregunta a la base", async (_, rol) => {
    const { reporteDiario, medios } = await montar(rol)

    expect(await screen.findByText("Solo para administradores")).toBeInTheDocument()
    expect(screen.queryByLabelText("Día")).not.toBeInTheDocument()
    expect(reporteDiario).not.toHaveBeenCalled()
    expect(medios).not.toHaveBeenCalled()
  })
})
