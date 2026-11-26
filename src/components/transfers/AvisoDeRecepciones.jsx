import { Link } from "react-router-dom"
import { FaTruckLoading } from "react-icons/fa"

import { useTrasladosPorRecibir } from "../../hooks/useTrasladosPorRecibir"
import "../../styles/transfers.css"

/*
  Aviso discreto de traslados por recibir (0056), para el POS: una línea
  informativa con un enlace a Traslados. No bloquea la venta, no toca el
  carrito ni el cobro, y desaparece cuando no hay nada por recibir.
*/
function AvisoDeRecepciones() {
  const { cantidad } = useTrasladosPorRecibir()

  if (cantidad === 0) return null

  const uno = cantidad === 1

  return (
    <p className="aviso-recepciones" role="status">
      <FaTruckLoading aria-hidden="true" />
      <span>{uno ? "Tienes 1 traslado por recibir." : `Tienes ${cantidad} traslados por recibir.`}</span>
      <Link to="/inventory/transfers">{uno ? "Ver traslado" : "Ver traslados"}</Link>
    </p>
  )
}

export default AvisoDeRecepciones
