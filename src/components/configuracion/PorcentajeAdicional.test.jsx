import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import Swal from "sweetalert2"

import { AuthProvider } from "../../context/AuthContext"
import ProductProvider from "../../context/ProductContext"
import { renderizarPantalla } from "../../test/pantallas"
import PorcentajeAdicional from "./PorcentajeAdicional"

vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

vi.mock("sweetalert2", () => ({ default: { fire: vi.fn(() => Promise.resolve({ isConfirmed: true })) } }))

const HISTORIAL = [
  {
    id: 1,
    medio: "tarjeta",
    tasa_anterior: 7,
    tasa_nueva: 1.7,
    cambiado_por_nombre: "Migración 0044",
    cambiado_en: "2026-11-16T14:00:00.000Z",
  },
]

function renderSeccion(opciones = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <ProductProvider>
        <PorcentajeAdicional />
      </ProductProvider>
    </AuthProvider>,
    { tablasExtra: { cambios_de_cargo_por_medio: [...HISTORIAL] }, ...opciones }
  )
}

const campo = (medio) => screen.getByLabelText(`${medio} (%)`)
const escribir = (medio, valor) => fireEvent.change(campo(medio), { target: { value: valor } })
const guardar = () => screen.getByRole("button", { name: /guardar porcentajes/i })
const llamadas = (falso) => falso.rpc.mock.calls.filter(([n]) => n === "configurar_cargos_por_medio")

beforeEach(() => {
  Swal.fire.mockClear()
  Swal.fire.mockImplementation(() => Promise.resolve({ isConfirmed: true }))
})

describe("Configuración: porcentaje adicional por medio de pago", () => {
  it("muestra el porcentaje vigente de tarjeta y enlace, y sin cambios no se guarda", async () => {
    await renderSeccion()

    await waitFor(() => expect(campo("Tarjeta")).toHaveValue("1.7"))
    expect(campo("Enlace de pago")).toHaveValue("1.7")
    expect(guardar()).toBeDisabled()
  })

  it("el administrador cambia uno, confirma, y queda guardado y en el historial", async () => {
    const { falso } = await renderSeccion()

    await waitFor(() => expect(campo("Tarjeta")).toHaveValue("1.7"))
    escribir("Tarjeta", "2")
    fireEvent.click(guardar())

    await waitFor(() => expect(llamadas(falso)).toHaveLength(1))
    expect(Swal.fire.mock.calls[0][0].text).toMatch(/tarjeta: 1\.7 % → 2 %\. se aplica a las ventas y abonos que se cobren desde ahora/i)
    expect(llamadas(falso)[0][1]).toEqual({ p_tarjeta: 2, p_enlace: 1.7 })
    expect(falso.datos.empresas[0]).toMatchObject({ tasa_cargo_tarjeta: 2, tasa_cargo_enlace: 1.7 })

    await waitFor(() => expect(screen.getByText("Tarjeta: 1.7 % → 2 %")).toBeInTheDocument())
    expect(screen.getByText("Tarjeta: 7 % → 1.7 %")).toBeInTheDocument()
    expect(campo("Tarjeta")).toHaveValue("2")
    expect(guardar()).toBeDisabled()
  })

  it("acepta coma decimal y cambia los dos de forma independiente", async () => {
    const { falso } = await renderSeccion()

    await waitFor(() => expect(campo("Tarjeta")).toHaveValue("1.7"))
    escribir("Tarjeta", "2")
    escribir("Enlace de pago", "1,5")
    fireEvent.click(guardar())

    await waitFor(() => expect(llamadas(falso)).toHaveLength(1))
    expect(llamadas(falso)[0][1]).toEqual({ p_tarjeta: 2, p_enlace: 1.5 })
  })

  it("si no se confirma, no se guarda nada", async () => {
    const { falso } = await renderSeccion()

    Swal.fire.mockImplementation(() => Promise.resolve({ isConfirmed: false }))
    await waitFor(() => expect(campo("Tarjeta")).toHaveValue("1.7"))
    escribir("Tarjeta", "2")
    fireEvent.click(guardar())

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())
    expect(llamadas(falso)).toHaveLength(0)
    expect(falso.datos.empresas[0].tasa_cargo_tarjeta).toBe(1.7)
  })

  it.each([["150"], ["-1"], ["1.755"], ["abc"], [""]])("rechaza «%s» sin enviarlo", async (valor) => {
    const { falso } = await renderSeccion()

    await waitFor(() => expect(campo("Tarjeta")).toHaveValue("1.7"))
    escribir("Tarjeta", valor)
    fireEvent.click(guardar())

    await waitFor(() => expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: "Porcentaje inválido" })))
    expect(campo("Tarjeta")).toHaveAttribute("aria-invalid", "true")
    expect(llamadas(falso)).toHaveLength(0)
  })

  it("descartar devuelve lo guardado", async () => {
    await renderSeccion()

    await waitFor(() => expect(campo("Tarjeta")).toHaveValue("1.7"))
    escribir("Tarjeta", "3")
    fireEvent.click(screen.getByRole("button", { name: /descartar cambios/i }))

    expect(campo("Tarjeta")).toHaveValue("1.7")
  })

  it.each([["vendedor"], ["contador"]])("el %s ve el porcentaje vigente pero no puede cambiarlo", async (rol) => {
    const { falso } = await renderSeccion({ rolDelUsuario: rol, permisosDelUsuario: ["settings"] })

    await waitFor(() => expect(campo("Tarjeta")).toHaveValue("1.7"))
    expect(campo("Tarjeta")).toHaveAttribute("readonly")
    expect(campo("Enlace de pago")).toHaveAttribute("readonly")
    expect(screen.queryByRole("button", { name: /guardar porcentajes/i })).not.toBeInTheDocument()
    expect(screen.getByText("Solo un administrador puede cambiarlos.")).toBeInTheDocument()
    expect(screen.queryByText(/últimos cambios/i)).not.toBeInTheDocument()
    expect(llamadas(falso)).toHaveLength(0)
  })

  it("si la base lo rechaza, lo dice y el porcentaje no cambia", async () => {
    const { falso } = await renderSeccion({
      fallarEn: { configurar_cargos_por_medio: { code: "42501", message: "Solo un administrador cambia el porcentaje adicional" } },
    })

    await waitFor(() => expect(campo("Tarjeta")).toHaveValue("1.7"))
    escribir("Tarjeta", "2")
    fireEvent.click(guardar())

    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No se guardó el porcentaje", text: "Solo un administrador cambia el porcentaje adicional." })
      )
    )
    expect(falso.datos.empresas[0].tasa_cargo_tarjeta).toBe(1.7)
  })
})
