import { useEffect, useId, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FaBell } from "react-icons/fa"

import { useAuth } from "../../hooks/useAuth"
import { useAvisosDePedidos } from "../../hooks/useAvisosDePedidos"
import { formatMoney } from "../../utils/format"

/*
  La campanita del encabezado: los pedidos que otra ubicación entregó y que
  la del usuario tiene que facturar, y los que su ubicación entregó y otra
  rechazó, que esperan que se decida quién los factura (etapa C1).

  Solo para quien factura (permiso de facturar) y con conexión. El contador
  no la ve: consulta, no factura. El número suma los dos tipos de aviso; los no
  leídos se marcan como nuevos. Leer un aviso no factura ni resuelve nada.
*/

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

function etiquetaDeLaCampana({ pendientes, porResolver, sinLeer }) {
  const nuevos = sinLeer ? `, ${sinLeer} sin leer` : ""

  if (porResolver === 0) {
    return pendientes === 0
      ? "Pedidos recibidos: ninguno pendiente"
      : `Pedidos recibidos: ${plural(pendientes, "pendiente", "pendientes")} de facturar${nuevos}`
  }

  return `Pedidos: ${plural(pendientes, "pendiente", "pendientes")} de facturar, ${plural(porResolver, "rechazado", "rechazados")} por resolver${nuevos}`
}

function AvisoDePedido({ pedido, onAbrir }) {
  const rechazado = pedido.estado === "por_resolver"

  return (
    <button type="button" className={pedido.leido ? "topbar-campana-aviso" : "topbar-campana-aviso is-nuevo"} onClick={onAbrir}>
      <span className="topbar-campana-aviso-linea">
        <b>{pedido.numero}</b>
        {!pedido.leido && <span className="badge badge-credit">Nuevo</span>}
        {rechazado && <span className="badge badge-low">Por resolver</span>}
      </span>
      <span className="topbar-campana-aviso-linea">
        <span>
          {pedido.cliente} · {rechazado ? `rechazado por ${pedido.destino}` : `desde ${pedido.origen}`}
        </span>
        <span className="pos-importe">{formatMoney(pedido.total)}</span>
      </span>
      {rechazado && pedido.motivo && <span className="topbar-campana-aviso-motivo">«{pedido.motivo}»</span>}
    </button>
  )
}

function CampanaDePedidos() {
  const { user, hasPermission, permissions, soloLectura } = useAuth()
  const activo = Boolean(user) && !user.sinConexion && !soloLectura && hasPermission(permissions.POS)
  const { pendientes, sinLeer, porResolver, porResolverSinLeer, ultimos } = useAvisosDePedidos({ activo })
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

  const total = pendientes + porResolver
  const nuevos = sinLeer + porResolverSinLeer

  return (
    <div className="topbar-campana" ref={caja}>
      <button
        ref={boton}
        type="button"
        className="topbar-campana-boton"
        aria-label={etiquetaDeLaCampana({ pendientes, porResolver, sinLeer: nuevos })}
        aria-expanded={abierto}
        aria-controls={idMenu}
        onClick={() => setAbierto((valor) => !valor)}
      >
        <FaBell aria-hidden="true" />
        {total > 0 && (
          <span className={nuevos > 0 ? "topbar-campana-numero is-nuevo" : "topbar-campana-numero"} aria-hidden="true">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {abierto && (
        <div className="topbar-campana-menu" id={idMenu}>
          <p className="topbar-campana-titulo">
            {pendientes === 0 ? "No hay pedidos pendientes de facturar" : `Pendientes de facturar: ${pendientes}`}
          </p>

          {porResolver > 0 && <p className="topbar-campana-titulo">{`Rechazados por resolver: ${porResolver}`}</p>}

          {ultimos.length > 0 && (
            <ul className="topbar-campana-lista">
              {ultimos.map((pedido) => (
                <li key={pedido.id}>
                  <AvisoDePedido pedido={pedido} onAbrir={() => ir(`/pedidos?pedido=${pedido.id}`)} />
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
