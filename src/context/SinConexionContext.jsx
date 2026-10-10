import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { SinConexionContext } from "./contexts"
import { PERMISSIONS } from "./permissions"
import { useAuth } from "../hooks/useAuth"
import { supabase } from "../lib/supabase"
import { descargarCopia } from "../lib/api/copiaSinConexion"
import { crearConsultaDeConciliaciones, crearEnvio, crearVerificacionEnLinea } from "../lib/api/ventasSinConexion"
import { almacenDeLaApp, EVENTO_DE_VERSION } from "../lib/sinConexion/almacenDeLaApp"
import { crearProgramador, hayServidor } from "../lib/sinConexion/conectividad"
import { antiguedadDeCopia, disponibleLocal, guardarCopia, leerCopia } from "../lib/sinConexion/copiaLocal"
import { ESTADOS, guardarVenta, marcar, ventasDelUsuario, ventasNoConfirmadas } from "../lib/sinConexion/cola"
import { codigoCorto, idDelDispositivo } from "../lib/sinConexion/dispositivo"
import { exportarCifrado } from "../lib/sinConexion/exportacion"
import { pedirAlmacenamientoPersistente } from "../lib/sinConexion/persistencia"
import { perfilSigueVigente } from "../lib/sinConexion/perfilLocal"
import { crearSincronizador } from "../lib/sinConexion/sincronizador"
import { construirVentaLocal } from "../lib/sinConexion/venta"

/*
  El modo sin conexión del POS (OFF-1.3): une el motor de OFF-1.2 con la
  sesión y la pantalla.

  - Mientras hay servidor, descarga la copia local de la ubicación del
    vendedor (catálogo y clientes solo si está habilitada).
  - Dice si hay servidor de verdad: navigator.onLine solo es una pista.
  - Sincroniza solo: al abrir, al volver la red, al volver a primer plano y
    cada poco mientras haya pendientes; y a mano.
  - Guarda las ventas sin conexión en el teléfono antes de mostrarlas.
  - Exporta el respaldo cifrado sin borrar nada.

  Nunca presenta una venta pendiente como registrada: el estado de cada una
  es el que dejó el servidor (registrada, en conciliación) o pendiente.

  Lo leído del teléfono se guarda junto a su dueño (empresa, usuario y
  ubicación): si cambia el usuario o su ubicación, lo anterior deja de
  valer en ese mismo render y nunca se mezclan.

  Las dependencias se pueden reemplazar en pruebas; por omisión son las
  reales.
*/

const MINUTOS_ENTRE_COPIAS = 15
const MINUTO = 60000

const FINALES = new Set([ESTADOS.REGISTRADA, ESTADOS.EN_CONCILIACION])

const comprobarServidorPorOmision = () =>
  hayServidor({ url: import.meta.env.VITE_SUPABASE_URL, clave: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY })

const ahoraPorOmision = () => new Date()

const fechaDeArchivo = (fecha) => fecha.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")

