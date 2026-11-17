import { useCallback, useEffect, useRef, useState } from "react"

import { traerAvisosDePedidos } from "../lib/api/pedidos"
import { useAlVolverALaApp } from "./useAlVolverALaApp"

/*
  Los avisos de pedidos que llegan a la ubicación del usuario.

  LUNACELL no tiene tiempo real: se consulta al abrir, al volver a la pestaña
  y cada minuto mientras está a la vista. El conteo lo calcula el servidor,
  así que un aviso que llegó mientras el usuario estaba desconectado sigue ahí
  al volver, y no se duplica. Si una consulta falla, se queda lo último que se
  supo.

  Quien entrega o factura un pedido avisa con EVENTO_PEDIDOS_CAMBIARON para
  que la campanita se actualice sin esperar al minuto.
*/
export const EVENTO_PEDIDOS_CAMBIARON = "lunacell:pedidos-cambiaron"
export const CADA_CUANTO = 60000

export const avisarCambioDePedidos = () => window.dispatchEvent(new Event(EVENTO_PEDIDOS_CAMBIARON))

const VACIO = { pendientes: 0, sinLeer: 0, porResolver: 0, porResolverSinLeer: 0, ultimos: [] }

export function useAvisosDePedidos({ activo = true } = {}) {
  const [avisos, setAvisos] = useState(VACIO)
  const vigente = useRef(true)

  const consultar = useCallback(async () => {
    try {
      const nuevos = await traerAvisosDePedidos()

      if (vigente.current) setAvisos(nuevos)
    } catch {
      // Sin conexión o un fallo pasajero: se conserva lo último.
    }
  }, [])

  useEffect(() => {
    vigente.current = true

    if (!activo) return undefined

    traerAvisosDePedidos().then(
      (nuevos) => vigente.current && setAvisos(nuevos),
      () => {}
    )

    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") void consultar()
    }, CADA_CUANTO)

    window.addEventListener(EVENTO_PEDIDOS_CAMBIARON, consultar)

    return () => {
      vigente.current = false
      window.clearInterval(reloj)
      window.removeEventListener(EVENTO_PEDIDOS_CAMBIARON, consultar)
    }
  }, [activo, consultar])

  useAlVolverALaApp(consultar, { activo })

  return { ...(activo ? avisos : VACIO), recargar: consultar }
}
