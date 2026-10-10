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

/*
  Al cerrar sesión, o cuando el servidor dice que la cuenta ya no tiene
  acceso, se borra el perfil y la copia local de ese usuario (catálogo,
  precios y clientes): ya no sirven para nada y son datos de la empresa.
  Sus ventas sin sincronizar NO se borran: se envían cuando vuelva a entrar.
*/
export async function olvidarPerfil(authId = null) {
  try {
    const almacen = await almacenDeLaApp()

    await borrarPerfilLocal(almacen)

    if (authId) {
      await almacen.transaccion(["copias"], "readwrite", async (t) => {
        for (const copia of await t.todos("copias")) {
          if (copia.usuarioAuth === authId) await t.borrar("copias", copia.id)
        }
      })
    }
  } catch {
    // Nada que borrar.
  }
}
