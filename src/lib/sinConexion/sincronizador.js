/*
  La ronda de sincronización: envía, una por una y en orden, las ventas
  pendientes del usuario en sesión, y guarda lo que respondió el servidor.

  - Antes de enviar, recupera lo que quedó «sincronizando» de una ronda que
    no terminó (la app se cerró): se reenvía con la misma clave.
  - Solo envía ventas del usuario en sesión y de su empresa. Las de otro
    usuario esperan a que él inicie sesión: el servidor rechazaría usarlas
    con otra identidad (OF002).
  - Una venta solo sale de «pendiente» hacia un estado final cuando el
    servidor responde que la tiene. Nunca se borra aquí.
  - Un error de una venta no detiene las demás; solo la falta de red o de
    sesión detiene la ronda.
  - Cada envío tiene un tiempo límite: una petición que no responde (red
    móvil que se queda colgada) se aborta y cuenta como falta de red. Si el
    servidor sí la recibió, el reenvío con la misma clave responde «ya
    registrada».
  - Cada venta se toma y se suelta en una transacción que mira su estado
    actual: si otra pestaña la confirmó mientras tanto, no se reenvía ni
    retrocede.
  - Al terminar una ronda con servidor, se pregunta en qué quedaron las
    ventas en conciliación todavía sin decisión (`consultarConciliaciones`).
    Si la consulta falla no pasa nada: se pregunta en la próxima ronda.
  - Una venta guardada tras un intento en línea sin respuesta (`claveEnLinea`)
    no se envía a ciegas: antes se pregunta al servidor por esa clave
    (`verificarEnLinea`). Si el intento se registró, la venta queda
    registrada con esa factura y no se envía; si no se puede preguntar,
    espera.
*/
import { conCandado } from "./candado"
import { clasificarError, clasificarRespuesta } from "./clasificar"
import {
  ESTADOS,
  guardarResoluciones,
  marcar,
  recuperarInterrumpidas,
  soltarEnvio,
  tomarParaEnvio,
  ventasDelUsuario,
} from "./cola"

export const LIMITE_DE_ENVIO = 30000

const TIEMPO_AGOTADO = { code: "", message: "Tiempo de espera agotado: el servidor no respondió" }
const SIN_VERIFICACION = { code: "", message: "No se puede comprobar si el intento en línea se registró" }

async function enviarConLimite(enviar, venta, limiteDeEnvio) {
  const control = new AbortController()
  let reloj

  const agotado = new Promise((resolver) => {
    reloj = setTimeout(() => {
      control.abort()
      resolver({ data: null, error: TIEMPO_AGOTADO, status: 0 })
    }, limiteDeEnvio)
  })

  // Una excepción del envío (sin red) es una respuesta más, nunca un rechazo suelto.
  const envio = Promise.resolve()
    .then(() => enviar(venta, { signal: control.signal }))
    .catch((error) => ({ data: null, error, status: 0 }))

  try {
    return await Promise.race([envio, agotado])
  } finally {
    clearTimeout(reloj)
  }
}

