import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { IDBFactory } from "fake-indexeddb"

import { crearSupabaseFalso } from "../test/supabaseFalso"

/*
  /login con alguien que ya entró en este teléfono.

  Quien ya tiene un usuario vigente no vuelve a escribir la contraseña: con
  conexión pasa al panel; sin conexión, con el perfil guardado del MISMO
  usuario y vigente, pasa al POS. Quién es vigente lo decide AuthContext
  (OFF-1.3), no esta pantalla. Sin perfil, con el de otro usuario, vencido
  o después de cerrar sesión, se queda en el formulario.
*/

const EMPRESA = "empresa-1"
const LLAVE_DE_SESION = "sb-prueba-auth-token"
const DIA = 24 * 3600000

const VENDEDOR = {
  id: "u-vendedor",
  auth_id: "auth-vendedor",
  empresa_id: EMPRESA,
  email: "vendedor@ferreteria.test",
  nombre: "Vendedor Camión",
  nombre_usuario: "camion01",
  rol: "vendedor",
  activo: true,
  ubicacion_id: "camion-01",
  entro_en: "2026-01-02",
}

const permisos = (...secciones) => secciones.map((seccion) => ({ usuario_id: "u-vendedor", empresa_id: EMPRESA, seccion }))

const SIN_RED = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

function montar({ sesionInicial = { user: { id: "auth-vendedor" } }, secciones = ["pos", "dashboard"] } = {}) {
  const falso = crearSupabaseFalso({
    tablas: { usuarios: [VENDEDOR], permisos_usuario: permisos(...secciones) },
    sesionInicial,
    cuentas: [{ id: "auth-vendedor", email: VENDEDOR.email, password: "Vende2026" }],
  })
  falso.auth.storageKey = LLAVE_DE_SESION
  globalThis.__supabaseFalso = falso

  return falso
}

async function abrirLogin() {
  const { AuthProvider } = await import("../context/AuthContext")
  const Login = (await import("./Login")).default

  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/pos" element={<h1>Punto de venta</h1>} />
          <Route path="/dashboard" element={<h1>Panel</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}

// Entra una vez con conexión: el perfil queda guardado en el teléfono.
async function entrarConConexion(opciones) {
  montar(opciones)
  localStorage.setItem(LLAVE_DE_SESION, JSON.stringify({ user: { id: "auth-vendedor" } }))
  const vista = await abrirLogin()
  await screen.findByText("Panel")
  const { almacenDeLaApp } = await import("../lib/sinConexion/almacenDeLaApp")
  const { leerPerfilLocal } = await import("../lib/sinConexion/perfilLocal")
  await waitFor(async () => expect(await leerPerfilLocal(await almacenDeLaApp(), "auth-vendedor")).not.toBeNull())
  vista.unmount()
  vi.resetModules()
}

// Abre /login otra vez, ahora sin red.
async function abrirSinRed({ sesionGuardada = { user: { id: "auth-vendedor" } }, secciones } = {}) {
  const falso = montar({ sesionInicial: null, secciones })
  falso.auth.getSession.mockResolvedValue({ data: { session: null }, error: SIN_RED })

  if (sesionGuardada) localStorage.setItem(LLAVE_DE_SESION, JSON.stringify(sesionGuardada))
  else localStorage.removeItem(LLAVE_DE_SESION)

  await abrirLogin()
}

// El formulario sigue ahí después de que AuthContext terminó de decidir.
async function sigueEnElFormulario() {
  await screen.findByLabelText(/usuario o correo/i)
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.getByLabelText(/usuario o correo/i)).toBeInTheDocument()
  expect(screen.queryByText("Punto de venta")).not.toBeInTheDocument()
  expect(screen.queryByText("Panel")).not.toBeInTheDocument()
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  delete globalThis.indexedDB
  vi.useRealTimers()
})

describe("/login con conexión", () => {
  it("con la sesión vigente pasa al panel sin pedir la contraseña", async () => {
    montar()
    await abrirLogin()

    expect(await screen.findByText("Panel")).toBeInTheDocument()
  })

  it("sin sesión muestra el formulario", async () => {
    montar({ sesionInicial: null })
    await abrirLogin()

    await sigueEnElFormulario()
  })
})

describe("/login sin conexión", () => {
  it("con el perfil vigente del mismo usuario pasa al POS", async () => {
    await entrarConConexion()

    await abrirSinRed()

    expect(await screen.findByText("Punto de venta")).toBeInTheDocument()
  })

  it("si nunca entró con conexión en este teléfono, se queda en el formulario", async () => {
    await abrirSinRed()

    await sigueEnElFormulario()
  })

  it("después de cerrar sesión, se queda en el formulario", async () => {
    await entrarConConexion()

    await abrirSinRed({ sesionGuardada: null })

    await sigueEnElFormulario()
  })

  it("no usa el perfil guardado de otro usuario", async () => {
    await entrarConConexion()

    await abrirSinRed({ sesionGuardada: { user: { id: "auth-otro" } } })

    await sigueEnElFormulario()
  })

  it("con el perfil vencido (más de 7 días), se queda en el formulario", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() - 8 * DIA)
    await entrarConConexion()
    vi.useRealTimers()

    await abrirSinRed()

    await sigueEnElFormulario()
  })

  it("sin permiso para el punto de venta, se queda en el formulario", async () => {
    await entrarConConexion({ secciones: ["dashboard"] })

    await abrirSinRed({ secciones: ["dashboard"] })

    await sigueEnElFormulario()
  })
})
