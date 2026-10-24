import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import Swal from "sweetalert2"

import { AuthContext, SinConexionContext } from "../../context/contexts"
import MenuDeCuenta from "./MenuDeCuenta"

/*
  La cuenta y el cierre de sesión en la barra superior, para el teléfono:
  al pie del cajón quedaban detrás de la barra del navegador. Cierra la
  sesión igual que la barra lateral, con el mismo aviso si hay ventas
  guardadas solo en el teléfono.
*/

function montar({ sinConfirmar = 0, conexion = "en_linea", user = { name: "Vendedor Camión", role: "vendedor" } } = {}) {
  const logout = vi.fn(async () => {})

  render(
    <AuthContext.Provider value={{ user, logout, hasPermission: () => true }}>
      <SinConexionContext.Provider value={{ sinConfirmar, conexion }}>
        <MemoryRouter initialEntries={["/pos"]}>
          <Routes>
            <Route path="/pos" element={<><MenuDeCuenta /><p>Fuera del menú</p></>} />
            <Route path="/login" element={<p>Pantalla de login</p>} />
          </Routes>
        </MemoryRouter>
      </SinConexionContext.Provider>
    </AuthContext.Provider>
  )

  return { logout }
}

const boton = () => screen.getByRole("button", { name: /cuenta de vendedor camión/i })
const abrir = () => fireEvent.click(boton())
const salir = () => fireEvent.click(screen.getByRole("button", { name: /^cerrar sesión$/i }))

beforeEach(() => {
  Swal.fire.mockClear()
})

describe("MenuDeCuenta", () => {
  it("muestra las iniciales y arranca cerrado", () => {
    montar()

    expect(boton()).toHaveTextContent("VC")
    expect(boton()).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: /^cerrar sesión$/i })).not.toBeInTheDocument()
  })

  it("al abrirlo muestra el nombre, el rol y Cerrar sesión", () => {
    montar()

    abrir()

    expect(boton()).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Vendedor Camión")).toBeInTheDocument()
    expect(screen.getByText("Vendedor")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^cerrar sesión$/i })).toBeInTheDocument()
  })

  it("sin ventas pendientes, cierra la sesión y lleva al login sin preguntar", async () => {
    const { logout } = montar()

    abrir()
    salir()

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    expect(Swal.fire).not.toHaveBeenCalled()
    expect(await screen.findByText("Pantalla de login")).toBeInTheDocument()
  })

  it("con ventas pendientes avisa igual que la barra lateral y, si vuelve, no cierra la sesión", async () => {
    const { logout } = montar({ sinConfirmar: 2, conexion: "sin_red" })

    abrir()
    salir()

    await waitFor(() => expect(Swal.fire).toHaveBeenCalled())
    const aviso = Swal.fire.mock.calls[0][0]
    expect(aviso.title).toBe("Hay ventas sin sincronizar")
    expect(aviso.text).toMatch(/2 ventas guardadas solo en este teléfono/)
    expect(aviso.text).toMatch(/sin conexión no podrás volver a entrar/i)
    expect(aviso.cancelButtonText).toBe("Volver")
    expect(logout).not.toHaveBeenCalled()
  })

  it("con ventas pendientes, si confirma, cierra la sesión", async () => {
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    const { logout } = montar({ sinConfirmar: 1 })

    abrir()
    salir()

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
  })

  it("Escape lo cierra y devuelve el foco al botón", () => {
    montar()

    abrir()
    fireEvent.keyDown(document, { key: "Escape" })

    expect(boton()).toHaveAttribute("aria-expanded", "false")
    expect(boton()).toHaveFocus()
  })

  it("tocar fuera lo cierra", () => {
    montar()

    abrir()
    fireEvent.pointerDown(screen.getByText("Fuera del menú"))

    expect(boton()).toHaveAttribute("aria-expanded", "false")
  })
})
