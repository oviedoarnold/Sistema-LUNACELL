import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

import { crearSupabaseFalso } from "../test/supabaseFalso"

const EMPRESA = "empresa-1"

const DATOS_BASE = {
  usuarios: [
    {
      id: "u-admin",
      auth_id: "auth-admin",
      empresa_id: EMPRESA,
      email: "admin@ferreteria.test",
      nombre: "Administradora",
      rol: "admin",
      activo: true,
      entro_en: "2026-01-01",
    },
    {
      id: "u-vendedor",
      auth_id: "auth-vendedor",
      empresa_id: EMPRESA,
      email: "vendedor@ferreteria.test",
      nombre: "Vendedor de mostrador",
      rol: "vendedor",
      activo: true,
      entro_en: "2026-01-02",
    },
    {
      id: "u-invitado",
      auth_id: null,
      empresa_id: EMPRESA,
      email: "invitado@ferreteria.test",
      nombre: "Aún no entra",
      rol: "vendedor",
      activo: true,
      entro_en: null,
    },
  ],
  permisos_usuario: [
    { usuario_id: "u-vendedor", empresa_id: EMPRESA, seccion: "pos" },
    { usuario_id: "u-vendedor", empresa_id: EMPRESA, seccion: "sales-history" },
    { usuario_id: "u-admin", empresa_id: EMPRESA, seccion: "settings" },
  ],
}

const CUENTAS = [
  { id: "auth-admin", email: "admin@ferreteria.test", password: "Admin2026" },
  { id: "auth-vendedor", email: "vendedor@ferreteria.test", usuario: "vendedor.mostrador", password: "Vende2026" },
  { id: "auth-huerfano", email: "huerfano@ferreteria.test", password: "Huerf2026" },
]

let falso

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
  exigirSupabase: () => globalThis.__supabaseFalso,
}))

async function renderAuth({ sesionInicial = null, tablas = DATOS_BASE } = {}) {
  falso = crearSupabaseFalso({ tablas, cuentas: CUENTAS, sesionInicial })
  globalThis.__supabaseFalso = falso

  const { AuthProvider } = await import("./AuthContext")
  const { useAuth } = await import("../hooks/useAuth")

  const vista = renderHook(() => useAuth(), { wrapper: AuthProvider })

  await waitFor(() => expect(vista.result.current.cargando).toBe(false))

  return vista
}

beforeEach(() => {
  vi.resetModules()
})

describe("sesión inicial", () => {
  it("arranca sin usuario cuando no hay sesión", async () => {
    const { result } = await renderAuth()

    expect(result.current.user).toBeNull()
  })

  it("deja de cargar aunque no haya sesión", async () => {
    const { result } = await renderAuth()

    expect(result.current.cargando).toBe(false)
  })

  it("recupera la sesión guardada al arrancar", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-vendedor" } },
    })

    expect(result.current.user.name).toBe("Vendedor de mostrador")
  })

  it("no da acceso a una cuenta que nadie invitó", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-huerfano" } },
    })

    expect(result.current.user).toBeNull()
  })

  it("no da acceso a un usuario desactivado", async () => {
    const tablas = {
      ...DATOS_BASE,
      usuarios: DATOS_BASE.usuarios.map((u) =>
        u.id === "u-vendedor" ? { ...u, activo: false } : u
      ),
    }

    const { result } = await renderAuth({
      tablas,
      sesionInicial: { user: { id: "auth-vendedor" } },
    })

    expect(result.current.user).toBeNull()
  })
})

