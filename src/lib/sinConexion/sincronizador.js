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
*/
import { conCandado } from "./candado"
import { clasificarError, clasificarRespuesta } from "./clasificar"
import { ESTADOS, marcar, recuperarInterrumpidas, soltarEnvio, tomarParaEnvio, ventasDelUsuario } from "./cola"

export const LIMITE_DE_ENVIO = 30000

const TIEMPO_AGOTADO = { code: "", message: "Tiempo de espera agotado: el servidor no respondió" }

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
}) {
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

      const respuesta = await enviarConLimite(enviar, venta, limiteDeEnvio)

      resumen.enviadas += 1
      const final = respuesta.error ? null : clasificarRespuesta(respuesta.data)

      if (final === "registrada") {
        await marcar(almacen, clave, {
          estado: ESTADOS.REGISTRADA,
          ventaId: respuesta.data.venta_id ?? null,
          numeroFactura: respuesta.data.numero_factura ?? null,
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

    const despues = await ventasDelUsuario(almacen, sesion)
    resumen.pendientes = despues.filter((v) => v.estado === ESTADOS.PENDIENTE).length

    return resumen
  }

  return {
    sincronizar: ({ manual = false } = {}) =>
      conCandado(almacen, ({ renovar }) => ronda({ manual, renovar }), { locks, ahora }),
  }
}
