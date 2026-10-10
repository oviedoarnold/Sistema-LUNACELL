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

  - `cargando` se DERIVA de si la carga de la clave actual terminó, en vez
    de encenderse dentro del efecto. Encenderlo allí es poner el primer
    render a mentir y además lo prohíbe la regla de hooks;
  - hay una guarda de vigencia, porque la respuesta puede llegar después
    de que la pantalla se haya cerrado, y escribir estado en un componente
    desmontado es un aviso en consola hoy y una fuga mañana.

  `clave` dice de quién son los datos (el punto de venta pasa usuario y
  ubicación). Lo cargado se guarda junto a su clave: si la clave cambia,
  lo anterior deja de valer en ese mismo render, sin esperar a la nueva
  respuesta. Así no se ve nunca la existencia de otra sesión. Con
  `activo: false` no se consulta nada.
*/
const MENSAJE_POR_OMISION = "No se pudo cargar la existencia por ubicación."

export function useExistencias({ clave = "", activo = true } = {}) {
  const [cargado, setCargado] = useState(null)

  const vigente = cargado !== null && cargado.clave === clave

  useEffect(() => {
    if (!activo) return

    let sigue = true

    traerExistenciasPorUbicacion()
      .then((filas) => {
        if (sigue) setCargado({ clave, existencias: filas, error: "" })
      })
      .catch((problema) => {
        /*
          La pantalla queda sin datos y con el motivo. No se deja la lista
          anterior: una cantidad vieja presentada como actual es peor que
          no mostrar ninguna, porque nadie la distingue.
        */
        if (sigue) {
          setCargado({ clave, existencias: [], error: problema.message || MENSAJE_POR_OMISION })
        }
      })

    return () => {
      sigue = false
    }
  }, [clave, activo])

  /*
    Volver a pedirlas. No apaga `cargando`: la pantalla ya tiene algo que
    mostrar, y vaciarla para rellenarla con lo mismo es un parpadeo que no
    informa de nada.
  */
  const recargar = useCallback(async () => {
    try {
      setCargado({ clave, existencias: await traerExistenciasPorUbicacion(), error: "" })
    } catch (problema) {
      setCargado({ clave, existencias: [], error: problema.message || MENSAJE_POR_OMISION })
    }
  }, [clave])

  return {
    existencias: vigente ? cargado.existencias : [],
    cargando: activo && !vigente,
    error: vigente ? cargado.error : "",
    recargar,
  }
}

export default useExistencias
