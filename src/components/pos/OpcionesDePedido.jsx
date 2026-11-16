import { FaCashRegister, FaShareSquare } from "react-icons/fa"

/*
  Vender aquí o enviar un pedido a otra ubicación (0045).

  En un pedido, esta ubicación entrega los productos y su inventario baja al
  confirmar; la ubicación elegida recibe el aviso y emite la factura. Solo con
  conexión.
*/
function OpcionesDePedido({ esPedido, onCambiar, destinos, destinoId, onDestino, sinConexion, nombreDeAqui }) {
  return (
    <>
      <div className="field" role="group" aria-labelledby="pos-operacion">
        <span id="pos-operacion" className="rotulo-de-grupo">
          Operación
        </span>

        <div className="pay-toggle">
          <button type="button" className={esPedido ? "" : "active"} aria-pressed={!esPedido} onClick={() => onCambiar(false)}>
            <FaCashRegister aria-hidden="true" />
            Vender aquí
          </button>

          <button type="button" className={esPedido ? "active" : ""} aria-pressed={esPedido} onClick={() => onCambiar(true)}>
            <FaShareSquare aria-hidden="true" />
            Enviar pedido
          </button>
        </div>
      </div>

      {esPedido && (
        <>
          <div className="field pos-campo">
            <label htmlFor="pos-destino-del-pedido">Ubicación que factura</label>

            <select id="pos-destino-del-pedido" value={destinoId} onChange={(evento) => onDestino(evento.target.value)}>
              <option value="">Elige la ubicación…</option>
              {destinos.map((destino) => (
                <option key={destino.id} value={destino.id}>
                  {destino.name}
                  {destino.fiscal ? " · factura fiscal" : ""}
                </option>
              ))}
            </select>
          </div>

          <p className={sinConexion ? "pos-aviso-precios is-error" : "pos-aviso-precios"} role={sinConexion ? "alert" : "status"}>
            {sinConexion
              ? "Los pedidos necesitan conexión. Podrás enviarlo cuando vuelva."
              : `${nombreDeAqui || "Esta ubicación"} entrega los productos y descuenta su inventario. La otra ubicación recibe el aviso y factura sin volver a cobrar lo que se cobre aquí.`}
          </p>
        </>
      )}
    </>
  )
}

export default OpcionesDePedido