describe("login", () => {
  it("acepta las credenciales correctas", async () => {
    const { result } = await renderAuth()

    let respuesta
    await act(async () => {
      respuesta = await result.current.login(
        "vendedor@ferreteria.test",
        "Vende2026"
      )
    })

    expect(respuesta.ok).toBe(true)
    expect(result.current.user.name).toBe("Vendedor de mostrador")
  })

  it("rechaza una contraseña incorrecta", async () => {
    const { result } = await renderAuth()

    let respuesta
    await act(async () => {
      respuesta = await result.current.login(
        "vendedor@ferreteria.test",
        "equivocada"
      )
    })

    expect(respuesta.ok).toBe(false)
    expect(respuesta.mensaje).toMatch(/incorrect/i)
    expect(result.current.user).toBeNull()
  })

  it("ignora mayúsculas y espacios en el correo", async () => {
    const { result } = await renderAuth()

    let respuesta
    await act(async () => {
      respuesta = await result.current.login(
        "  VENDEDOR@Ferreteria.TEST  ",
        "Vende2026"
      )
    })

    expect(respuesta.ok).toBe(true)
  })

  it("explica cuándo la cuenta no está asignada a una empresa", async () => {
    const { result } = await renderAuth()

    let respuesta
    await act(async () => {
      respuesta = await result.current.login(
        "huerfano@ferreteria.test",
        "Huerf2026"
      )
    })

    expect(respuesta.ok).toBe(false)
    expect(respuesta.mensaje).toMatch(/no está asignada/i)
  })

  it("cierra la sesión de la cuenta sin asignar, para no dejarla a medias", async () => {
    const { result } = await renderAuth()

    await act(async () => {
      await result.current.login("huerfano@ferreteria.test", "Huerf2026")
    })

    expect(falso.auth.signOut).toHaveBeenCalled()
    expect(result.current.user).toBeNull()
  })

  it("entra con su nombre de usuario, sin escribir el correo", async () => {
    const { result } = await renderAuth()

    let respuesta
    await act(async () => {
      respuesta = await result.current.login("  Vendedor.Mostrador ", "Vende2026")
    })

    expect(respuesta.ok).toBe(true)
    expect(result.current.user.name).toBe("Vendedor de mostrador")
  })

  /*
    El bloqueo por intentos vive en el servidor: el navegador nunca habla
    directo con Supabase Auth para iniciar sesión.
  */
  it("inicia sesión a través de la función de acceso, no directo con Auth", async () => {
    const { result } = await renderAuth()

    await act(async () => {
      await result.current.login("vendedor@ferreteria.test", "Vende2026")
    })

    expect(falso.functions.invoke).toHaveBeenCalledWith("acceso", {
      body: { accion: "iniciar", identificador: "vendedor@ferreteria.test", contrasena: "Vende2026" },
    })
    expect(falso.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it("muestra el mensaje genérico del servidor cuando no puede entrar", async () => {
    const { result } = await renderAuth()

    let respuesta
    await act(async () => {
      respuesta = await result.current.login("nadie", "x")
    })

    expect(respuesta).toEqual({ ok: false, mensaje: "Usuario o contraseña incorrectos." })
  })
})

describe("cambio obligatorio de contraseña", () => {
  const conTemporal = {
    ...DATOS_BASE,
    usuarios: DATOS_BASE.usuarios.map((u) =>
      u.id === "u-vendedor" ? { ...u, debe_cambiar_contrasena: true } : u
    ),
  }

  it("el perfil avisa que debe cambiar la contraseña", async () => {
    const { result } = await renderAuth({ sesionInicial: { user: { id: "auth-vendedor" } }, tablas: conTemporal })

    expect(result.current.user.debeCambiar).toBe(true)
  })

  it("después de cambiarla, el perfil ya no lo exige", async () => {
    const { result } = await renderAuth({ sesionInicial: { user: { id: "auth-vendedor" } }, tablas: conTemporal })

    await act(async () => {
      await result.current.changePassword("Vende2026", "Nueva-Clave-2026")
    })

    expect(result.current.user.debeCambiar).toBe(false)
  })

  it("si la contraseña actual no es la correcta, lo dice", async () => {
    const { result } = await renderAuth({ sesionInicial: { user: { id: "auth-vendedor" } }, tablas: conTemporal })

    await expect(result.current.changePassword("mal", "Nueva-Clave-2026")).rejects.toThrow(
      "La contraseña actual no es correcta."
    )
  })
})

describe("logout", () => {
  it("cierra la sesión", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-vendedor" } },
    })

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.user).toBeNull()
    expect(falso.auth.signOut).toHaveBeenCalled()
  })
})

describe("hasPermission", () => {
  it("niega todo sin sesión", async () => {
    const { result } = await renderAuth()

    expect(result.current.hasPermission("pos")).toBe(false)
  })

  it("el vendedor solo tiene lo que se le habilitó", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-vendedor" } },
    })

    expect(result.current.hasPermission("pos")).toBe(true)
    expect(result.current.hasPermission("sales-history")).toBe(true)
    expect(result.current.hasPermission("products")).toBe(false)
    expect(result.current.hasPermission("settings")).toBe(false)
  })

  it("el administrador tiene acceso a todo aunque su lista sea corta", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    expect(result.current.hasPermission("products")).toBe(true)
    expect(result.current.hasPermission("suppliers")).toBe(true)
    expect(result.current.isAdmin).toBe(true)
  })
})

