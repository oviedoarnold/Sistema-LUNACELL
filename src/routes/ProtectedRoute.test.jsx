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
            path="/locations"
            element={
              <ProtectedRoute permission={PERMISSIONS.LOCATIONS}>
                <Pantalla nombre="Ubicaciones" />
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

/*
  Monta el doble con una sesión ya abierta.

  Todas las pruebas de aquí abajo necesitaban el mismo bloque de tres
  líneas —el usuario invitado, sus permisos y la sesión— y solo cambiaban
  en qué secciones tiene habilitadas. Con el bloque repetido, lo que cada
  prueba comprueba de verdad quedaba enterrado entre el andamiaje.

  Los rasgos del usuario (rol, activo) pasan tal cual a usuarioDePrueba,
  así que la prueba que los necesita los sigue declarando a la vista.
*/
function entrarComo({ secciones = [], ...rasgos } = {}) {
  montarSupabaseFalso({
    usuarios: [usuarioDePrueba(rasgos)],
    permisos: permisosDe("u-1", secciones),
    sesionInicial: sesionDe("auth-1"),
  })
}

describe("ProtectedRoute sin sesión", () => {
  beforeEach(() => {
    montarSupabaseFalso()
  })

  it("manda al login", async () => {
    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument()
  })

  it("también manda al login desde Ubicaciones", async () => {
    await renderEnRuta("/locations")

    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument()
  })

  it("no filtra el contenido protegido", async () => {
    await renderEnRuta("/dashboard")

    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument()
  })
})

describe("ProtectedRoute mientras se comprueba la sesión", () => {
  it("espera en vez de expulsar al login", async () => {
    entrarComo({ secciones: [PERMISSIONS.DASHBOARD] })

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
    entrarComo({ secciones: [PERMISSIONS.DASHBOARD] })

    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Dashboard")).toBeInTheDocument()
  })

  it("desvía a la primera página habilitada cuando falta el permiso", async () => {
    entrarComo({ secciones: [PERMISSIONS.POS] })

    await renderEnRuta("/settings")

    expect(await screen.findByText("Facturar")).toBeInTheDocument()
    expect(screen.queryByText("Configuración")).not.toBeInTheDocument()
  })

  it("el administrador entra a todo", async () => {
    entrarComo({ rol: "admin" })

    await renderEnRuta("/settings")

    expect(await screen.findByText("Configuración")).toBeInTheDocument()
  })

  it("muestra la pantalla de sin acceso cuando no tiene ninguna página", async () => {
    entrarComo()

    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Sin acceso")).toBeInTheDocument()
  })

  it("un usuario desactivado va al login", async () => {
    entrarComo({ activo: false, secciones: [PERMISSIONS.DASHBOARD] })

    await renderEnRuta("/dashboard")

    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument()
  })

  it("deja entrar a Ubicaciones a quien tiene el permiso", async () => {
    entrarComo({ secciones: [PERMISSIONS.LOCATIONS] })

    await renderEnRuta("/locations")

    expect(await screen.findByText("Ubicaciones")).toBeInTheDocument()
  })

  /*
    Ubicaciones no es una excepción: se comporta como cualquier otra
    sección privada, y quien no la tenga habilitada no la ve.
  */
  it("desvía fuera de Ubicaciones a quien no tiene el permiso", async () => {
    entrarComo({ secciones: [PERMISSIONS.POS] })

    await renderEnRuta("/locations")

    expect(await screen.findByText("Facturar")).toBeInTheDocument()
    expect(screen.queryByText("Ubicaciones")).not.toBeInTheDocument()
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
