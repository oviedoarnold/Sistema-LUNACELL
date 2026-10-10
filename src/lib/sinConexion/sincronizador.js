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
*/
import { conCandado } from "./candado"
import { clasificarError, clasificarRespuesta } from "./clasificar"
import { ESTADOS, marcar, recuperarInterrumpidas, ventasDelUsuario } from "./cola"

export function crearSincronizador({ almacen, enviar, sesionActual, ahora = () => new Date(), locks }) {
  async function ronda({ manual }) {
    await recuperarInterrumpidas(almacen)

    const sesion = await sesionActual()
    const resumen = { enviadas: 0, registradas: 0, enConciliacion: 0, errores: 0, detenidoPor: null, pendientes: 0 }

    if (!sesion?.usuarioAuth) return { ...resumen, detenidoPor: "sin_sesion" }

    const enviables = new Set(manual ? [ESTADOS.PENDIENTE, ESTADOS.ERROR] : [ESTADOS.PENDIENTE])
    const cola = (await ventasDelUsuario(almacen, sesion)).filter((v) => enviables.has(v.estado))

    for (const venta of cola) {
      await marcar(almacen, venta.clave, {
        estado: ESTADOS.SINCRONIZANDO,
        intentos: (venta.intentos || 0) + 1,
        ultimoIntentoEn: ahora().toISOString(),
      })

      let respuesta
      try {
        respuesta = await enviar(venta)
      } catch (error) {
        respuesta = { data: null, error, status: 0 }
      }

      resumen.enviadas += 1
      const final = respuesta.error ? null : clasificarRespuesta(respuesta.data)

      if (final === "registrada") {
        await marcar(almacen, venta.clave, {
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
        await marcar(almacen, venta.clave, {
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
        await marcar(almacen, venta.clave, { estado: ESTADOS.ERROR, ultimoError })
        resumen.errores += 1
        continue
      }

      await marcar(almacen, venta.clave, { estado: ESTADOS.PENDIENTE, ultimoError })

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
    sincronizar: ({ manual = false } = {}) => conCandado(almacen, () => ronda({ manual }), { locks, ahora }),
  }
}
