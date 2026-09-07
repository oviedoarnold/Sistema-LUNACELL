/*
  Service Worker del Sistema Ferretería.

  Estrategia principal: stale-while-revalidate sobre los archivos propios.
  Se responde de inmediato con lo que hay en caché y en segundo plano se
  descarga la versión nueva para el próximo arranque. En un mostrador
  importa más abrir rápido que tener el último byte.

  Los datos del negocio no pasan por aquí, y eso hoy es una limitación:
  desde que viven en PostgreSQL, consultarlos exige conexión. Antes estaban
  en localStorage y el mostrador seguía facturando desconectado. Recuperar
  eso pide una caché de datos con cola de sincronización, que no está
  hecha; mientras tanto, sin señal la pantalla abre pero no hay con qué
  llenarla.
*/

const CACHE_NAME = "ferreteria-v1"

const ARCHIVOS_BASE = [
  "/",
  "/index.html",
  "/login.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/offline.html",
]

/*
  Los archivos que produce la compilacion llevan el hash del contenido en
  el nombre, asi que este archivo no puede saberlos de antemano: la lista
  la inyecta el paso de compilacion.

  Sin ella, una instalacion nueva guardaba el HTML pero no el JavaScript
  que lo hace funcionar, y abrir la aplicacion sin conexion mostraba una
  pantalla en blanco. Solo servia si el usuario ya habia entrado antes con
  red y el navegador habia cacheado los archivos por su cuenta.
*/
const ARCHIVOS_DEL_BUILD = []

const TODO_LO_PRECARGADO = [...ARCHIVOS_BASE, ...ARCHIVOS_DEL_BUILD]

/*
  Se guarda archivo por archivo y no con addAll, que falla entero si uno
  solo falla. Con addAll, un archivo que no respondiera dejaría al service
  worker sin instalar y sin nada en caché; así, lo que se pudo guardar
  queda guardado.
*/
async function precargar() {
  const cache = await caches.open(CACHE_NAME)

  const resultados = await Promise.allSettled(
    TODO_LO_PRECARGADO.map((ruta) => cache.add(ruta))
  )

  const fallidos = resultados.filter((r) => r.status === "rejected").length

  if (fallidos > 0) {
    console.warn(
      "Service Worker: " +
        fallidos +
        " de " +
        TODO_LO_PRECARGADO.length +
        " archivos no se pudieron precargar."
    )
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precargar().then(() => self.skipWaiting()))
})

/*
  Borra los archivos con hash de compilaciones anteriores.

  El nombre del cache no lleva version a proposito: cambiarlo tiraria
  tambien lo que se fue guardando en uso. Se limpian solo las entradas de
  /assets/ que ya no estan en esta compilacion, que son exactamente las que
  nadie va a volver a pedir.
*/
async function limpiarAssetsViejos() {
  const cache = await caches.open(CACHE_NAME)
  const guardados = await cache.keys()
  const vigentes = new Set(ARCHIVOS_DEL_BUILD)

  await Promise.all(
    guardados
      .filter((peticion) => {
        const ruta = new URL(peticion.url).pathname

        return ruta.startsWith("/assets/") && !vigentes.has(ruta)
      })
      .map((peticion) => cache.delete(peticion))
  )
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter((nombre) => nombre !== CACHE_NAME)
            .map((nombre) => caches.delete(nombre))
        )
      )
      .then(limpiarAssetsViejos)
      .then(() => self.clients.claim())
  )
})

function esArchivoPropio(url) {
  return url.origin === self.location.origin
}

async function responderConCacheYActualizar(request) {
  const cache = await caches.open(CACHE_NAME)
  const enCache = await cache.match(request)

  const descarga = fetch(request)
    .then((respuesta) => {
      if (respuesta && respuesta.ok) {
        cache.put(request, respuesta.clone())
      }

      return respuesta
    })
    .catch(() => null)

  return enCache || (await descarga) || caches.match("/offline.html")
}

/*
  La navegación siempre resuelve al index: la aplicación es de una sola
  página y el enrutado ocurre en el navegador.
*/
async function responderNavegacion(request) {
  try {
    const respuesta = await fetch(request)
    const cache = await caches.open(CACHE_NAME)

    cache.put("/index.html", respuesta.clone())

    return respuesta
  } catch {
    const cache = await caches.open(CACHE_NAME)

    return (
      (await cache.match("/index.html")) ||
      (await cache.match("/offline.html"))
    )
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event

  if (request.method !== "GET") {
    return
  }

  const url = new URL(request.url)

  if (!esArchivoPropio(url)) {
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(responderNavegacion(request))
    return
  }

  event.respondWith(responderConCacheYActualizar(request))
})
