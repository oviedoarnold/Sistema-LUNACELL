/*
  Lo que AuthContext necesita para dejar entrar al POS sin conexión. Todo
  es «de mejor esfuerzo»: si el almacén local no está disponible, nada de
  esto lanza y el inicio de sesión se comporta como siempre.

  Cuándo se usa el perfil guardado (ver perfilLocal.js):
  - hay una sesión de Supabase guardada en el navegador del MISMO usuario
    (no cerró sesión), y
  - el servidor no se pudo consultar por falta de red: la sesión vacía viene
    de no poder renovar el token, o el perfil no se pudo leer.
  Si el servidor sí respondió (no hay perfil, cuenta desactivada, sesión
  revocada), el perfil guardado no se usa.
*/
import { almacenDeLaApp } from "./almacenDeLaApp"
import { clasificarError } from "./clasificar"
import { borrarPerfilLocal, guardarPerfilLocal, leerPerfilLocal } from "./perfilLocal"

export function esFalloDeRed(error) {
  if (!error) return false
  if (error.name === "AuthRetryableFetchError") return true

  return clasificarError(error, error.status) === "red"
}

// El usuario de la sesión que Supabase guardó en el navegador, si hay una.
export function authIdDeLaSesionGuardada(cliente) {
  try {
    const llave = cliente?.auth?.storageKey
    const guardada = llave ? globalThis.localStorage?.getItem(llave) : null

    return guardada ? JSON.parse(guardada)?.user?.id || null : null
  } catch {
    return null
  }
}

export async function recordarPerfil(perfil) {
  try {
    await guardarPerfilLocal(await almacenDeLaApp(), perfil)
  } catch {
    // Sin almacén local no hay modo sin conexión; en línea todo sigue igual.
  }
}

export async function perfilSinConexion(authId) {
  try {
    return await leerPerfilLocal(await almacenDeLaApp(), authId)
  } catch {
    return null
  }
}

export async function olvidarPerfil() {
  try {
    await borrarPerfilLocal(await almacenDeLaApp())
  } catch {
    // Nada que borrar.
  }
}
