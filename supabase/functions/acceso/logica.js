/*
  Lógica de la Edge Function `acceso` (USR-1).

  Aquí no hay Deno ni red: Supabase Auth y la base llegan como dependencias,
  así que esto se prueba con vitest. index.ts solo enruta y crea los
  clientes. La clave de servicio vive únicamente en el servidor.

  Acciones:
  - iniciar:     pública. Usuario o correo + contraseña → sesión.
  - crear:       administrador. Alta de empleado con contraseña temporal.
  - restablecer: administrador. Contraseña temporal nueva, exige cambiarla.
  - cambiar:     el propio usuario. Exige la actual; levanta la exigencia.

  Quién puede qué lo decide la base (0026): estas funciones solo se ejecutan
  con service_role y validan al administrador, su empresa y al empleado.
*/

export const LONGITUD_TEMPORAL = 16
export const LONGITUD_MINIMA = 10

/*
  Contra esta cuenta se compara la contraseña cuando el usuario no existe o
  no puede entrar: la respuesta tarda lo mismo que un intento real y no
  delata qué nombres existen. El dominio .invalid no puede existir.
*/
export const CORREO_FICTICIO = "nadie@acceso.invalid"

const INCORRECTOS = { error: "Usuario o contraseña incorrectos." }

// Sin I, O, l, 0 ni 1: la temporal se dicta o se copia a mano.
const MAYUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const MINUSCULAS = "abcdefghijkmnopqrstuvwxyz"
const NUMEROS = "23456789"
const SIMBOLOS = "!#$%*+-=?@_"
const TODOS = MAYUSCULAS + MINUSCULAS + NUMEROS + SIMBOLOS

/* Un índice uniforme en [0, tope), sin el sesgo del módulo. */
function indiceAleatorio(tope) {
  const limite = Math.floor(0x100000000 / tope) * tope
  const muestra = new Uint32Array(1)

  do {
    crypto.getRandomValues(muestra)
  } while (muestra[0] >= limite)

  return muestra[0] % tope
}

const unoDe = (juego) => juego[indiceAleatorio(juego.length)]

export function generarContrasenaTemporal() {
  const caracteres = [unoDe(MAYUSCULAS), unoDe(MINUSCULAS), unoDe(NUMEROS), unoDe(SIMBOLOS)]

  while (caracteres.length < LONGITUD_TEMPORAL) caracteres.push(unoDe(TODOS))

  // Fisher-Yates, para que las cuatro obligatorias no queden al principio.
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = indiceAleatorio(i + 1)
    ;[caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]]
  }

  return caracteres.join("")
}

export function motivoDeContrasenaNueva(actual, nueva) {
  const texto = String(nueva || "")

  if (texto.length < LONGITUD_MINIMA) return `La contraseña nueva debe tener al menos ${LONGITUD_MINIMA} caracteres.`
  if (!/[A-Za-z]/.test(texto) || !/[0-9]/.test(texto)) return "La contraseña nueva debe tener letras y números."
  if (texto === actual) return "La contraseña nueva debe ser distinta de la actual."

  return null
}

const responder = (estado, cuerpo) => ({ estado, cuerpo })

/*
  Lo que la base explicó para una persona (RAISE con mensaje) se muestra
  tal cual; cualquier otra cosa, no: puede traer detalles internos.
*/
function desdeLaBase(error) {
  if (error.code === "42501") return responder(403, { error: error.message })
  if (["23505", "23514", "P0001"].includes(error.code)) return responder(400, { error: error.message })

  return responder(500, { error: "No se pudo completar la operación." })
}

const primeraFila = (data) => (Array.isArray(data) ? data[0] : data) || {}

