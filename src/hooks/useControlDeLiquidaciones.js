import { useCallback, useEffect, useRef, useState } from "react"

import { traerControlDeLiquidaciones } from "../lib/api/liquidaciones"
import { useAlVolverALaApp } from "./useAlVolverALaApp"

/*
  Los saldos, pedidos y liquidaciones de la pantalla Liquidaciones, al día.

  LUNACELL no tiene tiempo real, y aquí importa: quien recibe confirma desde
  su teléfono mientras el administrador tiene la pantalla abierta en la PC.
  Por eso se consulta al abrir, al volver a la pestaña o a la app, cada
  CADA_CUANTO mientras la pantalla está a la vista y hay conexión, y después
  de cada operación (`recargar`).

  Dos reglas para que una consulta no pise a otra:

  - Solo vale la respuesta de la ÚLTIMA consulta pedida. Una respuesta
    antigua que llega tarde se descarta: nunca devuelve a «por confirmar»
    algo que ya se confirmó.
  - Las consultas automáticas no se encolan: si ya hay una en curso, o la
    pantalla está en pausa (registrando o resolviendo una entrega), no se
    lanza otra. `recargar`, que es la de después de operar, sí va siempre.

  Si una consulta automática falla se conserva lo último que se supo; solo
  la primera carga muestra el error, porque no hay nada que mostrar.
*/
export const CADA_CUANTO = 45000

const VACIO = { pares: [], pedidos: [], liquidaciones: [] }

export function useControlDeLiquidaciones({ conConexion = true, pausado = false } = {}) {
  const [estado, setEstado] = useState({ cargado: false, ...VACIO, error: "" })

  const ultima = useRef(0)
  const enCurso = useRef(false)
  const montado = useRef(true)

  // El reloj y el regreso a la app leen el último valor sin volver a armarse.
  const pausa = useRef({ conConexion, pausado })

  useEffect(() => {
    pausa.current = { conConexion, pausado }
  }, [conConexion, pausado])

  // Devuelve los datos frescos, para quien necesita decidir con ellos.
  const recargar = useCallback(async () => {
    const numero = ++ultima.current
    const esLaUltima = () => montado.current && numero === ultima.current

    enCurso.current = true

    try {
      const control = await traerControlDeLiquidaciones()

      if (esLaUltima()) setEstado({ cargado: true, ...control, error: "" })

      return control
    } catch (problema) {
      if (esLaUltima()) {
        setEstado((antes) => (antes.cargado ? antes : { cargado: true, ...VACIO, error: problema.message }))
      }

      throw problema
    } finally {
      if (numero === ultima.current) enCurso.current = false
    }
  }, [])

  const refrescar = useCallback(() => {
    const { conConexion: hayConexion, pausado: enPausa } = pausa.current

    if (enCurso.current || enPausa || !hayConexion) return

    recargar().catch(() => {
      // Sin conexión o un fallo pasajero: se conserva lo último que se supo.
    })
  }, [recargar])

  useEffect(() => {
    montado.current = true

    recargar().catch(() => {})

    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") refrescar()
    }, CADA_CUANTO)

    return () => {
      montado.current = false
      window.clearInterval(reloj)
    }
  }, [recargar, refrescar])

  useAlVolverALaApp(refrescar)

  return { ...estado, recargar }
}

export default useControlDeLiquidaciones
