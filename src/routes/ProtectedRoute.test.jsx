import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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

const Pantalla = ({ nombre }) => <h1>{nombre}</h1>

async function renderEnRuta(rutaInicial) {
  const { AuthProvider } = await import("../context/AuthContext")
  const ProtectedRoute = (await import("./ProtectedRoute")).default

  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[rutaInicial]}>
        <Routes>
          <Route path="/login" element={<Pantalla nombre="Pantalla de login" />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute permission={PERMISSIONS.DASHBOARD}>
                <Pantalla nombre="Dashboard" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pos"
            element={
              <ProtectedRoute permission={PERMISSIONS.POS}>
                <Pantalla nombre="Facturar" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute permission={PERMISSIONS.SETTINGS}>
                <Pantalla nombre="Configuración" />
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )

  await waitFor(() =>
    expect(screen.queryByText(/comprobando tu sesión/i)).not.toBeInTheDocument()
  )
}

beforeEach(() => {
  vi.resetModules()
})

describe("ProtectedRoute sin sesión", () => {
  beforeEach(() => {
    montarSupabaseFalso()
  })

  it("manda al login", async () => {
    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument()
  })

  it("no filtra el contenido protegido", async () => {
    await renderEnRuta("/dashboard")

    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument()
  })
})

describe("ProtectedRoute mientras se comprueba la sesión", () => {
  it("espera en vez de expulsar al login", async () => {
    montarSupabaseFalso({
      usuarios: [usuarioDePrueba()],
      permisos: permisosDe("u-1", [PERMISSIONS.DASHBOARD]),
      sesionInicial: sesionDe("auth-1"),
    })

    const { AuthProvider } = await import("../context/AuthContext")
    const ProtectedRoute = (await import("./ProtectedRoute")).default

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="/login" element={<Pantalla nombre="Pantalla de login" />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute permission={PERMISSIONS.DASHBOARD}>
                  <Pantalla nombre="Dashboard" />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    )

    // En el primer render la sesión aún no se resolvió: no debe haber
    // mandado al login todavía.
    expect(screen.queryByText("Pantalla de login")).not.toBeInTheDocument()
    expect(screen.getByText(/comprobando tu sesión/i)).toBeInTheDocument()

    await waitFor(() =>
      expect(screen.getByText("Dashboard")).toBeInTheDocument()
    )
  })
})

describe("ProtectedRoute con sesión", () => {
  it("deja pasar cuando el usuario tiene el permiso", async () => {
    montarSupabaseFalso({
      usuarios: [usuarioDePrueba()],
      permisos: permisosDe("u-1", [PERMISSIONS.DASHBOARD]),
      sesionInicial: sesionDe("auth-1"),
    })

    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Dashboard")).toBeInTheDocument()
  })

  it("desvía a la primera página habilitada cuando falta el permiso", async () => {
    montarSupabaseFalso({
      usuarios: [usuarioDePrueba()],
      permisos: permisosDe("u-1", [PERMISSIONS.POS]),
      sesionInicial: sesionDe("auth-1"),
    })

    await renderEnRuta("/settings")

    expect(await screen.findByText("Facturar")).toBeInTheDocument()
    expect(screen.queryByText("Configuración")).not.toBeInTheDocument()
  })

  it("el administrador entra a todo", async () => {
    montarSupabaseFalso({
      usuarios: [usuarioDePrueba({ rol: "admin" })],
      permisos: [],
      sesionInicial: sesionDe("auth-1"),
    })

    await renderEnRuta("/settings")

    expect(await screen.findByText("Configuración")).toBeInTheDocument()
  })

  it("muestra la pantalla de sin acceso cuando no tiene ninguna página", async () => {
    montarSupabaseFalso({
      usuarios: [usuarioDePrueba()],
      permisos: [],
      sesionInicial: sesionDe("auth-1"),
    })

    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Sin acceso")).toBeInTheDocument()
  })

  it("un usuario desactivado va al login", async () => {
    montarSupabaseFalso({
      usuarios: [usuarioDePrueba({ activo: false })],
      permisos: permisosDe("u-1", [PERMISSIONS.DASHBOARD]),
      sesionInicial: sesionDe("auth-1"),
    })

    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument()
  })

  it("una cuenta sin invitación va al login", async () => {
    montarSupabaseFalso({
      usuarios: [],
      permisos: [],
      sesionInicial: sesionDe("auth-desconocido"),
    })

    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument()
  })
})
