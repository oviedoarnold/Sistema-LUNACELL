import { useEffect, useRef } from "react"

/*
  Llama a `recargar` cuando el usuario vuelve a LUNACELL después de usar
  otra app o de cambiar de pestaña (la página pasa a visible).

  Sirve para ver lo que hicieron OTROS dispositivos con la misma cuenta o la
  misma ubicación: LUNACELL no tiene tiempo real, y cada pantalla carga sus
  datos al abrirse. Las ventas que sincroniza el propio dispositivo ya se
  avisan solas (EVENTO_VENTAS_SINCRONIZADAS).

  Como mucho una vez cada ESPERA_ENTRE_RECARGAS desde la última carga (la del
  montaje cuenta): ir y volver enseguida no repite consultas.
*/
export const ESPERA_ENTRE_RECARGAS = 30000

export function useAlVolverALaApp(recargar, { activo = true } = {}) {
  const ultimaCarga = useRef(0)
  const recargarRef = useRef(recargar)

  useEffect(() => {
    recargarRef.current = recargar
  }, [recargar])

  useEffect(() => {
    if (!activo) return undefined

    ultimaCarga.current = Date.now()

    const alCambiarVisibilidad = () => {
      if (document.visibilityState !== "visible") return
      if (Date.now() - ultimaCarga.current < ESPERA_ENTRE_RECARGAS) return

      ultimaCarga.current = Date.now()
      recargarRef.current?.()
    }

    document.addEventListener("visibilitychange", alCambiarVisibilidad)

    return () => document.removeEventListener("visibilitychange", alCambiarVisibilidad)
  }, [activo])
}

export default useAlVolverALaApp
