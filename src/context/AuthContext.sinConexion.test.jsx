import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { IDBFactory } from "fake-indexeddb"

import { crearSupabaseFalso } from "../test/supabaseFalso"

/*
  Entrar al POS sin conexión (OFF-1.3).

  Sin red, Supabase no puede renovar el token y la sesión se ve vacía. Si
  el vendedor ya había entrado en este teléfono, su sesión sigue guardada y
  el último perfil que confirmó el servidor también: con eso entra, solo al
  POS, marcado «sin conexión». Si cerró sesión, o el perfil venció, no.
*/

const EMPRESA = "empresa-1"
const LLAVE_DE_SESION = "sb-prueba-auth-token"

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

const TABLAS = {
  usuarios: [VENDEDOR],
  permisos_usuario: [
    { usuario_id: "u-vendedor", empresa_id: EMPRESA, seccion: "pos" },
    { usuario_id: "u-vendedor", empresa_id: EMPRESA, seccion: "dashboard" },
  ],
}

const SIN_RED = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

function montar({ sesionInicial = { user: { id: "auth-vendedor" } }, fallarEn = {} } = {}) {
  const falso = crearSupabaseFalso({
    tablas: TABLAS,
    sesionInicial,
    fallarEn,
    cuentas: [{ id: "auth-vendedor", email: VENDEDOR.email, password: "Vende2026" }],
  })
  falso.auth.storageKey = LLAVE_DE_SESION
  globalThis.__supabaseFalso = falso

  return falso
}

async function renderAuth() {
  const { AuthProvider } = await import("./AuthContext")
  const { useAuth } = await import("../hooks/useAuth")

  const vista = renderHook(() => useAuth(), { wrapper: AuthProvider })

  await waitFor(() => expect(vista.result.current.cargando).toBe(false))

  return vista
}

// Entra una vez con conexión: el perfil queda guardado en el teléfono.
async function entrarConConexion() {
  montar()
  localStorage.setItem(LLAVE_DE_SESION, JSON.stringify({ user: { id: "auth-vendedor" } }))
  const vista = await renderAuth()
  await waitFor(() => expect(vista.result.current.user?.id).toBe("u-vendedor"))
  const { almacenDeLaApp } = await import("../lib/sinConexion/almacenDeLaApp")
  const { leerPerfilLocal } = await import("../lib/sinConexion/perfilLocal")
  await waitFor(async () => expect(await leerPerfilLocal(await almacenDeLaApp(), "auth-vendedor")).not.toBeNull())
  vista.unmount()
  vi.resetModules()
}

// Abre la aplicación otra vez, ahora sin red.
async function abrirSinRed({ sesionGuardada = true } = {}) {
  const falso = montar({ sesionInicial: null })
  falso.auth.getSession.mockResolvedValue({ data: { session: null }, error: SIN_RED })
  if (!sesionGuardada) localStorage.removeItem(LLAVE_DE_SESION)

  return { falso, vista: await renderAuth() }
}

beforeEach(() => {
  vi.resetModules()
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  delete globalThis.indexedDB
  vi.useRealTimers()
})

describe("entrar sin conexión", () => {
  it("con la sesión guardada y el perfil confirmado antes, entra solo al POS y marcado sin conexión", async () => {
    await entrarConConexion()

    const { vista } = await abrirSinRed()

    expect(vista.result.current.user).toMatchObject({
      id: "u-vendedor",
      name: "Vendedor Camión",
      locationId: "camion-01",
      sinConexion: true,
    })
    expect(vista.result.current.hasPermission("pos")).toBe(true)
    expect(vista.result.current.hasPermission("dashboard")).toBe(false)
  })

  it("si cerró sesión antes, no entra", async () => {
    await entrarConConexion()

    const { vista } = await abrirSinRed({ sesionGuardada: false })

    expect(vista.result.current.user).toBeNull()
  })

  it("si nunca entró con conexión en este teléfono, no entra", async () => {
    localStorage.setItem(LLAVE_DE_SESION, JSON.stringify({ user: { id: "auth-vendedor" } }))

    const { vista } = await abrirSinRed()

    expect(vista.result.current.user).toBeNull()
  })

  it("con sesión pero sin poder consultar el perfil por falta de red, usa el perfil guardado", async () => {
    await entrarConConexion()
    montar({ fallarEn: { usuarios: { message: "TypeError: Failed to fetch", status: 0 } } })

    const vista = await renderAuth()

    expect(vista.result.current.user).toMatchObject({ id: "u-vendedor", sinConexion: true })
  })

  it("si el servidor responde que no tiene perfil, no se usa el guardado", async () => {
    await entrarConConexion()
    const falso = montar()
    falso.from.mockImplementation(() => {
      const vacia = { select: () => vacia, eq: () => vacia, maybeSingle: async () => ({ data: null, error: null }) }
      return vacia
    })

    const vista = await renderAuth()

    expect(vista.result.current.user).toBeNull()
  })

  it("al cerrar sesión se borra el perfil guardado, y sin red la sesión se cierra en el teléfono", async () => {
    await entrarConConexion()
    const { falso, vista } = await abrirSinRed()
    falso.auth.signOut.mockResolvedValueOnce({ error: SIN_RED })

    await act(() => vista.result.current.logout())

    expect(falso.auth.signOut).toHaveBeenCalledWith({ scope: "local" })
    const { almacenDeLaApp } = await import("../lib/sinConexion/almacenDeLaApp")
    const { leerPerfilLocal } = await import("../lib/sinConexion/perfilLocal")
    expect(await leerPerfilLocal(await almacenDeLaApp(), "auth-vendedor")).toBeNull()
    expect(vista.result.current.user).toBeNull()
  })

  it("al volver la conexión, el perfil se confirma con el servidor y deja de estar sin conexión", async () => {
    await entrarConConexion()
    const { falso, vista } = await abrirSinRed()
    expect(vista.result.current.user.sinConexion).toBe(true)

    await act(async () => {
      await falso.auth.setSession({ access_token: "tok:auth-vendedor" })
    })

    await waitFor(() => expect(vista.result.current.user?.sinConexion).toBeFalsy())
  })
})
