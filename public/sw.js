/*
  Service Worker de LUNACELL.

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

const CACHE_NAME = "lunacell-v1"

const ARCHIVOS_BASE = [
  "/",
  "/index.html",
  "/login.html",
  "/manifest.webmanifest",
  "/favicon.png",
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

/*
  La versión nueva se instala y precarga, pero no toma el control sola.

  Antes llamaba a skipWaiting() aquí y se activaba en cuanto terminaba de
  instalarse, con la página abierta en medio de una venta. Ahora espera a que
  la aplicación decida que es seguro (src/lib/actualizacion): sin carrito,
  sin venta ni pedido en envío, sin abono abierto y con conexión. Entonces
  le manda {tipo: "ACTIVAR"} y recarga. La primera instalación no espera:
  no hay versión anterior a la que reemplazar.

  Tampoco espera si ninguna página abierta sabe pedírselo: son instalaciones
  anteriores al aviso de actualización (antes del PR #89), cuyo código nunca
  manda la orden. Esperarlas sería dejarlas en la versión vieja para siempre.
  Activarse no recarga nada; lo que las lleva a la versión nueva es
  vigilarSiEsAntigua(), más abajo.
*/
self.addEventListener("install", (event) => {
  event.waitUntil(
    precargar().then(async () => {
      if (self.registration.active && !(await hayPaginaActual())) {
        await self.skipWaiting()
      }
    })
  )
})

/*
  Solo obedece a páginas de su mismo origen. Algunos navegadores no llenan
  event.origin en los mensajes de un cliente; entonces se mira la dirección
  de la página que lo mandó.
*/
function origenDeLaPagina(cliente) {
  try {
    return new URL(cliente.url).origin
  } catch {
    return ""
  }
}

self.addEventListener("message", (event) => {
  // Otro origen, o sin origen y desde una página de otro sitio: se ignora.
  if (event.origin !== self.location.origin && (event.origin || origenDeLaPagina(event.source) !== self.location.origin)) {
    return
  }

  if (event.data && event.data.tipo === "ACTIVAR") {
    self.skipWaiting()
  }

  if (event.data && event.data.tipo === "SOY_ACTUAL" && event.source) {
    marcarActual(event.source.id)
  }
})

/*
  ── Las instalaciones anteriores al aviso de actualización ──

  Una PWA instalada casi nunca se recarga: al tocar el ícono, el sistema
  retoma la ventana que estaba en segundo plano, con el JavaScript que
  tenía. El código anterior al PR #89 no sabe buscar versiones nuevas, así
  que se quedaba en la versión vieja indefinidamente, aunque el navegador
  ya mostrara la nueva.

  Este service worker reconoce esas ventanas y las recarga él mismo, en
  cuanto pasan a segundo plano:
  - Una página actual contesta {tipo: "SOY_ACTUAL"} cuando se le pregunta, o
    consulta /version.json por su cuenta. Esas se actualizan solas con su
    aviso de 15 segundos y nunca se recargan desde aquí.
  - Solo se decide que una página es antigua si se le preguntó estando a la
    vista y no contestó: una oculta puede estar congelada por el sistema.
  - Se recarga solo cuando está oculta (el vendedor no la está usando) y sin
    escrituras en los últimos 15 segundos (una venta o un cobro enviándose).
    Recargar no borra el almacenamiento: la sesión y las ventas sin conexión
    guardadas siguen ahí.
*/
const ACTUALES = new Set()
const VIGILADAS = new Set()
const OCULTAS_AL_ACTIVAR = new Set()
const ULTIMA_ESCRITURA = new Map()
const PREGUNTAS = new Map()

const PLAZO_DE_RESPUESTA = 3000
const SIN_ESCRITURAS = 15000
const CADA_CUANTO_SE_MIRA = 3000
const VIGILANCIA_MAXIMA = 4 * 60 * 1000

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function marcarActual(id) {
  if (!id) return

  ACTUALES.add(id)
  const respuesta = PREGUNTAS.get(id)

  if (respuesta) respuesta(true)
}

function preguntarSiEsActual(cliente) {
  if (ACTUALES.has(cliente.id)) return Promise.resolve(true)

  return new Promise((resolve) => {
    const terminar = (valor) => {
      clearTimeout(plazo)
      PREGUNTAS.delete(cliente.id)
      resolve(valor)
    }
    const plazo = setTimeout(() => terminar(false), PLAZO_DE_RESPUESTA)

    PREGUNTAS.set(cliente.id, terminar)

    try {
      cliente.postMessage({ tipo: "IDENTIFICATE" })
    } catch {
      terminar(false)
    }
  })
}

async function hayPaginaActual() {
  const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  const respuestas = await Promise.all(clientes.map(preguntarSiEsActual))

  return respuestas.some(Boolean)
}

/*
  Las ventanas que estaban en segundo plano cuando esta versión se activó.
  Si una resulta antigua, su primera petición a la vista es la de alguien
  que acaba de volver a abrir la app: se recarga ahí mismo, para que vea la
  versión nueva sin esperar a dejarla otra vez.
*/
async function anotarOcultasAlActivar() {
  const clientes = await self.clients.matchAll({ type: "window" })

  for (const cliente of clientes) {
    if (cliente.visibilityState === "hidden") OCULTAS_AL_ACTIVAR.add(cliente.id)
  }
}

const sinEscriturasRecientes = (id) => Date.now() - (ULTIMA_ESCRITURA.get(id) || 0) > SIN_ESCRITURAS

