import { useCallback, useEffect, useState } from "react"

import { traerTraslados } from "../lib/api/traslados"

/*
  El historial de traslados, cargado para la pantalla que lo pide.

  No es un contexto, por la misma razón que useExistencias: lo usa una
  sola pantalla, y cargarlo para todo el que inicia sesión sería pagar por
  adelantado. Se recarga después de cada traslado, para que el que se
  acaba de registrar aparezca sin salir de la pantalla.
*/
/*
  Una lista vieja presentada como actual es peor que ninguna: nadie la
  distingue. Si la carga falla, se vacía y se dice por qué.
*/
const cargada = (traslados) => ({ traslados, cargado: true, error: "" })

const fallida = (problema) => ({
  traslados: [],
  cargado: true,
  error: problema.message || "No se pudo cargar el historial de traslados.",
})

export function useTraslados() {
  const [estado, setEstado] = useState({ traslados: [], cargado: false, error: "" })

  // La respuesta puede llegar con la pantalla ya cerrada.
  useEffect(() => {
    let vigente = true

    traerTraslados().then(
      (traslados) => vigente && setEstado(cargada(traslados)),
      (problema) => vigente && setEstado(fallida(problema))
    )

    return () => {
      vigente = false
    }
  }, [])

  const recargar = useCallback(async () => {
    try {
      setEstado(cargada(await traerTraslados()))
    } catch (problema) {
      setEstado(fallida(problema))
    }
  }, [])

  return {
    traslados: estado.traslados,
    cargando: !estado.cargado,
    error: estado.error,
    recargar,
  }
}

export default useTraslados
