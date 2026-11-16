import { useEffect, useRef, useState } from "react"
import { FaSyncAlt } from "react-icons/fa"

import {
  CADA_CUANTO,
  ESPERA_ENTRE_CONSULTAS,
  SEGUNDOS_DE_AVISO,
  activarServiceWorkerEnEspera,
  anotarIntento,
  buscarServiceWorkerNuevo,
  esperaParaRecargar,
  hayVersionNueva,
  instalarVersionNueva,
  olvidarSiYaSeInstalo,
  versionPublicada,
} from "../lib/actualizacion/actualizador"
import { escucharBloqueos, hayOperacionEnCurso } from "../lib/actualizacion/bloqueos"
import { VERSION_DEL_FRONTEND } from "../lib/actualizacion/version"

/*
  Actualización automática obligatoria.

  Cuando se publica una versión nueva, avisa y cuenta 15 segundos. Al llegar
  a cero la instala y recarga, sin pedir nada al vendedor y sin opción de
  posponerla. Solo espera si recargar destruiría algo (un carrito, una venta
  o un pedido en envío, un abono abierto, una sincronización) o si no hay
  conexión; en cuanto deja de haberlo, instala sola.

  Busca versiones al abrir, al volver a la aplicación, al recuperar la
  conexión y cada cinco minutos con la pantalla a la vista, con un mínimo de
  un minuto entre consultas.
*/

const sessionStorageSeguro = () => {
  try {
    return globalThis.sessionStorage
  } catch {
    return null
  }
}

function textoDelAviso({ segundos, bloqueado, enLinea, enEspera }) {
  if (segundos > 0) {
    return `Hay una nueva versión de LUNACELL disponible. Se instalará automáticamente en ${segundos} ${segundos === 1 ? "segundo" : "segundos"}.`
  }

  if (!enLinea) return "Actualización pendiente. Se instalará automáticamente al recuperar la conexión."

  if (bloqueado) return "Actualización pendiente. Se instalará automáticamente al finalizar la operación actual."

  if (enEspera) return "Actualización pendiente. Se volverá a intentar automáticamente en unos minutos."

  return "Instalando la nueva versión de LUNACELL…"
}

function AvisoDeActualizacion({ version = VERSION_DEL_FRONTEND, instalar = instalarVersionNueva, consultar = versionPublicada }) {
  const activo = version !== "local"
  const [objetivo, setObjetivo] = useState(null)
  const [segundos, setSegundos] = useState(null)
  const [bloqueado, setBloqueado] = useState(hayOperacionEnCurso)
  const [enLinea, setEnLinea] = useState(() => globalThis.navigator?.onLine !== false)
  const [reintento, setReintento] = useState(0)
  const [enEspera, setEnEspera] = useState(false)
  const objetivoRef = useRef(null)
  const instalandoRef = useRef(false)

  // Lo que la impide ahora mismo: una operación en curso o la falta de conexión.
  useEffect(() => {
    const alConectar = () => setEnLinea(true)
    const alDesconectar = () => setEnLinea(false)

    window.addEventListener("online", alConectar)
    window.addEventListener("offline", alDesconectar)

    const soltar = escucharBloqueos(setBloqueado)

    return () => {
      window.removeEventListener("online", alConectar)
      window.removeEventListener("offline", alDesconectar)
      soltar()
    }
  }, [])

  // Buscar versiones nuevas.
  useEffect(() => {
    if (!activo) return undefined

    olvidarSiYaSeInstalo(sessionStorageSeguro(), version)

    let vigente = true
    let ultima = 0

    const revisar = (siempre = false) => {
      const ahora = Date.now()

      if (!siempre && ahora - ultima < ESPERA_ENTRE_CONSULTAS) return

      ultima = ahora

      consultar()
        .then((publicada) => {
          if (!vigente || !publicada) return

          if (!hayVersionNueva(version, publicada)) {
            if (publicada === version) void activarServiceWorkerEnEspera()
            return
          }

          if (objetivoRef.current) return

          objetivoRef.current = publicada
          setObjetivo(publicada)
          setSegundos(SEGUNDOS_DE_AVISO)
          void buscarServiceWorkerNuevo()
        })
        // Una consulta fallida no cambia nada: se repite en la próxima ocasión.
        .catch(() => {})
    }

    revisar(true)

    const alVolver = () => {
      if (document.visibilityState === "visible") revisar()
    }
    const alConectar = () => revisar(true)
    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") revisar()
    }, CADA_CUANTO)

    document.addEventListener("visibilitychange", alVolver)
    window.addEventListener("online", alConectar)

    return () => {
      vigente = false
      window.clearInterval(reloj)
      document.removeEventListener("visibilitychange", alVolver)
      window.removeEventListener("online", alConectar)
    }
  }, [activo, version, consultar])

  // La cuenta regresiva.
  useEffect(() => {
    if (!(segundos > 0)) return undefined

    const paso = window.setTimeout(() => setSegundos((s) => s - 1), 1000)

    return () => window.clearTimeout(paso)
  }, [segundos])

  // Al llegar a cero, y en cuanto sea seguro: instalar.
  const listo = Boolean(objetivo) && segundos === 0 && !bloqueado && enLinea

  useEffect(() => {
    if (!listo || instalandoRef.current) return undefined

    const almacen = sessionStorageSeguro()
    const espera = esperaParaRecargar(almacen, objetivo)

    // Ya se recargó hacia esta versión y seguía la vieja: se reintenta más tarde, nunca en bucle.
    if (espera > 0) {
      const marcar = window.setTimeout(() => setEnEspera(true), 0)
      const luego = window.setTimeout(() => {
        setEnEspera(false)
        setReintento((n) => n + 1)
      }, espera)

      return () => {
        window.clearTimeout(marcar)
        window.clearTimeout(luego)
      }
    }

    instalandoRef.current = true
    anotarIntento(almacen, objetivo)
    void instalar()

    return undefined
  }, [listo, objetivo, reintento, instalar])

  if (!objetivo) return null

  return (
    <div className="aviso-actualizacion" role="status" aria-live="polite">
      <FaSyncAlt className="aviso-actualizacion-icono" aria-hidden="true" />
      <p className="aviso-actualizacion-texto">{textoDelAviso({ segundos, bloqueado, enLinea, enEspera })}</p>
      {segundos > 0 && (
        <span className="aviso-actualizacion-cuenta" aria-hidden="true">
          {segundos}
        </span>
      )}
    </div>
  )
}

export default AvisoDeActualizacion