async function vigilarSiEsAntigua(id) {
  if (!id || ACTUALES.has(id) || VIGILADAS.has(id)) return

  VIGILADAS.add(id)

  try {
    const cliente = await self.clients.get(id)

    if (!cliente || cliente.type !== "window" || cliente.visibilityState !== "visible") return
    if (await preguntarSiEsActual(cliente)) return

    if (OCULTAS_AL_ACTIVAR.delete(id) && sinEscriturasRecientes(id)) {
      await cliente.navigate(cliente.url).catch(() => {})
      return
    }

    const hasta = Date.now() + VIGILANCIA_MAXIMA

    while (Date.now() < hasta) {
      await pausa(CADA_CUANTO_SE_MIRA)

      if (ACTUALES.has(id)) return

      const ahora = await self.clients.get(id)

      if (!ahora) return

      if (ahora.visibilityState === "hidden" && sinEscriturasRecientes(id)) {
        await ahora.navigate(ahora.url).catch(() => {})
        return
      }
    }
  } finally {
    VIGILADAS.delete(id)
  }
}

/*
  Borra los archivos con hash de compilaciones anteriores.

  Dentro de una misma version del cache se limpian solo las entradas de
  /assets/ que ya no estan en esta compilacion, que son exactamente las que
  nadie va a volver a pedir. Lo demas —el index, los iconos— se conserva,
  porque tirarlo obligaria a volver a descargarlo sin motivo.

  El cambio de version del cache es otra cosa y lo resuelve activate:
  cualquier cache con nombre distinto al actual se borra entera. Asi se
  retiro "ferreteria-v1", heredado del sistema anterior, sin pedirle nada
  al usuario.
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

/*
  Al activar se borra toda cache que no sea la de esta version.

  Es lo que retira de golpe la cache de una version anterior —incluida
  "ferreteria-v1", la del sistema del que salio este— en el primer arranque
  despues de desplegar. Con clients.claim() aqui, el service worker nuevo
  toma el control de las pestañas abiertas en cuanto la aplicación lo activa,
  sin esperar a que el usuario las cierre todas.
*/
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
      .then(anotarOcultasAlActivar)
  )
})

function esArchivoPropio(url) {
  return url.origin === self.location.origin
}

/*
  Lo que siempre va a la red: la versión publicada y las funciones del
  servidor. Respondidas desde la caché, la aplicación creería que no hay
  versión nueva y el healthcheck contestaría siempre lo mismo.
*/
function vaSiempreALaRed(url) {
  return url.pathname === "/version.json" || url.pathname.startsWith("/api/")
}

/*
  Guardar en cache es un refresco en segundo plano. Si falla —cuota llena,
  almacenamiento denegado— la respuesta ya esta servida y no hay que
  romperla; pero tampoco debe desaparecer sin rastro, asi que queda escrito
  en la consola del service worker, que es donde se mira cuando algo no se
  actualiza.
*/
async function guardarEnCache(cache, clave, respuesta) {
  try {
    await cache.put(clave, respuesta)
  } catch (error) {
    console.warn("[sw] no se pudo guardar en cache:", clave, error)
  }
}

async function responderConCacheYActualizar(request) {
  const cache = await caches.open(CACHE_NAME)
  const enCache = await cache.match(request)

  const descarga = fetch(request)
    .then(async (respuesta) => {
      if (respuesta && respuesta.ok) {
        await guardarEnCache(cache, request, respuesta.clone())
      }

      return respuesta
    })
    .catch(() => null)

  return enCache || (await descarga) || caches.match("/offline.html")
}

/*
  La navegación siempre resuelve al index: la aplicación es de una sola
  página y el enrutado ocurre en el navegador.

  Solo se guarda como index una página servida bien y sin redirección. El
  middleware manda al login a quien abre una pantalla privada sin sesión, y
  el navegador entrega ese 307 aquí sin seguirlo: guardado como index, sin
  red la aplicación respondería con esa redirección en vez de abrir.
*/
function esLaAplicacion(respuesta) {
  return respuesta.ok && respuesta.type === "basic" && !respuesta.redirected
}

async function responderNavegacion(request) {
  try {
    const respuesta = await fetch(request)

    if (esLaAplicacion(respuesta)) {
      const cache = await caches.open(CACHE_NAME)

      await guardarEnCache(cache, "/index.html", respuesta.clone())
    }

    return respuesta
  } catch {
    const cache = await caches.open(CACHE_NAME)

    return (
      (await cache.match("/index.html")) ||
      (await cache.match("/offline.html"))
    )
  }
}

/*
  Cada petición de una página dice algo de ella: si escribe (una venta, un
  cobro), si consulta /version.json (es actual) y, si nada de eso la
  identifica todavía, se averigua si es una instalación antigua.
*/
function observarPagina(event, url) {
  const id = event.clientId

  if (!id) return

  if (event.request.method !== "GET") ULTIMA_ESCRITURA.set(id, Date.now())

  if (esArchivoPropio(url) && url.pathname === "/version.json") {
    marcarActual(id)
    return
  }

  event.waitUntil(vigilarSiEsAntigua(id))
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)

  observarPagina(event, url)

  if (request.method !== "GET") {
    return
  }

  if (!esArchivoPropio(url) || vaSiempreALaRed(url)) {
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(responderNavegacion(request))
    return
  }

  event.respondWith(responderConCacheYActualizar(request))
})
