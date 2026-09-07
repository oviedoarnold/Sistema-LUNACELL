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

  navigator.serviceWorker
    .register("/sw.js")
    .catch((error) => {
      console.error(
        "No se pudo registrar el service worker:",
        error
      )
    })
}
