/*
  El almacén local de la aplicación: uno por página, abierto la primera vez
  que alguien lo pide. Lo comparten el inicio de sesión (perfil sin
  conexión) y el POS (copia y cola).

  Si otra pestaña con una versión nueva pide actualizar el esquema, esta
  cierra su conexión (no la bloquea) y avisa con EVENTO_DE_VERSION para
  pedir recargar. El siguiente pedido vuelve a abrir.

  Sin IndexedDB (navegador sin soporte, modo privado estricto) la promesa
  se rechaza: quien lo usa decide qué hacer, y el resto de la aplicación
  sigue funcionando en línea.
*/
import { abrirAlmacen } from "./almacen"

export const EVENTO_DE_VERSION = "lunacell:almacen-desactualizado"

let promesa = null

export function almacenDeLaApp() {
  if (!promesa) {
    promesa = abrirAlmacen({
      alCambiarVersion: () => {
        promesa = null
        globalThis.dispatchEvent?.(new Event(EVENTO_DE_VERSION))
      },
    })

    promesa.catch(() => {
      promesa = null
    })
  }

  return promesa
}
