import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthContext, SinConexionContext } from "../../context/contexts"
import Sidebar from "./Sidebar"

/*
  Cerrar sesión con ventas guardadas solo en el teléfono: no se borran,
  pero se avisa antes, y sin conexión además que no podrá volver a entrar.
*/

function montar({ sinConfirmar = 0, conexion = "en_linea" } = {}) {
  const logout = vi.fn(async () => {})
  const auth = { user: { name: "Vendedor Camión", role: "vendedor" }, logout, hasPermission: () => true }

  render(
    <AuthContext.Provider value={auth}>
      <SinConexionContext.Provider value={{ sinConfirmar, conexion }}>
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      </SinConexionContext.Provider>
    </AuthContext.Provider>
  )

  return { logout }
}

const cerrarSesion = () => fireEvent.click(screen.getByRole("button", { name: /cerrar sesión/i }))

beforeEach(() => {
  Swal.fire.mockClear()
})

describe("cerrar sesión con ventas sin sincronizar", () => {
  it("avisa antes y, si el vendedor vuelve, no cierra la sesión", async () => {
    const { logout } = montar({ sinConfirmar: 2, conexion: "sin_red" })

    cerrarSesion()

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())
    const aviso = Swal.fire.mock.calls[0][0]
    expect(aviso.title).toBe("Hay ventas sin sincronizar")
    expect(aviso.text).toMatch(/2 ventas guardadas solo en este teléfono/)
    expect(aviso.text).toMatch(/no se borran/i)
    expect(aviso.text).toMatch(/sin conexión no podrás volver a entrar/i)
    expect(logout).not.toHaveBeenCalled()
  })

  it("si confirma, cierra la sesión", async () => {
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    const { logout } = montar({ sinConfirmar: 1 })

    cerrarSesion()

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
  })

  it("sin ventas pendientes cierra sin preguntar", async () => {
    const { logout } = montar()

    cerrarSesion()

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    expect(Swal.fire).not.toHaveBeenCalled()
  })
})
