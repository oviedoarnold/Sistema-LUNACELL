import { useEffect, useId, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FaBell } from "react-icons/fa"

import { useAuth } from "../../hooks/useAuth"
import { useAvisosDePedidos } from "../../hooks/useAvisosDePedidos"
import { formatMoney } from "../../utils/format"

/*
  La campanita del encabezado: los pedidos que otra ubicación entregó y que
  la del usuario tiene que facturar.

  Solo para quien factura (permiso de facturar) y con conexión. El contador
  no la ve: consulta, no factura. El número es de pedidos pendientes; los no
  leídos se marcan como nuevos. Leer un aviso no factura nada.
*/
function CampanaDePedidos() {
  const { user, hasPermission, permissions, soloLectura } = useAuth()
  const activo = Boolean(user) && !user.sinConexion && !soloLectura && hasPermission(permissions.POS)
  const { pendientes, sinLeer, ultimos } = useAvisosDePedidos({ activo })
  const [abierto, setAbierto] = useState(false)
  const caja = useRef(null)
  const boton = useRef(null)
  const idMenu = useId()
  const navigate = useNavigate()

  useEffect(() => {
    if (!abierto) return undefined

    const alPulsarTecla = (evento) => {
      if (evento.key === "Escape") {
        setAbierto(false)
        boton.current?.focus()
      }
    }
    const alTocarFuera = (evento) => {
      if (!caja.current?.contains(evento.target)) setAbierto(false)
    }

    document.addEventListener("keydown", alPulsarTecla)
    document.addEventListener("pointerdown", alTocarFuera)

    return () => {
      document.removeEventListener("keydown", alPulsarTecla)
      document.removeEventListener("pointerdown", alTocarFuera)
    }
  }, [abierto])

  if (!activo) return null

  const ir = (destino) => {
    setAbierto(false)
    navigate(destino)
  }

  const etiqueta =
    pendientes === 0
      ? "Pedidos recibidos: ninguno pendiente"
      : `Pedidos recibidos: ${pendientes} pendiente${pendientes === 1 ? "" : "s"} de facturar${sinLeer ? `, ${sinLeer} sin leer` : ""}`

  return (
    <div className="topbar-campana" ref={caja}>
      <button
        ref={boton}
        type="button"
        className="topbar-campana-boton"
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-controls={idMenu}
        onClick={() => setAbierto((valor) => !valor)}
      >
        <FaBell aria-hidden="true" />
        {pendientes > 0 && (
          <span className={sinLeer > 0 ? "topbar-campana-numero is-nuevo" : "topbar-campana-numero"} aria-hidden="true">
            {pendientes > 99 ? "99+" : pendientes}
          </span>
        )}
      </button>

      {abierto && (
        <div className="topbar-campana-menu" id={idMenu}>
          <p className="topbar-campana-titulo">
            {pendientes === 0 ? "No hay pedidos pendientes de facturar" : `Pendientes de facturar: ${pendientes}`}
          </p>

          {ultimos.length > 0 && (
            <ul className="topbar-campana-lista">
              {ultimos.map((pedido) => (
                <li key={pedido.id}>
                  <button
                    type="button"
                    className={pedido.leido ? "topbar-campana-aviso" : "topbar-campana-aviso is-nuevo"}
                    onClick={() => ir(`/pedidos?pedido=${pedido.id}`)}
                  >
                    <span className="topbar-campana-aviso-linea">
                      <b>{pedido.numero}</b>
                      {!pedido.leido && <span className="badge badge-credit">Nuevo</span>}
                    </span>
                    <span className="topbar-campana-aviso-linea">
                      <span>
                        {pedido.cliente} · desde {pedido.origen}
                      </span>
                      <span className="pos-importe">{formatMoney(pedido.total)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="btn btn-secondary btn-block" onClick={() => ir("/pedidos")}>
            Ver todos los pedidos
          </button>
        </div>
      )}
    </div>
  )
}

export default CampanaDePedidos
