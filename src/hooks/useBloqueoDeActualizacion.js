import { useEffect } from "react"

import { bloquearActualizacion } from "../lib/actualizacion/bloqueos"

/*
  Mientras `activo` sea verdadero, la actualización automática no recarga la
  aplicación: espera a que termine esta operación. Se retira sola al
  desmontar la pantalla.
*/
export function useBloqueoDeActualizacion(activo, motivo) {
  useEffect(() => {
    if (!activo) return undefined

    return bloquearActualizacion(motivo)
  }, [activo, motivo])
}
