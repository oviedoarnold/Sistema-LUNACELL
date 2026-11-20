import { useEffect } from "react"

import { EVENTO_VENTAS_SINCRONIZADAS } from "../lib/sinConexion/eventos"
import { useAlVolverALaApp } from "./useAlVolverALaApp"

/*
  Cuándo volver a pedir la existencia sin que nadie recargue la página:

  - al sincronizar ventas hechas sin conexión: el servidor ya descontó, y
    la pantalla tiene que decir lo mismo;
  - al volver a LUNACELL desde otra app o pestaña: otros dispositivos
    pudieron vender o trasladar mientras tanto.

  Lo usan el punto de venta y la pantalla Inventario, para que las dos
  cuenten lo mismo y en el mismo momento.
*/
export function useRecargaDeExistencias(recargar, { activo = true } = {}) {
  useEffect(() => {
    if (!activo) return undefined

    const alSincronizar = () => {
      recargar()
    }

    window.addEventListener(EVENTO_VENTAS_SINCRONIZADAS, alSincronizar)

    return () => window.removeEventListener(EVENTO_VENTAS_SINCRONIZADAS, alSincronizar)
  }, [activo, recargar])

  useAlVolverALaApp(() => recargar(), { activo })
}

export default useRecargaDeExistencias
