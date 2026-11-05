import { useEffect, useState } from "react"

import { traerPreciosDeCliente } from "../lib/api/preciosPorCliente"

const SIN_PRECIOS = {}

/*
  Los precios especiales del cliente elegido en el POS: { productoId: precio }.
  Sin conexión salen de la copia local, que los trae ya descargados.

  Mientras cargan, o si no se pudieron leer, no se puede facturar: el servidor
  cobraría el precio especial y la pantalla estaría mostrando el general.
*/
export function usePreciosDeCliente({ clienteId, sinConexion = false, copia = null }) {
  const [resultado, setResultado] = useState({ clienteId: null, precios: SIN_PRECIOS, fallo: false })

  useEffect(() => {
    if (!clienteId || sinConexion) return undefined

    let vigente = true

    void traerPreciosDeCliente(clienteId).then(
      (precios) => {
        if (vigente) setResultado({ clienteId, precios, fallo: false })
      },
      () => {
        if (vigente) setResultado({ clienteId, precios: SIN_PRECIOS, fallo: true })
      }
    )

    return () => {
      vigente = false
    }
  }, [clienteId, sinConexion])

  if (!clienteId) return { precios: SIN_PRECIOS, cargando: false, fallo: false }

  if (sinConexion) {
    return { precios: copia?.preciosPorCliente?.[clienteId] || SIN_PRECIOS, cargando: false, fallo: false }
  }

  if (resultado.clienteId !== clienteId) return { precios: SIN_PRECIOS, cargando: true, fallo: false }

  return { precios: resultado.precios, cargando: false, fallo: resultado.fallo }
}
