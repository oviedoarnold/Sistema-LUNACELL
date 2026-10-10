import { supabase } from "../supabase"

/*
  Acceso de usuarios (USR-1).

  Lo que necesita privilegios de administrador de Supabase Auth —crear una
  identidad, poner una contraseña temporal, comprobar la contraseña con el
  bloqueo por intentos— pasa por la Edge Function `acceso`, que guarda la
  clave de servicio del lado del servidor. Desbloquear y guardar permisos
  son RPC: la base valida al administrador con su propia sesión.
*/

const SIN_RESPUESTA = "No se pudo completar la operación. Revisa tu conexión e intenta de nuevo."

/*
  En un fallo, supabase-js entrega un FunctionsHttpError cuya respuesta
  trae { error } con un texto pensado para una persona.
*/
async function llamarAcceso(accion, datos) {
  const { data, error } = await supabase.functions.invoke("acceso", { body: { accion, ...datos } })

  if (error) {
    let mensaje = SIN_RESPUESTA

    try {
      const cuerpo = await error.context?.json()
      if (cuerpo?.error) mensaje = cuerpo.error
    } catch {
      // La respuesta no traía cuerpo: queda el mensaje general.
    }

    throw new Error(mensaje)
  }

  return data
}

export const iniciarSesionConUsuario = (identificador, contrasena) =>
  llamarAcceso("iniciar", { identificador, contrasena })

export const crearEmpleado = (alta) => llamarAcceso("crear", alta)

/* Desbloquea a la vez: la temporal nueva tiene que poder usarse ya. */
export const restablecerContrasena = (usuarioId) =>
  llamarAcceso("restablecer", { usuario_id: usuarioId, desbloquear: true })

export const cambiarContrasena = (actual, nueva) => llamarAcceso("cambiar", { actual, nueva })

export async function desbloquearUsuario(usuarioId) {
  const { error } = await supabase.rpc("desbloquear_usuario", { p_usuario: usuarioId })

  if (error) {
    throw new Error(
      error.code === "42501" ? "No tienes permiso para desbloquear a ese usuario." : "No se pudo desbloquear al usuario."
    )
  }
}

/* Todo o nada: si una sección no se puede guardar, no se pierde ninguna. */
export async function guardarPermisosDeUsuario(usuarioId, secciones) {
  const { error } = await supabase.rpc("guardar_permisos_usuario", {
    p_usuario: usuarioId,
    p_secciones: secciones,
  })

  if (error) throw new Error("No se pudieron guardar los permisos.")
}
