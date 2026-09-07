import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"

import {
  montarSupabaseFalso,
  usuarioDePrueba,
  permisosDe,
} from "../test/auth"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

const CUENTAS = [
  { id: "auth-1", email: "vendedor@ferreteria.test", password: "Vende2026" },
  { id: "auth-huerfano", email: "huerfano@ferreteria.test", password: "Huerf2026" },
]

beforeEach(() => {
  vi.resetModules()
})

async function renderLogin() {
  const falso = montarSupabaseFalso({
    usuarios: [usuarioDePrueba({ email: "vendedor@ferreteria.test" })],
    permisos: permisosDe("u-1", ["dashboard"]),
  })

  falso.auth.signInWithPassword.mockImplementation(({ email, password }) => {
    const cuenta = CUENTAS.find(
      (c) => c.email === email && c.password === password
    )

    return Promise.resolve(
      cuenta
        ? { data: { user: { id: cuenta.id, email } }, error: null }
        : { data: { user: null }, error: { message: "credenciales" } }
    )
  })

  const { AuthProvider } = await import("../context/AuthContext")
  const Login = (await import("./Login")).default

  render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<h1>Dashboard</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )

  await screen.findByLabelText(/^correo$/i)
}

const escribir = (correo, clave) => {
  fireEvent.change(screen.getByLabelText(/^correo$/i), {
    target: { value: correo },
  })

  fireEvent.change(screen.getByLabelText(/^contraseña$/i), {
    target: { value: clave },
  })
}

const enviar = () =>
  fireEvent.click(screen.getByRole("button", { name: /ingresar/i }))

describe("Login", () => {
  it("muestra el formulario", async () => {
    await renderLogin()

    expect(screen.getByLabelText(/^correo$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^contraseña$/i)).toBeInTheDocument()
  })

  it("pide un correo, no un nombre de usuario", async () => {
    await renderLogin()

    expect(screen.getByLabelText(/^correo$/i)).toHaveAttribute("type", "email")
  })

  it("entra al panel con las credenciales correctas", async () => {
    await renderLogin()
    escribir("vendedor@ferreteria.test", "Vende2026")
    enviar()

    expect(await screen.findByText("Dashboard")).toBeInTheDocument()
  })

  it("avisa cuando las credenciales son incorrectas", async () => {
    await renderLogin()
    escribir("vendedor@ferreteria.test", "equivocada")
    enviar()

    expect(await screen.findByText(/incorrect/i)).toBeInTheDocument()
  })

  it("no deja pasar al panel con la clave equivocada", async () => {
    await renderLogin()
    escribir("vendedor@ferreteria.test", "equivocada")
    enviar()

    await screen.findByText(/incorrect/i)

    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument()
  })

  it("explica cuándo la cuenta no está asignada a una ferretería", async () => {
    await renderLogin()
    escribir("huerfano@ferreteria.test", "Huerf2026")
    enviar()

    expect(await screen.findByText(/no está asignada/i)).toBeInTheDocument()
  })

  it("la contraseña se oculta por defecto", async () => {
    await renderLogin()

    expect(screen.getByLabelText(/^contraseña$/i)).toHaveAttribute(
      "type",
      "password"
    )
  })

  it("el botón del ojo revela la contraseña", async () => {
    await renderLogin()

    fireEvent.click(
      screen.getByRole("button", { name: /mostrar u ocultar/i })
    )

    expect(screen.getByLabelText(/^contraseña$/i)).toHaveAttribute(
      "type",
      "text"
    )
  })

  it("desactiva el botón mientras entra", async () => {
    await renderLogin()
    escribir("vendedor@ferreteria.test", "Vende2026")
    enviar()

    await waitFor(() =>
      expect(screen.queryByText("Dashboard")).toBeInTheDocument()
    )
  })
})
