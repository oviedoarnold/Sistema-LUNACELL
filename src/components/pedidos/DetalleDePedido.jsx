import ModalShell from "../forms/ModalShell"
import { ESTADOS_DE_PEDIDO } from "../../lib/api/pedidos"
import { etiquetaDelMedio, textoDePorcentaje } from "../../utils/mediosDePago"
import { textoDelMotivo } from "../../utils/preciosNegociados"
import { fechaYHora, formatMoney } from "../../utils/format"

/*
  Lo que revisa la ubicación destino antes de facturar: cliente, de dónde sale
  y dónde se factura, productos con sus precios, ISV, lo cobrado en origen, el
  saldo y lo que ya salió del inventario de origen.

  Facturar crea UNA factura con estos mismos datos. No descuenta inventario ni
  vuelve a cobrar: eso pasó en origen al entregar.

  Etapa C1: el destino puede rechazarlo, y la ubicación que lo entregó lo
  resuelve aquí mismo: lo factura ella o lo envía a otra ubicación. Cada botón
  aparece solo si el servidor dice que quien mira puede usarlo.
*/

const EVENTOS = {
  entregado: "Entregado en origen",
  facturado: "Facturado",
  rechazado: "Rechazado",
  reenviado: "Enviado a otra ubicación",
  facturar_en_origen: "Se factura en origen",
  cancelacion_solicitada: "Cancelación solicitada",
  cancelacion_autorizada: "Cancelación autorizada",
  cancelacion_rechazada: "Cancelación rechazada",
}

// Lo que dice la historia de cada paso, con el cambio de ubicación cuando lo hubo.
function textoDelEvento(evento) {
  if (evento.tipo === "rechazado") return `Rechazado en ${evento.rechazadoEn || evento.ubicacion}`
  if (evento.tipo === "reenviado") return `Enviado de ${evento.desde} a ${evento.hacia}`
  if (evento.tipo === "facturar_en_origen") return `Se factura en ${evento.hacia} (lo rechazó ${evento.desde})`

  return EVENTOS[evento.tipo] || evento.tipo
}

function PrecioDelProducto({ producto }) {
  if (producto.precioReferencia !== null) {
    return (
      <small className="pedidos-precio-nota">
        Negociado · antes {formatMoney(producto.precioReferencia)}
        {producto.motivoNegociacion ? ` · ${textoDelMotivo(producto.motivoNegociacion)}` : ""}
      </small>
    )
  }

  if (producto.precioEspecial !== null) {
    return <small className="pedidos-precio-nota">Precio especial · general {formatMoney(producto.precioGeneral)}</small>
  }

  return null
}

function AccionesDelPedido({ pedido, operando, sinConexion, onFacturar, onRechazar, onReenviar, onFacturarEnOrigen }) {
  if (!pedido) return null

  const ocupado = Boolean(operando) || sinConexion
  const bloqueado = Boolean(pedido.bloqueoPorLiquidacion)

  return (
    <>
      {pedido.puedeRechazar && (
        <button type="button" className="btn btn-secondary" disabled={ocupado || bloqueado} onClick={onRechazar}>
          {operando === "rechazar" ? "Rechazando…" : "Rechazar"}
        </button>
      )}

      {pedido.puedeFacturar && (
        <button type="button" className="btn btn-primary" disabled={ocupado} onClick={onFacturar}>
          {operando === "facturar" ? "Facturando…" : "Facturar"}
        </button>
      )}

      {pedido.puedeResolver && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={ocupado || bloqueado || pedido.destinosParaReenviar.length === 0}
          onClick={onReenviar}
        >
          {operando === "reenviar" ? "Enviando…" : "Enviar a otra ubicación"}
        </button>
      )}

      {pedido.puedeFacturarEnOrigen && (
        <button type="button" className="btn btn-primary" disabled={ocupado || bloqueado} onClick={onFacturarEnOrigen}>
          {operando === "facturar_en_origen" ? "Facturando…" : `Facturar en ${pedido.origen}`}
        </button>
      )}
    </>
  )
}

