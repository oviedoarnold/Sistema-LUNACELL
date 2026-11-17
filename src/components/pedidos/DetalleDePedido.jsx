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
*/

const EVENTOS = {
  entregado: "Entregado en origen",
  facturado: "Facturado",
  rechazado: "Rechazado",
  reenviado: "Reenviado",
  facturar_en_origen: "Se factura en origen",
  cancelacion_solicitada: "Cancelación solicitada",
  cancelacion_autorizada: "Cancelación autorizada",
  cancelacion_rechazada: "Cancelación rechazada",
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

function DetalleDePedido({ pedido, cargando, error, facturando, sinConexion, onFacturar, onCerrar }) {
  const titulo = pedido ? `Pedido ${pedido.numero}` : "Pedido"

  const acciones = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCerrar}>
        Cerrar
      </button>

      {pedido?.puedeFacturar && (
        <button type="button" className="btn btn-primary" disabled={facturando || sinConexion} onClick={onFacturar}>
          {facturando ? "Facturando…" : "Facturar"}
        </button>
      )}
    </>
  )

  return (
    <ModalShell titulo={titulo} onCerrar={onCerrar} cerrarAlPulsarFuera ancho="modal-wide" acciones={acciones}>
      <div className="pedidos-detalle">
        {cargando && <p className="crud-cargando" role="status">Cargando el pedido…</p>}
        {error && <p className="alert-banner" role="alert">{error}</p>}

        {pedido && (
          <>
            {pedido.puedeFacturar && sinConexion && (
              <p className="alert-banner" role="alert">
                Facturar un pedido necesita conexión. Podrás hacerlo cuando vuelva.
              </p>
            )}

            <dl className="pedidos-datos">
              {[
                ["Estado", ESTADOS_DE_PEDIDO[pedido.estado] || pedido.estado],
                ["Cliente", `${pedido.cliente}${pedido.rtn ? ` · RTN ${pedido.rtn}` : ""}`],
                ["Entregó", `${pedido.origen} · ${pedido.entregadoPor || "—"} · ${fechaYHora(pedido.entregadoEn)}`],
                ["Factura", pedido.numeroFactura ? `${pedido.destino} · ${pedido.numeroFactura} · ${fechaYHora(pedido.facturadoEn)}` : pedido.destino],
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

            <h3 className="pedidos-subtitulo">Historia</h3>
            <ul className="pedidos-eventos">
              {pedido.eventos.map((evento) => (
                <li key={`${evento.tipo}-${evento.fecha}`}>
                  {EVENTOS[evento.tipo] || evento.tipo} · {evento.usuario} · {fechaYHora(evento.fecha)}
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
