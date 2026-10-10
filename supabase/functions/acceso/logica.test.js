import { describe, it, expect, vi } from "vitest"

import { crearAcceso, generarContrasenaTemporal, CORREO_FICTICIO } from "./logica"

/*
  La Edge Function `acceso` sin Deno ni red: Supabase Auth y la base se
  reemplazan por dobles que registran lo que se les pidió. Así se prueba lo
  que importa: quién puede hacer qué, en qué orden, y qué se responde.
*/

const ADMIN = { id: "auth-admin", email: "admin@lunacell.test" }
const EMPLEADO = { id: "auth-empleado", email: "camion01@lunacell.test" }
const SESION = { access_token: "acceso", refresh_token: "renovar" }

function montar({ rpc = {}, cuentas = { [EMPLEADO.email]: "Vigente#2026" }, tokens = { "tok-admin": ADMIN, "tok-empleado": EMPLEADO }, fallaCrear = null, fallaCambiar = null } = {}) {
  const llamadas = []
  const respuestas = {
    acceso_reservar_intento: { data: [{ usuario_id: "u-empleado", email: EMPLEADO.email, permitido: true }], error: null },
    acceso_registrar_exito: { data: null, error: null },
    acceso_contrasena_cambiada: { data: null, error: null },
    validar_alta_empleado: { data: "empresa-a", error: null },
    registrar_empleado: { data: "u-nuevo", error: null },
    preparar_restablecimiento: { data: EMPLEADO.id, error: null },
    ...rpc,
  }

  const auth = {
    usuarioDelToken: vi.fn(async (token) => tokens[token] || null),
    iniciar: vi.fn(async (email, password) =>
      cuentas[email] && cuentas[email] === password
        ? { data: { session: SESION }, error: null }
        : { data: { session: null }, error: { message: "Invalid login credentials" } }
    ),
    crearUsuario: vi.fn(async () => (fallaCrear ? { data: null, error: fallaCrear } : { data: { user: { id: "auth-nuevo" } }, error: null })),
    borrarUsuario: vi.fn(async () => ({ error: null })),
    cambiarContrasena: vi.fn(async () => (fallaCambiar ? { error: fallaCambiar } : { error: null })),
  }

  const manejar = crearAcceso({
    rpc: vi.fn(async (nombre, argumentos) => {
      llamadas.push([nombre, argumentos])
      return respuestas[nombre] || { data: null, error: { message: "desconocida" } }
    }),
    auth,
  })

  return { manejar, auth, llamadas, nombres: () => llamadas.map(([n]) => n) }
}

const ALTA = {
  nombre: "Chofer Camión 01",
  usuario: "camion01",
  email: "nuevo@lunacell.test",
  rol: "vendedor",
  secciones: ["pos", "inventory-own"],
  ubicacion: "ubic-camion-01",
  activo: true,
}

// ── CONTRASEÑA TEMPORAL ───────────────────────────────────

describe("contraseña temporal", () => {
  it("tiene 16 caracteres con mayúscula, minúscula, número y símbolo", () => {
    const c = generarContrasenaTemporal()

    expect(c).toHaveLength(16)
    expect(c).toMatch(/[A-Z]/)
    expect(c).toMatch(/[a-z]/)
    expect(c).toMatch(/[0-9]/)
    expect(c).toMatch(/[^A-Za-z0-9]/)
  })

  it("es individual: no se repite", () => {
    const vistas = new Set(Array.from({ length: 500 }, () => generarContrasenaTemporal()))

    expect(vistas.size).toBe(500)
  })
})

// ── INICIAR SESIÓN ────────────────────────────────────────