function DetalleDePedido({ pedido, cargando, error, operando, sinConexion, onFacturar, onRechazar, onReenviar, onFacturarEnOrigen, onCerrar }) {
  const titulo = pedido ? `Pedido ${pedido.numero}` : "Pedido"
  const opera = Boolean(pedido && (pedido.puedeFacturar || pedido.puedeRechazar || pedido.puedeResolver))

  const acciones = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCerrar}>
        Cerrar
      </button>

      <AccionesDelPedido
        pedido={pedido}
        operando={operando}
        sinConexion={sinConexion}
        onFacturar={onFacturar}
        onRechazar={onRechazar}
        onReenviar={onReenviar}
        onFacturarEnOrigen={onFacturarEnOrigen}
      />
    </>
  )

  return (
    <ModalShell titulo={titulo} onCerrar={onCerrar} cerrarAlPulsarFuera ancho="modal-wide" acciones={acciones}>
      <div className="pedidos-detalle">
        {cargando && <p className="crud-cargando" role="status">Cargando el pedido…</p>}
        {error && <p className="alert-banner" role="alert">{error}</p>}

        {pedido && (
          <>
            {opera && sinConexion && (
              <p className="alert-banner" role="alert">
                Facturar, rechazar o resolver un pedido necesita conexión. Podrás hacerlo cuando vuelva.
              </p>
            )}

            {pedido.rechazo && (
              <div className="pedidos-rechazo" role="note">
                <b>Rechazado por {pedido.rechazo.ubicacion}</b>
                <span>«{pedido.rechazo.motivo}»</span>
                <small>
                  {pedido.rechazo.usuario} · {fechaYHora(pedido.rechazo.fecha)}
                  {pedido.puedeResolver ? ` · decide quién lo factura: ${pedido.origen} u otra ubicación.` : ` · espera que ${pedido.origen} lo resuelva.`}
                </small>
              </div>
            )}

            {pedido.bloqueoPorLiquidacion && opera && (
              <p className="alert-banner" role="alert">
                El efectivo de este pedido ya está en la liquidación {pedido.bloqueoPorLiquidacion}. Mientras siga ahí, no se puede rechazar ni
                cambiar de ubicación.
              </p>
            )}

            <dl className="pedidos-datos">
              {[
                ["Estado", ESTADOS_DE_PEDIDO[pedido.estado] || pedido.estado],
                ["Cliente", `${pedido.cliente}${pedido.rtn ? ` · RTN ${pedido.rtn}` : ""}`],
                ["Entregó", `${pedido.origen} · ${pedido.entregadoPor || "—"} · ${fechaYHora(pedido.entregadoEn)}`],
                [
                  "Factura",
                  pedido.numeroFactura
                    ? `${pedido.destino} · ${pedido.numeroFactura} · ${fechaYHora(pedido.facturadoEn)}`
                    : pedido.estado === "por_resolver"
                      ? `Por decidir (lo rechazó ${pedido.destino})`
                      : pedido.destino,
                ],
                ["Forma de pago", pedido.formaPago === "credito" ? `Crédito${pedido.fechaVencimiento ? ` · vence ${pedido.fechaVencimiento}` : ""}` : "Contado"],
                ["Nota", pedido.nota || "—"],
              ].map(([termino, valor]) => (
                <div className="pedidos-dato" key={termino}>
                  <dt>{termino}</dt>
                  <dd>{valor}</dd>
                </div>
              ))}
            </dl>

            <h3 className="pedidos-subtitulo">Productos</h3>
            <ul className="pedidos-productos">
              {pedido.productos.map((producto) => (
                <li key={producto.id}>
                  <span className="pedidos-producto-nombre">
                    {producto.nombre}
                    <small>
                      {producto.cantidad} × {formatMoney(producto.precio)} · entregado en {pedido.origen}: {producto.entregado}
                    </small>
                    <PrecioDelProducto producto={producto} />
                  </span>
                  <span className="pos-importe">{formatMoney(producto.subtotal)}</span>
                </li>
              ))}
            </ul>

            <div className="totals pedidos-totales">
              <div className="totals-row">
                <span>Subtotal</span>
                <span className="v">{formatMoney(pedido.subtotal)}</span>
              </div>
              <div className="totals-row">
                <span>ISV ({pedido.tasaIsv}%)</span>
                <span className="v">{formatMoney(pedido.isv)}</span>
              </div>
              <div className="totals-row grand">
                <span>Total</span>
                <span className="v">{formatMoney(pedido.total)}</span>
              </div>
              {pedido.cargo > 0 && (
                <div className="totals-row">
                  <span>Cargo por medio de pago{pedido.tasaCargo !== null ? ` (${textoDePorcentaje(pedido.tasaCargo)})` : ""}</span>
                  <span className="v">{formatMoney(pedido.cargo)}</span>
                </div>
              )}
              <div className="totals-row">
                <span>{pedido.formaPago === "credito" ? `Pago parcial recibido en ${pedido.origen}` : `Cobrado en ${pedido.origen}`}</span>
                <span className="v">{formatMoney(pedido.cobrado)}</span>
              </div>
              <div className="totals-row">
                <span>{pedido.formaPago === "credito" ? "Saldo pendiente del cliente" : "Saldo"}</span>
                <span className="v">{formatMoney(pedido.saldo)}</span>
              </div>
            </div>

            {pedido.cobros.length > 0 && (
              <>
                <h3 className="pedidos-subtitulo">Cobros recibidos en origen</h3>
                <ul className="pedidos-cobros">
                  {pedido.cobros.map((cobro) => (
                    <li key={cobro.medio}>
                      <span>
                        {etiquetaDelMedio(cobro.medio)}
                        {cobro.referencia ? ` · ${cobro.referencia}` : ""}
                        <small>
                          {cobro.ubicacion} · {fechaYHora(cobro.fecha)}
                          {cobro.cargo > 0 ? ` · cargo ${formatMoney(cobro.cargo)} (${textoDePorcentaje(cobro.tasa)})` : ""}
                        </small>
                      </span>
                      <span className="pos-importe">{formatMoney(cobro.monto)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {pedido.puedeFacturar && (
              <p className="crud-nota">
                Al facturar se emite la factura en {pedido.destino} con estos datos. El inventario ya salió de{" "}
                {pedido.origen} y no vuelve a descontarse; lo cobrado en origen no se cobra otra vez.
              </p>
            )}

            {pedido.puedeResolver && (
              <p className="crud-nota">
                Resolver no cambia productos, precios ni pagos, y no descuenta inventario. «Facturar en {pedido.origen}» emite aquí la única
                factura; «Enviar a otra ubicación» deja el mismo pedido pendiente en la que elijas.
              </p>
            )}

            <h3 className="pedidos-subtitulo">Historia</h3>
            <ul className="pedidos-eventos">
              {pedido.eventos.map((evento, indice) => (
                <li key={`${indice}-${evento.tipo}`}>
                  {textoDelEvento(evento)} · {evento.usuario} · {fechaYHora(evento.fecha)}
                  {evento.motivo && <span className="pedidos-evento-motivo">«{evento.motivo}»</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </ModalShell>
  )
}

export default DetalleDePedido
