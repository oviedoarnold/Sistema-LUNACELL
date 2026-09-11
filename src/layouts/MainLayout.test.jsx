import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

import {
  montarSupabaseFalso,
  usuarioDePrueba,
  permisosDe,
  sesionDe,
} from "../test/auth"

import { PERMISSIONS } from "../context/permissions"

/*
  El armazón es quien conecta las dos barras: el cajón lo abre la de
  arriba y lo cierra la de al lado, y ninguna es padre de la otra. Estas
  pruebas cubren ese enlace, que es lo único que MainLayout decide.
*/

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

beforeEach(() => {
  vi.resetModules()
})

async function montarLayout() {
  montarSupabaseFalso({
    usuarios: [usuarioDePrueba({ rol: "admin", nombre: "Arnold Oviedo" })],
    permisos: permisosDe("u-1", Object.values(PERMISSIONS)),
    sesionInicial: sesionDe("auth-1"),
  })

  const { AuthProvider } = await import("../context/AuthContext")
  const MainLayout = (await import("./MainLayout")).default

  render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <MainLayout>
          <p>Contenido de la página</p>
        </MainLayout>
      </MemoryRouter>
    </AuthProvider>
  )

  await screen.findByText("Arnold Oviedo")
}

const armazon = () => document.querySelector(".app-shell")
const abrir = () =>
  fireEvent.click(screen.getByRole("button", { name: /abrir menú/i }))

describe("MainLayout", () => {
  it("monta la navegación, la barra superior y el contenido", async () => {
    await montarLayout()

    expect(screen.getByLabelText("Navegación principal")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument()
    expect(screen.getByText("Contenido de la página")).toBeInTheDocument()
  })

  it("arranca con el cajón cerrado", async () => {
    await montarLayout()

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  it("el botón de menú lo abre", async () => {
    await montarLayout()

    abrir()

    expect(armazon()).toHaveClass("menu-abierto")
  })

  it("el botón de cerrar de la navegación lo cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.click(screen.getByRole("button", { name: /cerrar menú/i }))

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  it("pulsar en la capa que tapa el contenido lo cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.click(document.querySelector(".app-overlay"))

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  it("Escape lo cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.keyDown(document, { key: "Escape" })

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  it("elegir un módulo lo cierra", async () => {
    await montarLayout()

    abrir()
    fireEvent.click(screen.getByRole("link", { name: /proveedores/i }))

    expect(armazon()).not.toHaveClass("menu-abierto")
  })

  /*
    Escape no debe seguir escuchándose con el cajón cerrado: la tecla la
    usan también los diálogos de las páginas.
  */
  it("con el cajón cerrado, Escape no cambia nada", async () => {
    await montarLayout()

    fireEvent.keyDown(document, { key: "Escape" })

    expect(armazon()).not.toHaveClass("menu-abierto")
  })
})