describe("iniciar sesión con usuario o correo", () => {
  it("con la contraseña vigente devuelve la sesión y limpia el contador", async () => {
    const m = montar()

    const r = await m.manejar({ accion: "iniciar", cuerpo: { identificador: "camion01", contrasena: "Vigente#2026" } })

    expect(r).toEqual({ estado: 200, cuerpo: { access_token: "acceso", refresh_token: "renovar" } })
    expect(m.nombres()).toEqual(["acceso_reservar_intento", "acceso_registrar_exito"])
  })

  it("la respuesta es idéntica para usuario inexistente, bloqueado o contraseña incorrecta, y nunca trae el correo", async () => {
    const incorrecta = await montar().manejar({ accion: "iniciar", cuerpo: { identificador: "camion01", contrasena: "mal" } })
    const sinUsuario = montar({ rpc: { acceso_reservar_intento: { data: [{ usuario_id: null, email: null, permitido: false }], error: null } } })
    const inexistente = await sinUsuario.manejar({ accion: "iniciar", cuerpo: { identificador: "nadie", contrasena: "x" } })

    expect(incorrecta).toEqual(inexistente)
    expect(incorrecta.estado).toBe(401)
    expect(JSON.stringify(incorrecta)).not.toContain("@")
    // Sin usuario se compara igual contra una cuenta ficticia, para tardar lo mismo.
    expect(sinUsuario.auth.iniciar).toHaveBeenCalledWith(CORREO_FICTICIO, "x")
  })

  it("un intento fallido no limpia el contador", async () => {
    const m = montar()

    await m.manejar({ accion: "iniciar", cuerpo: { identificador: "camion01", contrasena: "mal" } })

    expect(m.nombres()).toEqual(["acceso_reservar_intento"])
  })
})

// ── CREAR EMPLEADO ────────────────────────────────────────

describe("crear empleado", () => {
  it("sin sesión de administrador no hace nada", async () => {
    const m = montar()

    expect((await m.manejar({ accion: "crear", token: null, cuerpo: ALTA })).estado).toBe(401)
    expect((await m.manejar({ accion: "crear", token: "tok-falso", cuerpo: ALTA })).estado).toBe(401)
    expect(m.auth.crearUsuario).not.toHaveBeenCalled()
  })

  it("valida en la base antes de crear la identidad", async () => {
    const m = montar({ rpc: { validar_alta_empleado: { data: null, error: { code: "23505", message: "Ese nombre de usuario ya está en uso." } } } })

    const r = await m.manejar({ accion: "crear", token: "tok-admin", cuerpo: ALTA })

    expect(r).toEqual({ estado: 400, cuerpo: { error: "Ese nombre de usuario ya está en uso." } })
    expect(m.auth.crearUsuario).not.toHaveBeenCalled()
  })

  it("un empleado que no es administrador es rechazado por la base", async () => {
    const m = montar({ rpc: { validar_alta_empleado: { data: null, error: { code: "42501", message: "Solo un administrador activo puede hacer esto." } } } })

    expect((await m.manejar({ accion: "crear", token: "tok-empleado", cuerpo: ALTA })).estado).toBe(403)
  })

  it("crea la identidad, registra al empleado con el administrador que llama y devuelve la temporal una sola vez", async () => {
    const m = montar()

    const r = await m.manejar({ accion: "crear", token: "tok-admin", cuerpo: ALTA })

    expect(r.estado).toBe(200)
    expect(r.cuerpo.usuario_id).toBe("u-nuevo")
    expect(r.cuerpo.contrasena_temporal).toHaveLength(16)
    expect(m.auth.crearUsuario).toHaveBeenCalledWith("nuevo@lunacell.test", r.cuerpo.contrasena_temporal)
    const [, registro] = m.llamadas.find(([n]) => n === "registrar_empleado")
    expect(registro).toMatchObject({ p_admin_auth: ADMIN.id, p_auth_id: "auth-nuevo", p_usuario: "camion01", p_secciones: ["pos", "inventory-own"], p_ubicacion: "ubic-camion-01" })
    expect(JSON.stringify(registro)).not.toContain(r.cuerpo.contrasena_temporal)
  })

  it("si la identidad ya existía, no la borra", async () => {
    const m = montar({ fallaCrear: { message: "A user with this email address has already been registered", status: 422 } })

    const r = await m.manejar({ accion: "crear", token: "tok-admin", cuerpo: ALTA })

    expect(r.estado).toBe(409)
    expect(m.auth.borrarUsuario).not.toHaveBeenCalled()
    expect(m.nombres()).not.toContain("registrar_empleado")
  })

  it("si el registro falla, borra solo la identidad que acaba de crear", async () => {
    const m = montar({ rpc: { registrar_empleado: { data: null, error: { code: "23514", message: "La ubicación no existe en tu empresa o no está activa." } } } })

    const r = await m.manejar({ accion: "crear", token: "tok-admin", cuerpo: ALTA })

    expect(r).toEqual({ estado: 400, cuerpo: { error: "La ubicación no existe en tu empresa o no está activa." } })
    expect(m.auth.borrarUsuario).toHaveBeenCalledTimes(1)
    expect(m.auth.borrarUsuario).toHaveBeenCalledWith("auth-nuevo")
  })
})

