import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"

import {
  montarSupabaseFalso,
  usuarioDePrueba,
  permisosDe,
  sesionDe,
} from "../test/auth"

import { PERMISSIONS } from "../context/permissions"

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

const FERRETERIA = { name: "Ferretería de prueba" }

async function renderNavbar({
  rol = "vendedor",
  secciones = [],
  empresa = FERRETERIA,
} = {}) {
  montarSupabaseFalso({
    usuarios: [usuarioDePrueba({ rol, nombre: "María Vendedora" })],
    permisos: permisosDe("u-1", secciones),
    sesionInicial: sesionDe("auth-1"),
  })

  /*
    Los tres se importan después de resetModules y no arriba: con el
    registro de módulos reiniciado, un contexto importado antes es otro
    objeto distinto del que Navbar consume, y el proveedor no lo alcanza.
  */
  const { AuthProvider } = await import("../context/AuthContext")
  const { ProductContext } = await import("../context/contexts")
  const Navbar = (await import("./Navbar")).default

  render(
    <AuthProvider>
      <ProductContext.Provider value={{ company: empresa }}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="/dashboard" element={<Navbar />} />
            <Route path="/login" element={<h1>Pantalla de login</h1>} />
          </Routes>
        </MemoryRouter>
      </ProductContext.Provider>
    </AuthProvider>
  )

  await screen.findByText("María Vendedora")
}

const enlaces = () =>
  screen.queryAllByRole("link").map((a) => a.getAttribute("href"))

describe("Navbar", () => {
  it("muestra el nombre de la ferretería que trae la base", async () => {
    await renderNavbar({ secciones: [PERMISSIONS.DASHBOARD] })

    expect(screen.getByText("Ferretería de prueba")).toBeInTheDocument()
  })

  /*
    Antes el nombre estaba escrito en el código, así que toda ferretería
    veía el de la primera. Sin datos cargados se muestra el del sistema y
    no el de nadie.
  */
  it("sin datos de la ferretería no muestra el nombre de otra", async () => {
    await renderNavbar({ secciones: [PERMISSIONS.DASHBOARD], empresa: null })

    expect(screen.getByText("Sistema Ferretería")).toBeInTheDocument()
  })

  it("muestra el nombre del usuario en sesión", async () => {
    await renderNavbar({ secciones: [PERMISSIONS.DASHBOARD] })

    expect(screen.getByText("María Vendedora")).toBeInTheDocument()
  })

  it("el administrador ve todas las secciones", async () => {
    await renderNavbar({ rol: "admin", secciones: [] })

    expect(enlaces()).toContain("/settings")
    expect(enlaces()).toContain("/pos")
    expect(enlaces()).toContain("/products")
  })

  it("el vendedor solo ve las secciones habilitadas", async () => {
    await renderNavbar({
      secciones: [PERMISSIONS.POS, PERMISSIONS.SALES_HISTORY],
    })

    expect(enlaces()).toContain("/pos")
    expect(enlaces()).toContain("/sales-history")
    expect(enlaces()).not.toContain("/settings")
    expect(enlaces()).not.toContain("/products")
  })

  it("no muestra ninguna sección a un usuario sin permisos", async () => {
    await renderNavbar({ secciones: [] })

    expect(enlaces()).toHaveLength(0)
  })

  it("cerrar sesión lleva al login", async () => {
    await renderNavbar({ secciones: [PERMISSIONS.DASHBOARD] })

    fireEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }))

    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument()
  })

  it("cerrar sesión avisa a Supabase", async () => {
    await renderNavbar({ secciones: [PERMISSIONS.DASHBOARD] })

    fireEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }))

    await waitFor(() =>
      expect(globalThis.__supabaseFalso.auth.signOut).toHaveBeenCalled()
    )
  })
})