export function crearSincronizador({
  almacen,
  enviar,
  sesionActual,
  ahora = () => new Date(),
  locks,
  limiteDeEnvio = LIMITE_DE_ENVIO,
  verificarEnLinea,
  consultarConciliaciones,
}) {
  async function anotarResoluciones(sesion) {
    if (!consultarConciliaciones) return

    const sinDecision = (await ventasDelUsuario(almacen, sesion))
      .filter((v) => v.estado === ESTADOS.EN_CONCILIACION)
      .filter((v) => !["aplicada", "anulada"].includes(v.conciliacion?.estado))
      .map((v) => v.clave)

    if (sinDecision.length === 0) return

    try {
      const { data, error } = await consultarConciliaciones(sinDecision)
      if (!error && Array.isArray(data)) await guardarResoluciones(almacen, data)
    } catch {
      // Se vuelve a preguntar en la próxima ronda.
    }
  }

  /*
    Lo que responde el servidor por una venta. Para una que nace de un
    intento en línea sin respuesta, primero se pregunta por ese intento.
  */
  async function responder(venta) {
    if (venta.claveEnLinea) {
      if (!verificarEnLinea) return { data: null, error: SIN_VERIFICACION, status: 200 }

      const verificacion = await enviarConLimite(
        (v, opciones) => verificarEnLinea(v.claveEnLinea, opciones),
        venta,
        limiteDeEnvio
      )

      if (verificacion.error) return verificacion

      if (verificacion.data) {
        return {
          data: {
            estado: "ya_registrada",
            venta_id: verificacion.data.id ?? null,
            numero_factura: verificacion.data.numero_factura ?? null,
            en_linea: true,
          },
          error: null,
          status: 200,
        }
      }
    }

    return enviarConLimite(enviar, venta, limiteDeEnvio)
  }

  async function ronda({ manual, renovar }) {
    await recuperarInterrumpidas(almacen)

    const sesion = await sesionActual()
    const resumen = { enviadas: 0, registradas: 0, enConciliacion: 0, errores: 0, detenidoPor: null, pendientes: 0 }

    if (!sesion?.usuarioAuth) return { ...resumen, detenidoPor: "sin_sesion" }

    const enviables = manual ? [ESTADOS.PENDIENTE, ESTADOS.ERROR] : [ESTADOS.PENDIENTE]
    const cola = (await ventasDelUsuario(almacen, sesion)).filter((v) => enviables.includes(v.estado))

    for (const { clave } of cola) {
      if (!(await renovar())) {
        resumen.detenidoPor = "otra_pestana"
        break
      }

      const venta = await tomarParaEnvio(almacen, clave, {
        enviables,
        cambios: { ultimoIntentoEn: ahora().toISOString() },
      })

      if (!venta) continue

      const respuesta = await responder(venta)

      resumen.enviadas += 1
      const final = respuesta.error ? null : clasificarRespuesta(respuesta.data)

      if (final === "registrada") {
        await marcar(almacen, clave, {
          estado: ESTADOS.REGISTRADA,
          ventaId: respuesta.data.venta_id ?? null,
          numeroFactura: respuesta.data.numero_factura ?? null,
          registradaEnLinea: Boolean(respuesta.data.en_linea),
          confirmadaEn: ahora().toISOString(),
          ultimoError: null,
        })
        resumen.registradas += 1
        continue
      }

      if (final === "en_conciliacion") {
        await marcar(almacen, clave, {
          estado: ESTADOS.EN_CONCILIACION,
          conciliacionId: respuesta.data.conciliacion_id ?? null,
          motivo: respuesta.data.motivo ?? null,
          confirmadaEn: ahora().toISOString(),
          ultimoError: null,
        })
        resumen.enConciliacion += 1
        continue
      }

      const clase = respuesta.error ? clasificarError(respuesta.error, respuesta.status) : "temporal"
      const ultimoError = {
        clase,
        codigo: respuesta.error?.code ?? null,
        mensaje: respuesta.error?.message ?? "Respuesta inesperada del servidor",
        en: ahora().toISOString(),
      }

      if (clase === "rechazo") {
        if (await soltarEnvio(almacen, clave, { estado: ESTADOS.ERROR, ultimoError })) resumen.errores += 1
        continue
      }

      await soltarEnvio(almacen, clave, { estado: ESTADOS.PENDIENTE, ultimoError })

      if (clase === "red" || clase === "sesion") {
        resumen.detenidoPor = clase
        break
      }
    }

    if (!resumen.detenidoPor) await anotarResoluciones(sesion)

    const despues = await ventasDelUsuario(almacen, sesion)
    resumen.pendientes = despues.filter((v) => v.estado === ESTADOS.PENDIENTE).length

    return resumen
  }

  return {
    sincronizar: ({ manual = false } = {}) =>
      conCandado(almacen, ({ renovar }) => ronda({ manual, renovar }), { locks, ahora }),
  }
}
