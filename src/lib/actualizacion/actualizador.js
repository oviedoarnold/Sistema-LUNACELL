/*
  Las piezas de la actualización automática, sin React.

  - Qué versión está publicada: /version.json, un archivo estático que
    escribe la misma compilación con el mismo SHA que devuelve /api/health.
    No se consulta /api/health porque esa ruta revisa la base de datos y la
    autenticación en cada llamada: preguntarle desde cada teléfono cada pocos
    minutos sería carga sin ningún beneficio.
  - Cuándo se puede volver a recargar: si después de recargar se sigue
    viendo la versión vieja (una caché intermedia, un despliegue a medias),
    no se recarga en bucle. Cada intento hacia una misma versión espera más
    que el anterior, hasta media hora, y nunca deja de intentarlo.
  - Cómo se instala: si hay un service worker nuevo esperando, se le pide
    que se active y se recarga cuando ya controla la página. Nada de esto
    borra el almacenamiento local, la base local ni la sesión.
*/

export const SEGUNDOS_DE_AVISO = 15
export const CADA_CUANTO = 5 * 60 * 1000
export const ESPERA_ENTRE_CONSULTAS = 60 * 1000

const CLAVE = "lunacell:actualizacion"
const PRIMERA_ESPERA = 2 * 60 * 1000
const ESPERA_MAXIMA = 30 * 60 * 1000

const FORMA_DE_VERSION = /^[0-9a-f]{7}$/

export async function versionPublicada(pedir = globalThis.fetch) {
  try {
    const respuesta = await pedir(`/version.json?t=${Date.now()}`, { cache: "no-store" })

    if (!respuesta?.ok) return null

    const { version } = await respuesta.json()

    return typeof version === "string" && FORMA_DE_VERSION.test(version) ? version : null
  } catch {
    return null
  }
}

// Solo hay algo que instalar si las dos versiones son de despliegue y distintas.
export const hayVersionNueva = (actual, publicada) =>
  FORMA_DE_VERSION.test(actual || "") && FORMA_DE_VERSION.test(publicada || "") && actual !== publicada

// ── Intentos de recarga ──────────────────────────────────────

function leer(almacen) {
  try {
    const registro = JSON.parse(almacen?.getItem(CLAVE) || "null")

    return registro && typeof registro.objetivo === "string" ? registro : null
  } catch {
    return null
  }
}

function escribir(almacen, registro) {
  try {
    if (registro) almacen?.setItem(CLAVE, JSON.stringify(registro))
    else almacen?.removeItem(CLAVE)
  } catch {
    // Sin almacenamiento la recarga sigue funcionando; solo se pierde el freno contra ciclos.
  }
}

export function esperaParaRecargar(almacen, objetivo, ahora = Date.now()) {
  const registro = leer(almacen)

  if (!registro || registro.objetivo !== objetivo) return 0

  const espera = Math.min(PRIMERA_ESPERA * 2 ** (registro.intentos - 1), ESPERA_MAXIMA)

  return Math.max(0, registro.ultimo + espera - ahora)
}

export function anotarIntento(almacen, objetivo, ahora = Date.now()) {
  const registro = leer(almacen)
  const intentos = registro?.objetivo === objetivo ? registro.intentos + 1 : 1

  escribir(almacen, { objetivo, intentos, ultimo: ahora })
}

// Al arrancar con la versión que se buscaba, el registro ya no hace falta.
export function olvidarSiYaSeInstalo(almacen, actual) {
  if (leer(almacen)?.objetivo === actual) escribir(almacen, null)
}

// ── Service worker ───────────────────────────────────────────

const registroDelServiceWorker = (sw) => sw?.getRegistration?.().catch(() => null) ?? Promise.resolve(null)

// Que el navegador busque ya el service worker nuevo, para precargar la versión durante el aviso.
export async function buscarServiceWorkerNuevo(sw = globalThis.navigator?.serviceWorker) {
  const registro = await registroDelServiceWorker(sw)

  await registro?.update?.().catch(() => {})
}

function esperarInstalado(trabajador, ms) {
  return new Promise((resolve) => {
    if (!trabajador || trabajador.state !== "installing") return resolve()

    const listo = () => {
      if (trabajador.state !== "installing") resolve()
    }

    trabajador.addEventListener?.("statechange", listo)
    setTimeout(resolve, ms)
  })
}

function activarYEsperar(sw, trabajador, ms) {
  return new Promise((resolve) => {
    sw.addEventListener?.("controllerchange", () => resolve(), { once: true })
    setTimeout(resolve, ms)
    trabajador.postMessage({ tipo: "ACTIVAR" })
  })
}

/*
  La página ya es la versión publicada y quedó un service worker esperando
  (por ejemplo, el primero que se instala después de publicar esta función):
  se activa sin recargar, porque no hay nada que cambiar en pantalla.
*/
export async function activarServiceWorkerEnEspera(sw = globalThis.navigator?.serviceWorker) {
  const registro = await registroDelServiceWorker(sw)

  registro?.waiting?.postMessage({ tipo: "ACTIVAR" })
}

export async function instalarVersionNueva({
  sw = globalThis.navigator?.serviceWorker,
  recargar = () => globalThis.location.reload(),
  esperaMaxima = 10000,
} = {}) {
  const registro = await registroDelServiceWorker(sw)

  await esperarInstalado(registro?.installing, esperaMaxima)

  if (registro?.waiting) await activarYEsperar(sw, registro.waiting, esperaMaxima / 2)

  recargar()
}
