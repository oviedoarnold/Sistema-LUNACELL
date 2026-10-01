import { useCallback, useEffect, useState } from "react"

import { traerExistenciasPorUbicacion } from "../lib/api/existencias"

/*
  La existencia por ubicación, cargada para la pantalla que la pide.

  No es un contexto a propósito. Los contextos de este sistema sirven a
  datos que varias pantallas comparten —productos, clientes, ventas— y se
  cargan al entrar. Esto lo usa una pantalla, y la consulta cruza las
  ubicaciones con los productos: cobrarle ese trabajo a todo el que inicia
  sesión, para que la mayoría no lo use, es pagar por adelantado.

  La forma es la que ya usan los contextos de datos del sistema, y no es
  casual:

  - `cargando` se DERIVA de si la primera carga terminó, en vez de
    encenderse dentro del efecto. Encenderlo allí es poner el primer
    render a mentir y además lo prohíbe la regla de hooks;
  - hay una guarda de vigencia, porque la respuesta puede llegar después
    de que la pantalla se haya cerrado, y escribir estado en un componente
    desmontado es un aviso en consola hoy y una fuga mañana.
*/
export function useExistencias() {
  const [existencias, setExistencias] = useState([])
  const [cargado, setCargado] = useState(false)
  const [error, setError] = useState("")

  const cargando = !cargado

  useEffect(() => {
    let vigente = true

    traerExistenciasPorUbicacion()
      .then((filas) => {
        if (!vigente) return

        setExistencias(filas)
        setError("")
      })
      .catch((problema) => {
        if (!vigente) return

        /*
          La pantalla queda sin datos y con el motivo. No se deja la lista
          anterior: una cantidad vieja presentada como actual es peor que
          no mostrar ninguna, porque nadie la distingue.
        */
        setExistencias([])
        setError(
          problema.message || "No se pudo cargar la existencia por ubicación."
        )
      })
      .finally(() => {
        if (vigente) setCargado(true)
      })

    return () => {
      vigente = false
    }
  }, [])

  /*
    Volver a pedirlas. No apaga `cargado`: la pantalla ya tiene algo que
    mostrar, y vaciarla para rellenarla con lo mismo es un parpadeo que no
    informa de nada.
  */
  const recargar = useCallback(async () => {
    try {
      setExistencias(await traerExistenciasPorUbicacion())
      setError("")
    } catch (problema) {
      setExistencias([])
      setError(
        problema.message || "No se pudo cargar la existencia por ubicación."
      )
    }
  }, [])

  return { existencias, cargando, error, recargar }
}

export default useExistencias
