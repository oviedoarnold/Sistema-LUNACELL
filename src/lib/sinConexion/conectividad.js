/*
  Cuándo sincronizar.

  navigator.onLine solo dice si hay una interfaz de red, no si hay internet
  (un wifi sin salida, un portal cautivo, datos agotados): se usa como pista
  para NO intentar cuando dice que no hay red, nunca como prueba de que sí
  la hay. La prueba es preguntar al servidor (`hayServidor`).

  Se sincroniza:
  - al iniciar la app;
  - al volver la conexión (evento online);
  - al volver a primer plano (visibilitychange, pageshow desde la caché);
  - cada `periodo` mientras queden ventas pendientes y la app esté visible;
  - tras un fallo de red, con espera progresiva (5 s … 2 min);
  - cuando se pide a mano (`ahora`).

  En segundo plano no se programa nada: el navegador congelaría o mataría
  los temporizadores igual. Al volver a primer plano se retoma.

  Nunca corren dos rondas a la vez: lo que se pide durante una ronda se
  junta en UNA ronda más al terminar.
*/

export const ESPERAS = [5000, 15000, 30000, 60000, 120000]

export function esperaTrasFallos(fallos) {
  return ESPERAS[Math.min(fallos, ESPERAS.length - 1)]
}

export async function hayServidor({ fetch = globalThis.fetch, url, clave, tiempo = 5000 }) {
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), tiempo)

  try {
    const respuesta = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: clave },
      signal: control.signal,
      cache: "no-store",
    })

    return Boolean(respuesta?.ok)
  } catch {
    return false
  } finally {
    clearTimeout(reloj)
  }
}

export function crearProgramador({
  sincronizar,
  hayServidor: preguntar,
  ventana = globalThis.window,
  documento = globalThis.document,
  temporizador = globalThis,
  periodo = 45000,
}) {
  let fallos = 0
  let temporizadorId = null
  let enCurso = null
  let otraRonda = false
  let activo = false

  const visible = () => documento?.visibilityState !== "hidden"
  const conRed = () => ventana?.navigator?.onLine !== false

  function cancelar() {
    if (temporizadorId !== null) temporizador.clearTimeout(temporizadorId)
    temporizadorId = null
  }

  function programar(ms) {
    cancelar()
    if (!activo || !visible()) return

    temporizadorId = temporizador.setTimeout(() => {
      temporizadorId = null
      return ahora()
    }, ms)
  }

  function trasFallo() {
    programar(esperaTrasFallos(fallos))
    fallos += 1
  }

  async function ronda() {
    if (!conRed()) return

    if (!(await preguntar())) return trasFallo()

    let resultado
    try {
      resultado = await sincronizar()
    } catch {
      return trasFallo()
    }

    if (resultado?.detenidoPor === "red") return trasFallo()

    fallos = 0

    if (resultado?.pendientes > 0) programar(periodo)
    else cancelar()
  }

  function ahora() {
    if (enCurso) {
      otraRonda = true
      return enCurso
    }

    enCurso = (async () => {
      try {
        do {
          otraRonda = false
          await ronda()
        } while (otraRonda)
      } finally {
        enCurso = null
      }
    })()

    return enCurso
  }

  const alVolverLaRed = () => ahora()
  const alPerderLaRed = () => cancelar()
  const alCambiarVisibilidad = () => (visible() ? ahora() : cancelar())
  const alMostrarse = (evento) => {
    if (evento?.persisted) ahora()
  }

  return {
    iniciar() {
      if (activo) return enCurso ?? Promise.resolve()
      activo = true

      ventana?.addEventListener?.("online", alVolverLaRed)
      ventana?.addEventListener?.("offline", alPerderLaRed)
      ventana?.addEventListener?.("pageshow", alMostrarse)
      documento?.addEventListener?.("visibilitychange", alCambiarVisibilidad)

      return ahora()
    },

    detener() {
      activo = false
      cancelar()

      ventana?.removeEventListener?.("online", alVolverLaRed)
      ventana?.removeEventListener?.("offline", alPerderLaRed)
      ventana?.removeEventListener?.("pageshow", alMostrarse)
      documento?.removeEventListener?.("visibilitychange", alCambiarVisibilidad)
    },

    ahora,
  }
}