/*
  Qué pasa cuando la consulta se cae.

  Antes estos dos caminos no estaban cubiertos, y el de la sesión era un
  fallo real: si cargar el perfil rechazaba, aplicarSesion moría antes de
  poner cargando en false y ProtectedRoute dejaba "Comprobando tu sesión"
  para siempre.
*/
describe("cuando la base no responde", () => {
  /*
    Hace que una tabla concreta rechace, como haría supabase-js sin red.
  */
  function romperTabla(tabla, mensaje) {
    const original = falso.from.bind(falso)

    falso.from = (nombre) =>
      nombre === tabla
        ? {
            select: () => {
              throw new Error(mensaje)
            },
          }
        : original(nombre)
  }

  /*
    Monta la sesión con la tabla de usuarios caída y espera a que el
    contexto termine de resolverse. Si el fallo volviera a dejarlo
    cargando, la espera vence y las dos pruebas fallan aquí.
  */
  async function renderConUsuariosCaidos() {
    falso = crearSupabaseFalso({
      tablas: DATOS_BASE,
      cuentas: CUENTAS,
      sesionInicial: { user: { id: "auth-admin" } },
    })
    globalThis.__supabaseFalso = falso
    romperTabla("usuarios", "sin conexión")

    const { AuthProvider } = await import("./AuthContext")
    const { useAuth } = await import("../hooks/useAuth")

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => expect(result.current.cargando).toBe(false))

    return result
  }

  it("deja de cargar en vez de quedarse colgado", async () => {
    const result = await renderConUsuariosCaidos()

    expect(result.current.user).toBeNull()
  })

  it("sin perfil no quedan permisos ni sesión de administrador", async () => {
    const result = await renderConUsuariosCaidos()

    expect(result.current.isAdmin).toBe(false)
    expect(result.current.hasPermission("settings")).toBe(false)
  })
})