// ── RESTABLECER ───────────────────────────────────────────

describe("restablecer contraseña", () => {
  it("prepara en la base, pone una temporal nueva y la devuelve una sola vez", async () => {
    const m = montar()

    const r = await m.manejar({ accion: "restablecer", token: "tok-admin", cuerpo: { usuario_id: "u-empleado", desbloquear: true } })

    expect(r.estado).toBe(200)
    expect(m.llamadas.find(([n]) => n === "preparar_restablecimiento")[1]).toEqual({ p_admin_auth: ADMIN.id, p_usuario: "u-empleado", p_desbloquear: true })
    expect(m.auth.cambiarContrasena).toHaveBeenCalledWith(EMPLEADO.id, r.cuerpo.contrasena_temporal)
  })

  it("si la base lo rechaza, no toca la contraseña", async () => {
    const m = montar({ rpc: { preparar_restablecimiento: { data: null, error: { code: "42501", message: "Ese usuario no existe en tu empresa." } } } })

    const r = await m.manejar({ accion: "restablecer", token: "tok-admin", cuerpo: { usuario_id: "otro", desbloquear: true } })

    expect(r).toEqual({ estado: 403, cuerpo: { error: "Ese usuario no existe en tu empresa." } })
    expect(m.auth.cambiarContrasena).not.toHaveBeenCalled()
  })

  it("si Supabase Auth falla, lo dice y no devuelve una temporal que no sirve", async () => {
    const m = montar({ fallaCambiar: { message: "boom" } })

    const r = await m.manejar({ accion: "restablecer", token: "tok-admin", cuerpo: { usuario_id: "u-empleado", desbloquear: true } })

    expect(r.estado).toBe(500)
    expect(r.cuerpo.contrasena_temporal).toBeUndefined()
  })
})

// ── CAMBIAR CONTRASEÑA ────────────────────────────────────

describe("cambiar contraseña", () => {
  const CAMBIO = { actual: "Vigente#2026", nueva: "Nueva-Clave-2026" }

  it("con la actual correcta cambia la contraseña y después levanta la exigencia", async () => {
    const m = montar()

    const r = await m.manejar({ accion: "cambiar", token: "tok-empleado", cuerpo: CAMBIO })

    expect(r).toEqual({ estado: 200, cuerpo: { ok: true } })
    expect(m.auth.cambiarContrasena).toHaveBeenCalledWith(EMPLEADO.id, CAMBIO.nueva)
    expect(m.llamadas.find(([n]) => n === "acceso_contrasena_cambiada")[1]).toEqual({ p_auth_id: EMPLEADO.id })
  })

  it("con la actual incorrecta no cambia nada", async () => {
    const m = montar()

    const r = await m.manejar({ accion: "cambiar", token: "tok-empleado", cuerpo: { ...CAMBIO, actual: "mal" } })

    expect(r.estado).toBe(401)
    expect(m.auth.cambiarContrasena).not.toHaveBeenCalled()
    expect(m.nombres()).not.toContain("acceso_contrasena_cambiada")
  })

  it("exige una nueva de 10 caracteres o más, con letras y números, distinta de la actual", async () => {
    const m = montar()

    for (const nueva of ["corta1", "sinnumerosaqui", "1234567890", CAMBIO.actual]) {
      expect((await m.manejar({ accion: "cambiar", token: "tok-empleado", cuerpo: { ...CAMBIO, nueva } })).estado).toBe(400)
    }
    expect(m.auth.cambiarContrasena).not.toHaveBeenCalled()
  })

  it("sin sesión no cambia nada", async () => {
    const m = montar()

    expect((await m.manejar({ accion: "cambiar", token: null, cuerpo: CAMBIO })).estado).toBe(401)
  })
})

it("una acción desconocida se rechaza", async () => {
  expect((await montar().manejar({ accion: "borrar", cuerpo: {} })).estado).toBe(400)
})
