import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"

import { AuthContext } from "../context/contexts"
import { PERMISSIONS } from "../context/permissions"
import ProtectedRoute from "./ProtectedRoute"

/*
  Con el perfil sin conexión solo se puede facturar (AuthContext restringe
  los permisos). Quien no tiene el POS no ve «no tienes ninguna sección»,
  que sería falso: se le dice que sin conexión solo se factura.
*/
function montar({ permisos }) {
  const auth = {
    user: { name: "Bodeguero", role: "vendedor", sinConexion: true, permissions: [] },
    cargando: false,
    hasPermission: (permiso) => permisos.includes(permiso),
    logout: vi.fn(),
  }

  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute permission={PERMISSIONS.DASHBOARD}>
                <h1>Dashboard</h1>
              </ProtectedRoute>
            }
          />
          <Route
            path="/pos"
            element={
              <ProtectedRoute permission={PERMISSIONS.POS}>
                <h1>Facturar</h1>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

describe("rutas con el perfil sin conexión", () => {
  it("lleva al POS, la única pantalla que funciona sin conexión", () => {
    montar({ permisos: [PERMISSIONS.POS] })

    expect(screen.getByRole("heading", { name: "Facturar" })).toBeInTheDocument()
  })

  it("sin permiso de POS explica que sin conexión solo se factura", () => {
    montar({ permisos: [] })

    expect(screen.getByText(/sin conexión solo se puede facturar/i)).toBeInTheDocument()
  })
})