describe("administración de usuarios", () => {
  it("lista los usuarios de la empresa", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    await waitFor(() => expect(result.current.users.length).toBe(3))
  })

  it("marca quién todavía no acepta la invitación", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    await waitFor(() => expect(result.current.users.length).toBe(3))

    const pendiente = result.current.users.find(
      (u) => u.email === "invitado@ferreteria.test"
    )

    expect(pendiente.aceptoInvitacion).toBe(false)
  })

  it("trae a cada usuario con sus permisos", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    await waitFor(() => expect(result.current.users.length).toBe(3))

    const vendedor = result.current.users.find((u) => u.id === "u-vendedor")

    expect(vendedor.permissions).toEqual(["pos", "sales-history"])
    expect(result.current.errorUsuarios).toBe("")
  })

  it("si la lista no se puede cargar, lo dice en vez de dejarla vacía", async () => {
    falso = crearSupabaseFalso({ tablas: DATOS_BASE, cuentas: CUENTAS, sesionInicial: { user: { id: "auth-admin" } } })
    globalThis.__supabaseFalso = falso

    // Solo la consulta del listado (la que trae los permisos) falla; el perfil carga.
    const original = falso.from.bind(falso)
    falso.from = (nombre) => {
      const consulta = original(nombre)
      if (nombre !== "usuarios") return consulta

      const seleccionar = consulta.select.bind(consulta)
      consulta.select = (columnas) =>
        String(columnas).includes("permisos_usuario")
          ? { order: () => Promise.resolve({ data: null, error: { code: "PGRST201", message: "ambigua" } }) }
          : seleccionar(columnas)

      return consulta
    }

    const { AuthProvider } = await import("./AuthContext")
    const { useAuth } = await import("../hooks/useAuth")
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await waitFor(() => expect(result.current.user).not.toBeNull())
    await waitFor(() => expect(result.current.errorUsuarios).toMatch(/No se pudieron cargar los usuarios/))
    expect(result.current.users).toEqual([])
  })

  it("no muestra usuarios sin sesión", async () => {
    const { result } = await renderAuth()

    expect(result.current.users).toEqual([])
  })

  it("da de alta un empleado por la función de acceso y devuelve su contraseña temporal", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    let temporal
    await act(async () => {
      temporal = await result.current.addUser({
        name: "Nuevo Cajero",
        username: " Cajero.Nuevo ",
        email: "  NUEVO@ferreteria.test ",
        role: "vendedor",
        permissions: ["pos"],
        locationId: "ubic-tienda",
      })
    })

    expect(temporal).toBe("Temporal#2026abc")
    expect(falso.functions.invoke).toHaveBeenCalledWith("acceso", {
      body: {
        accion: "crear",
        nombre: "Nuevo Cajero",
        usuario: "cajero.nuevo",
        email: "nuevo@ferreteria.test",
        rol: "vendedor",
        secciones: ["pos"],
        ubicacion: "ubic-tienda",
        activo: true,
      },
    })
    await waitFor(() => expect(result.current.users.some((u) => u.username === "cajero.nuevo")).toBe(true))
  })

  it("exige un nombre de usuario válido antes de llamar al servidor", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    await expect(
      result.current.addUser({ name: "Alguien", username: "con espacios", email: "a@b.test" })
    ).rejects.toThrow(/nombre de usuario/i)
    expect(falso.functions.invoke).not.toHaveBeenCalled()
  })

  it("muestra el motivo que da el servidor si no puede dar de alta", async () => {
    const { result } = await renderAuth({ sesionInicial: { user: { id: "auth-admin" } } })
    falso.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsHttpError", context: { json: async () => ({ error: "Ese nombre de usuario ya está en uso." }) } },
    })

    await expect(
      result.current.addUser({ name: "Alguien", username: "repetido", email: "a@b.test" })
    ).rejects.toThrow("Ese nombre de usuario ya está en uso.")
  })

  it("restablecer devuelve una contraseña temporal nueva", async () => {
    const { result } = await renderAuth({ sesionInicial: { user: { id: "auth-admin" } } })

    let temporal
    await act(async () => {
      temporal = await result.current.resetUserPassword("u-vendedor")
    })

    expect(temporal).toBe("Temporal#2026xyz")
    expect(falso.functions.invoke).toHaveBeenCalledWith("acceso", {
      body: { accion: "restablecer", usuario_id: "u-vendedor", desbloquear: true },
    })
  })

  it("muestra quién está bloqueado y hasta cuándo, y lo desbloquea", async () => {
    const hasta = new Date(Date.now() + 10 * 60000).toISOString()
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
      tablas: { ...DATOS_BASE, bloqueos_de_acceso: [{ usuario_id: "u-vendedor", intentos: 5, bloqueado_hasta: hasta }] },
    })

    await waitFor(() => expect(result.current.users.find((u) => u.id === "u-vendedor")?.bloqueadoHasta).toBe(hasta))

    await act(async () => {
      await result.current.unlockUser("u-vendedor")
    })

    expect(falso.rpc).toHaveBeenCalledWith("desbloquear_usuario", { p_usuario: "u-vendedor" })
    await waitFor(() => expect(result.current.users.find((u) => u.id === "u-vendedor").bloqueadoHasta).toBeNull())
  })

  it("un bloqueo vencido no se muestra", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
      tablas: { ...DATOS_BASE, bloqueos_de_acceso: [{ usuario_id: "u-vendedor", intentos: 5, bloqueado_hasta: "2020-01-01T00:00:00Z" }] },
    })

    await waitFor(() => expect(result.current.users.length).toBe(3))
    expect(result.current.users.find((u) => u.id === "u-vendedor").bloqueadoHasta).toBeNull()
  })

  it("guarda los permisos de una vez, con la RPC", async () => {
    const { result } = await renderAuth({ sesionInicial: { user: { id: "auth-admin" } } })

    await act(async () => {
      await result.current.updateUser("u-vendedor", { permissions: ["pos", "quotes"] })
    })

    expect(falso.rpc).toHaveBeenCalledWith("guardar_permisos_usuario", {
      p_usuario: "u-vendedor",
      p_secciones: ["pos", "quotes"],
    })
  })

  it("si los permisos no se guardan, lo dice", async () => {
    falso = null
    const { result } = await renderAuth({ sesionInicial: { user: { id: "auth-admin" } } })
    falso.rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "check" } })

    await expect(result.current.updateUser("u-vendedor", { permissions: ["pos"] })).rejects.toThrow(/permisos/i)
  })

  it("exige nombre", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    await expect(
      result.current.addUser({ name: "  ", username: "alguien", email: "x@y.test" })
    ).rejects.toThrow(/nombre/i)
  })

  it("exige un correo válido", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    await expect(
      result.current.addUser({ name: "Alguien", username: "alguien", email: "no-es-correo" })
    ).rejects.toThrow(/correo/i)
  })

  it("desactivar a alguien lo marca inactivo", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    await act(async () => {
      await result.current.setUserActive("u-vendedor", false)
    })

    const fila = falso.datos.usuarios.find((u) => u.id === "u-vendedor")

    expect(fila.activo).toBe(false)
  })

  // D2: los usuarios no se borran, se desactivan.
  it("no ofrece eliminar usuarios", async () => {
    const { result } = await renderAuth({
      sesionInicial: { user: { id: "auth-admin" } },
    })

    expect(result.current.deleteUser).toBeUndefined()
  })
})