export function crearAcceso({ rpc, auth }) {
  const quien = async (token) => (token ? auth.usuarioDelToken(token) : null)

  async function iniciar({ identificador, contrasena }) {
    const { data, error } = await rpc("acceso_reservar_intento", { p_identificador: String(identificador || "") })
    const intento = primeraFila(data)

    if (error || !intento.permitido) {
      await auth.iniciar(CORREO_FICTICIO, String(contrasena || ""))
      return responder(401, INCORRECTOS)
    }

    const { data: acceso, error: rechazo } = await auth.iniciar(intento.email, String(contrasena || ""))

    if (rechazo || !acceso?.session) return responder(401, INCORRECTOS)

    await rpc("acceso_registrar_exito", { p_usuario: intento.usuario_id })

    return responder(200, {
      access_token: acceso.session.access_token,
      refresh_token: acceso.session.refresh_token,
    })
  }

  async function crear(token, alta) {
    const admin = await quien(token)
    if (!admin) return responder(401, { error: "Inicia sesión como administrador." })

    const validacion = await rpc("validar_alta_empleado", {
      p_admin_auth: admin.id,
      p_usuario: alta.usuario,
      p_email: alta.email,
      p_ubicacion: alta.ubicacion || null,
    })
    if (validacion.error) return desdeLaBase(validacion.error)

    const temporal = generarContrasenaTemporal()
    const creada = await auth.crearUsuario(String(alta.email).trim().toLowerCase(), temporal)

    // Si la identidad ya existía no es nuestra: no se toca.
    if (creada.error || !creada.data?.user) {
      return responder(409, { error: "Ese correo ya tiene una cuenta de acceso. Usa otro correo." })
    }

    const registro = await rpc("registrar_empleado", {
      p_admin_auth: admin.id,
      p_auth_id: creada.data.user.id,
      p_nombre: alta.nombre,
      p_usuario: alta.usuario,
      p_email: alta.email,
      p_rol: alta.rol,
      p_secciones: alta.secciones || [],
      p_ubicacion: alta.ubicacion || null,
      p_activo: alta.activo !== false,
    })

    if (registro.error) {
      // Se deshace solo lo que esta misma solicitud creó.
      await auth.borrarUsuario(creada.data.user.id)
      return desdeLaBase(registro.error)
    }

    return responder(200, { usuario_id: registro.data, contrasena_temporal: temporal })
  }

  async function restablecer(token, { usuario_id, desbloquear }) {
    const admin = await quien(token)
    if (!admin) return responder(401, { error: "Inicia sesión como administrador." })

    const preparado = await rpc("preparar_restablecimiento", {
      p_admin_auth: admin.id,
      p_usuario: usuario_id,
      p_desbloquear: desbloquear !== false,
    })
    if (preparado.error) return desdeLaBase(preparado.error)

    const temporal = generarContrasenaTemporal()
    const cambio = await auth.cambiarContrasena(preparado.data, temporal)

    if (cambio.error) return responder(500, { error: "No se pudo poner la contraseña temporal. Intenta de nuevo." })

    return responder(200, { contrasena_temporal: temporal })
  }

  async function cambiar(token, { actual, nueva }) {
    const usuario = await quien(token)
    if (!usuario) return responder(401, { error: "Tu sesión terminó. Vuelve a iniciar sesión." })

    const motivo = motivoDeContrasenaNueva(actual, nueva)
    if (motivo) return responder(400, { error: motivo })

    // La actual también cuenta para el bloqueo por intentos.
    const reserva = await rpc("acceso_reservar_intento", { p_identificador: usuario.email })
    const intento = primeraFila(reserva.data)
    const comprobada = intento.permitido ? await auth.iniciar(usuario.email, String(actual || "")) : null

    if (!comprobada || comprobada.error || !comprobada.data?.session) {
      return responder(401, { error: "La contraseña actual no es correcta." })
    }

    await rpc("acceso_registrar_exito", { p_usuario: intento.usuario_id })

    const cambio = await auth.cambiarContrasena(usuario.id, String(nueva))
    if (cambio.error) return responder(500, { error: "No se pudo cambiar la contraseña. Intenta de nuevo." })

    // Solo después de que Supabase Auth la guardó.
    const levantada = await rpc("acceso_contrasena_cambiada", { p_auth_id: usuario.id })
    if (levantada.error) return responder(500, { error: "Se cambió la contraseña, pero falta confirmarlo. Vuelve a intentarlo." })

    return responder(200, { ok: true })
  }

  return async function manejar({ accion, token = null, cuerpo = {} }) {
    if (accion === "iniciar") return iniciar(cuerpo)
    if (accion === "crear") return crear(token, cuerpo)
    if (accion === "restablecer") return restablecer(token, cuerpo)
    if (accion === "cambiar") return cambiar(token, cuerpo)

    return responder(400, { error: "Acción desconocida." })
  }
}
