import { VERSION_DEL_FRONTEND } from "./lib/actualizacion/version"

/*
  Solo en producción: en desarrollo el service worker serviría archivos
  cacheados y taparía los cambios recién guardados.

  Se registra de inmediato en vez de esperar al evento load. Esperarlo es
  una optimización heredada de las páginas con muchas imágenes, y aquí
  fallaba: cuando el módulo termina de ejecutarse el evento ya ocurrió,
  así que el listener no disparaba nunca.
*/
export function registrarServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) {
    return
  }

  responderAlServiceWorker(navigator.serviceWorker)

  navigator.serviceWorker
    .register("/sw.js")
    .catch((error) => {
      console.error(
        "No se pudo registrar el service worker:",
        error
      )
    })
}

/*
  El service worker pregunta a cada ventana si es una versión actual: las
  anteriores al aviso de actualización no contestan, y esas las recarga él
  cuando pasan a segundo plano (public/sw.js). Esta sí contesta, y se
  actualiza con su propio aviso de 15 segundos.
*/
export function responderAlServiceWorker(contenedor) {
  contenedor.addEventListener("message", (evento) => {
    if (evento.data?.tipo === "IDENTIFICATE") {
      evento.source?.postMessage({ tipo: "SOY_ACTUAL", version: VERSION_DEL_FRONTEND })
    }
  })
}