export function SinConexionProvider({
  children,
  abrir = almacenDeLaApp,
  cliente = supabase,
  comprobarServidor = comprobarServidorPorOmision,
  descargar = descargarCopia,
  ventana = globalThis.window,
  documento = globalThis.document,
  temporizador = globalThis,
  locks,
  ahora = ahoraPorOmision,
}) {
  const { user, hasPermission, revalidarSesion } = useAuth()

  const authId = user?.authId || ""
  const empresaId = user?.empresa_id || ""
  const ubicacionId = user?.locationId || ""
  const esAdmin = user?.role === "admin"
  const perfilSinConexion = Boolean(user?.sinConexion)
  const hayUsuario = Boolean(user)
  const puedeFacturar = hayUsuario && hasPermission(PERMISSIONS.POS)
  const claveDelDueno = authId && empresaId ? `${empresaId}|${authId}|${ubicacionId}` : ""

  // ── almacén y dispositivo ─────────────────────────────
  const [apertura, setApertura] = useState({ almacen: null, dispositivo: "", error: "" })
  const [actualizacionPendiente, setActualizacionPendiente] = useState(false)

  useEffect(() => {
    let sigue = true

    abrir()
      .then(async (abierto) => {
        const dispositivo = await idDelDispositivo(abierto)
        if (sigue) setApertura({ almacen: abierto, dispositivo, error: "" })
      })
      .catch((error) => {
        if (sigue) {
          setApertura({
            almacen: null,
            dispositivo: "",
            error: error?.message || "Este navegador no permite guardar ventas sin conexión.",
          })
        }
      })

    const alDesactualizarse = () => setActualizacionPendiente(true)
    ventana?.addEventListener?.(EVENTO_DE_VERSION, alDesactualizarse)

    return () => {
      sigue = false
      ventana?.removeEventListener?.(EVENTO_DE_VERSION, alDesactualizarse)
    }
  }, [abrir, ventana])

  // Con otra versión del esquema abierta, esta conexión ya se cerró.
  const almacen = actualizacionPendiente ? null : apertura.almacen
  const dispositivo = apertura.dispositivo

  // ── lo guardado en el teléfono para este dueño ─────────
  const [local, setLocal] = useState(null)
  const [vuelta, setVuelta] = useState(0)
  const refrescarLocal = useCallback(() => setVuelta((n) => n + 1), [])

  useEffect(() => {
    if (!almacen || !claveDelDueno) return undefined

    let sigue = true
    const dueno = { empresaId, usuarioAuth: authId, ubicacionId }

    Promise.all([ventasDelUsuario(almacen, dueno), ubicacionId ? leerCopia(almacen, dueno) : null])
      .then(([ventas, copia]) => {
        if (sigue) setLocal({ clave: claveDelDueno, ventas, copia: copia || null })
      })
      .catch(() => {})

    return () => {
      sigue = false
    }
  }, [almacen, claveDelDueno, empresaId, authId, ubicacionId, vuelta])

  const vigente = local !== null && local.clave === claveDelDueno
  const ventas = useMemo(() => (vigente ? local.ventas : []), [vigente, local])
  const copia = vigente ? local.copia : null

  // ── copia local ────────────────────────────────────────
  const [errorDeCopia, setErrorDeCopia] = useState("")
  const descargandoRef = useRef(false)

  const actualizarCopia = useCallback(
    async ({ forzar = false } = {}) => {
      if (!almacen || !ubicacionId || !hayUsuario || perfilSinConexion || !puedeFacturar) return
      if (descargandoRef.current) return

      const edad = copia ? ahora().getTime() - Date.parse(copia.tomadaEn) : Infinity
      if (!forzar && edad < MINUTOS_ENTRE_COPIAS * MINUTO) return

      descargandoRef.current = true

      try {
        const nueva = await descargar({ perfil: user, ahora })

        if (nueva) await guardarCopia(almacen, nueva)

        setErrorDeCopia("")
        refrescarLocal()
      } catch (error) {
        setErrorDeCopia(error?.message || "No se pudo actualizar la copia local.")
      } finally {
        descargandoRef.current = false
      }
    },
    [almacen, ubicacionId, hayUsuario, perfilSinConexion, puedeFacturar, copia, ahora, descargar, user, refrescarLocal]
  )

  // ── almacenamiento persistente, una vez, al habilitarse ─
  const ubicacionAutorizada = Boolean(copia?.ubicacion?.vendeSinConexion && !copia?.ubicacion?.emiteFiscal)
  const [persistencia, setPersistencia] = useState(null)

  useEffect(() => {
    if (!ubicacionAutorizada || persistencia) return

    void pedirAlmacenamientoPersistente(ventana?.navigator?.storage).then(setPersistencia)
  }, [ubicacionAutorizada, persistencia, ventana])

  // ── sincronización ─────────────────────────────────────
  const sincronizador = useMemo(() => {
    if (!almacen || !cliente) return null

    return crearSincronizador({
      almacen,
      enviar: crearEnvio(cliente, ahora),
      verificarEnLinea: crearVerificacionEnLinea(cliente),
      consultarConciliaciones: crearConsultaDeConciliaciones(cliente),
      ahora,
      locks,
      /*
        Solo con una sesión real del mismo usuario: el servidor vuelve a
        comprobar quién envía cada venta.
      */
      sesionActual: async () => {
        const { data } = await cliente.auth.getSession()
        const sesion = data?.session

        if (!sesion?.user || !empresaId || sesion.user.id !== authId) return null

        return { usuarioAuth: sesion.user.id, empresaId }
      },
    })
  }, [almacen, cliente, ahora, locks, authId, empresaId])

  const [conexion, setConexion] = useState(() => (ventana?.navigator?.onLine === false ? "sin_red" : "comprobando"))
  const [sincronizando, setSincronizando] = useState(false)
  const [ultimaSincronizacion, setUltimaSincronizacion] = useState(null)
  const [errorDeSincronizacion, setErrorDeSincronizacion] = useState("")

  /*
    El programador vive mientras haya usuario; lo que cambia (el
    sincronizador al abrirse el almacén, la copia) lo lee de refs al
    momento de usarlo, sin reiniciarse.
  */
  const sincronizadorRef = useRef(null)
  const actualizarCopiaRef = useRef(null)
  const programadorRef = useRef(null)

  useEffect(() => {
    sincronizadorRef.current = sincronizador
    actualizarCopiaRef.current = actualizarCopia
  }, [sincronizador, actualizarCopia])

  const sincronizarRonda = useCallback(
    async ({ manual = false } = {}) => {
      const actual = sincronizadorRef.current
      if (!actual) return { pendientes: 0 }

      setSincronizando(true)

      try {
        const resumen = await actual.sincronizar({ manual })

        if (!resumen.omitido) {
          setUltimaSincronizacion({ en: ahora().toISOString(), resumen })
          setErrorDeSincronizacion(mensajeDeLaRonda(resumen))
        }

        refrescarLocal()

        if (resumen.registradas > 0 || resumen.enConciliacion > 0) void actualizarCopiaRef.current?.({ forzar: true })

        return resumen
      } catch (error) {
        setErrorDeSincronizacion(error?.message || "No se pudo sincronizar.")
        return { detenidoPor: "red", pendientes: 1 }
      } finally {
        setSincronizando(false)
      }
    },
    [ahora, refrescarLocal]
  )

  const comprobar = useCallback(async () => {
    const hay = await comprobarServidor()

    if (hay) setConexion("en_linea")
    else setConexion(ventana?.navigator?.onLine === false ? "sin_red" : "sin_servidor")

    return hay
  }, [comprobarServidor, ventana])

  useEffect(() => {
    if (!hayUsuario) return undefined

    const programador = crearProgramador({
      sincronizar: () => sincronizarRonda(),
      hayServidor: comprobar,
      ventana,
      documento,
      temporizador,
    })

    programadorRef.current = programador

    const sinRed = () => setConexion("sin_red")
    ventana?.addEventListener?.("offline", sinRed)

    void programador.iniciar()

    return () => {
      ventana?.removeEventListener?.("offline", sinRed)
      programador.detener()
      programadorRef.current = null
    }
  }, [hayUsuario, sincronizarRonda, comprobar, ventana, documento, temporizador])

  // Al abrirse el almacén, que salga lo que haya pendiente.
  useEffect(() => {
    if (sincronizador) void programadorRef.current?.ahora()
  }, [sincronizador])

  /*
    Con servidor: copia al día (también al cambiar de usuario o de
    ubicación, o al abrirse el almacén) y, si se entró sin conexión, perfil
    confirmado.
  */
  useEffect(() => {
    if (conexion !== "en_linea") return

    void actualizarCopiaRef.current?.()
    if (perfilSinConexion) void revalidarSesion?.()
  }, [conexion, claveDelDueno, almacen, perfilSinConexion, revalidarSesion])

  const sincronizarAhora = useCallback(async () => {
    if (!(await comprobar())) {
      setErrorDeSincronizacion("No hay conexión con el servidor. Las ventas siguen guardadas en este teléfono.")
      return { detenidoPor: "red" }
    }

    return sincronizarRonda({ manual: true })
  }, [comprobar, sincronizarRonda])

  // ── vender sin conexión ────────────────────────────────
  const guardarVentaSinConexion = useCallback(
    async (datos) => {
      if (!almacen) throw new Error(apertura.error || "El almacén local no está disponible.")
      if (!ubicacionId) throw new Error("No tienes una ubicación operativa asignada.")

      if (!perfilSigueVigente(user, ahora())) {
        throw new Error("Tu sesión sin conexión venció: conéctate e inicia sesión para seguir vendiendo.")
      }

      const venta = construirVentaLocal({
        copia,
        sesion: { empresaId, usuarioAuth: authId, ubicacionId },
        dispositivo,
        ahora: ahora(),
        ...datos,
      })

      const guardada = await guardarVenta(almacen, venta)

      refrescarLocal()

      // Si hay servidor, que salga cuanto antes; si no, espera segura.
      void programadorRef.current?.ahora()

      return guardada
    },
    [almacen, apertura.error, ubicacionId, user, copia, empresaId, authId, dispositivo, ahora, refrescarLocal]
  )

  const disponibleDe = useCallback(
    (productoId) => (copia ? disponibleLocal(copia, ventas, productoId) : 0),
    [copia, ventas]
  )

  // ── respaldo cifrado ───────────────────────────────────
  const exportarRespaldo = useCallback(
    async (frase) => {
      if (!almacen) throw new Error(apertura.error || "El almacén local no está disponible.")

      // Un administrador respalda todo lo del teléfono; un vendedor, lo suyo.
      const lista = await ventasNoConfirmadas(almacen, { usuarioAuth: esAdmin ? null : authId })

      if (lista.length === 0) throw new Error("No hay ventas sin confirmar para respaldar.")

      const texto = await exportarCifrado(lista, frase)
      const momento = ahora()

      // Exportar no borra ni cambia el estado: solo deja constancia.
      for (const venta of lista) {
        await marcar(almacen, venta.clave, { exportadaEn: momento.toISOString() })
      }

      refrescarLocal()

      return {
        texto,
        cantidad: lista.length,
        nombreArchivo: `lunacell-respaldo-${codigoCorto(dispositivo) || "LOCAL"}-${fechaDeArchivo(momento)}.json`,
      }
    },
    [almacen, apertura.error, esAdmin, authId, ahora, dispositivo, refrescarLocal]
  )

  // ── resumen para la pantalla ───────────────────────────
  const value = useMemo(() => {
    const cuenta = (pred) => ventas.filter(pred).length
    const sinConfirmar = ventas.filter((v) => !FINALES.has(v.estado))

    return {
      disponible: Boolean(almacen),
      motivoNoDisponible: apertura.error,
      actualizacionPendiente,
      dispositivo,
      conexion,
      enLinea: conexion === "en_linea",
      copia,
      errorDeCopia,
      ubicacionAutorizada,
      antiguedad: copia ? antiguedadDeCopia(copia, ahora()) : null,
      persistencia,
      ventas,
      pendientes: cuenta((v) => v.estado === ESTADOS.PENDIENTE || v.estado === ESTADOS.SINCRONIZANDO),
      conError: cuenta((v) => v.estado === ESTADOS.ERROR),
      // Solo las que esperan una decisión: las ya aplicadas o anuladas no.
      enConciliacion: cuenta(
        (v) => v.estado === ESTADOS.EN_CONCILIACION && !["aplicada", "anulada"].includes(v.conciliacion?.estado)
      ),
      sinConfirmar: sinConfirmar.length,
      ventasDeOtraUbicacion: sinConfirmar.filter((v) => v.ubicacionId !== ubicacionId).length,
      sincronizando,
      ultimaSincronizacion,
      errorDeSincronizacion,
      sincronizarAhora,
      comprobarConexion: comprobar,
      guardarVentaSinConexion,
      disponibleDe,
      exportarRespaldo,
      actualizarCopia,
    }
  }, [
    almacen,
    apertura.error,
    actualizacionPendiente,
    dispositivo,
    conexion,
    copia,
    errorDeCopia,
    ubicacionAutorizada,
    ahora,
    persistencia,
    ventas,
    ubicacionId,
    sincronizando,
    ultimaSincronizacion,
    errorDeSincronizacion,
    sincronizarAhora,
    comprobar,
    guardarVentaSinConexion,
    disponibleDe,
    exportarRespaldo,
    actualizarCopia,
  ])

  return <SinConexionContext.Provider value={value}>{children}</SinConexionContext.Provider>
}

// Lo que se le dice al vendedor después de una ronda.
function mensajeDeLaRonda(resumen) {
  if (resumen.detenidoPor === "sin_sesion") {
    return "Inicia sesión con conexión para enviar las ventas guardadas en este teléfono."
  }

  if (resumen.detenidoPor === "sesion") {
    return "Tu sesión venció: vuelve a iniciar sesión para enviar las ventas guardadas. No se perdió ninguna."
  }

  if (resumen.detenidoPor === "red") {
    return "Se perdió la conexión mientras se enviaban las ventas. Se reintentará sola."
  }

  if (resumen.errores > 0) {
    return "El servidor no aceptó alguna venta tal como está. Revísala en la lista de ventas sin conexión."
  }

  return ""
}

export default SinConexionProvider
