import { formatMoney } from "../../utils/format"

/*
  «Hacer pago parcial» en un pedido a crédito (0045): el cliente deja aquí una
  parte y el resto queda a crédito en la ubicación que factura.

  Desactivada por defecto: sin marcarla, el pedido se envía como siempre, sin
  montos ni medios. El método de pago es el selector de siempre del POS, que
  el panel dibuja debajo; las cifras van en el resumen. Aquí solo están la
  casilla, el monto, dónde se recibe el dinero y los avisos.

  El servidor exige que el pago parcial sea menor que el total: si es igual,
  el pedido va al contado, y se ofrece pasarlo sin perder nada.
*/

const centavos = (valor) => Math.round(Number(valor) * 100)

function avisoDelMonto(monto, total) {
  if (monto === null) return { tipo: "error", texto: "Escribe el monto con hasta dos decimales." }
  if (monto === 0) return { tipo: "suave", texto: "Escribe cuánto entrega el cliente, o desmarca la opción." }
  if (centavos(monto) > centavos(total)) return { tipo: "error", texto: `No puede ser mayor que el total del pedido (${formatMoney(total)}).` }
  if (centavos(monto) === centavos(total)) return { tipo: "igual", texto: "El cliente paga todo: el pedido debe enviarse al contado." }

  return null
}

function PagoParcialDelPedido({ activo, onActivar, montoTexto, onMonto, monto, total, nombreDeAqui, onPasarAContado }) {
  const aviso = activo ? avisoDelMonto(monto, total) : null

  return (
    <div className="pos-pago-parcial">
      <label className="pos-isv pos-pago-parcial-casilla">
        <input type="checkbox" checked={activo} onChange={(evento) => onActivar(evento.target.checked)} />
        Hacer pago parcial
      </label>

      {activo && (
        <>
          <div className="field pos-campo">
            <label htmlFor="pos-monto-del-pago-parcial">Monto del pago parcial</label>

            <input
              id="pos-monto-del-pago-parcial"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              value={montoTexto}
              onChange={(evento) => onMonto(evento.target.value)}
            />
          </div>

          <p className="pos-aviso-precios">
            Se recibe en <b>{nombreDeAqui || "esta ubicación"}</b>
          </p>

          {aviso && (
            <div className={aviso.tipo === "suave" ? "pos-aviso-precios" : "pos-aviso-precios is-error"} role={aviso.tipo === "suave" ? "status" : "alert"}>
              {aviso.texto}

              {aviso.tipo === "igual" && (
                <button type="button" className="btn btn-secondary btn-sm pos-pago-parcial-contado" onClick={onPasarAContado}>
                  Enviar al contado
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default PagoParcialDelPedido
