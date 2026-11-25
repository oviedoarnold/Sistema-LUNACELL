import { useCallback, useState } from "react"

import {
  agregarAlTraslado as agregarAlCarrito,
  cantidadValida,
  escribirCantidad,
  quitarDelTraslado as quitarDelCarrito,
  sumarAlRenglon,
} from "../utils/carritoDeTraslado"
import { problemaDelMotivo } from "../utils/regalias"

/*
  Las regalías que se están armando en el POS (0054): qué productos, cuántos
  y por qué. Usa el mismo carrito que «Nuevo traslado» —cantidad escrita como
  texto, − y + sin pasar de lo disponible— porque la regla es la misma.

  `disponibleDe(productId)` es lo que se puede regalar: la existencia de la
  ubicación menos lo que ya está en la venta. La base lo vuelve a comprobar
  bajo candado.
*/
export function useRegaliasDeLaVenta(disponibleDe) {
  const [renglones, setRenglones] = useState([])
  const [motivo, setMotivo] = useState("")
  const [detalle, setDetalle] = useState("")

  const agregar = useCallback(
    (productId) => setRenglones((actual) => agregarAlCarrito(actual, productId, disponibleDe(productId)).carrito),
    [disponibleDe]
  )
  const sumar = useCallback(
    (productId, cambio) => setRenglones((actual) => sumarAlRenglon(actual, productId, cambio, disponibleDe(productId))),
    [disponibleDe]
  )
  const escribir = useCallback((productId, texto) => setRenglones((actual) => escribirCantidad(actual, productId, texto)), [])
  const quitar = useCallback((productId) => setRenglones((actual) => quitarDelCarrito(actual, productId)), [])

  const vaciar = useCallback(() => {
    setRenglones([])
    setMotivo("")
    setDetalle("")
  }, [])

  // Qué impide registrarlas, o null: una cantidad que no alcanza o falta el motivo.
  const problema = (nombreDe) => {
    const mala = renglones.find((r) => !cantidadValida(r.cantidad, disponibleDe(r.productId)))

    if (mala) {
      const tope = disponibleDe(mala.productId)

      return tope > 0
        ? `Revisa la regalía de ${nombreDe(mala.productId)}: escribe una cantidad entera de 1 a ${tope}. Se cuenta junto con lo que se vende.`
        : `No queda ${nombreDe(mala.productId)} para regalar en tu ubicación después de lo que se vende.`
    }

    return renglones.length ? problemaDelMotivo(motivo, detalle) : null
  }

  return {
    renglones,
    motivo,
    detalle,
    setMotivo,
    setDetalle,
    agregar,
    sumar,
    escribir,
    quitar,
    vaciar,
    problema,
    cantidadDe: (productId) => Number(renglones.find((r) => r.productId === productId)?.cantidad) || 0,
    paraEnviar: () => renglones.map((r) => ({ productId: r.productId, qty: Number(r.cantidad) })),
  }
}
