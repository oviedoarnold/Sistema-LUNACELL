import ModalShell from "../forms/ModalShell"
import { ESTADOS_DE_PEDIDO } from "../../lib/api/pedidos"
import { etiquetaDelMedio, textoDePorcentaje } from "../../utils/mediosDePago"
import { textoDelMotivo } from "../../utils/preciosNegociados"
import { cifrasDeCancelado, pendientesQuePuedeCompletar } from "../../utils/cancelacionDePedidos"
import { claseDelPedido } from "../../utils/coloresDeEstado"
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
  cancelado: "Cancelado",
  devolucion_recibida: "Productos devueltos recibidos",
  reembolso_registrado: "Reembolso al cliente registrado",
}

const CONDICIONES = { buen_estado: "buen estado", danado: "dañado" }

/*
  El pedido cancelado (0049): por qué, qué falta recibir, qué falta devolver al
  cliente y lo ya registrado. Las acciones para completar lo pendiente van al pie.
*/
function SeccionDeCancelacion({ cancelacion }) {
  const { cancelacion: c, productos, dinero, recepciones, reembolsos, obligaciones = [] } = cancelacion

  return (
    <section className="pedidos-cancelacion" aria-label="Cancelación">
      <div className="pedidos-rechazo">
        <b>{c.estadoAnterior === "facturado" ? "Factura anulada: pedido cancelado" : "Pedido cancelado"}</b>
        <span>«{c.motivo}»</span>
        <small>
          {c.usuario} · {fechaYHora(c.fecha)}
        </small>
      </div>

      <h3 className="pedidos-subtitulo">Productos</h3>
      <ul className="pedidos-cobros">
        {productos.map((p) => (
          <li key={p.id}>
            <span>
              {p.nombre}
              <small>
                Entregados {p.entregado} · recibidos en buen estado {p.buenEstado} · dañados {p.danado}
              </small>
            </span>
            <span className={p.pendiente > 0 ? "pedidos-pendiente" : "pos-importe"}>{p.pendiente > 0 ? `Por recibir ${p.pendiente}` : "Recibido"}</span>
          </li>
        ))}
      </ul>

      {dinero.length > 0 && (
        <>
          <h3 className="pedidos-subtitulo">Reembolsos al cliente</h3>
          <ul className="pedidos-cobros">
            {dinero.map((d) => (
              <li key={d.medio}>
                <span>
                  {etiquetaDelMedio(d.medio)}
                  <small>
                    Recibido {formatMoney(d.total)}
                    {d.cargo > 0 ? ` (incluye cargo ${formatMoney(d.cargo)})` : ""} · devuelto {formatMoney(d.devuelto)}
                  </small>
                </span>
                <span className={d.pendiente > 0 ? "pedidos-pendiente" : "pos-importe"}>
                  {d.pendiente > 0 ? `Por devolver ${formatMoney(d.pendiente)}` : "Devuelto"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {(recepciones.length > 0 || reembolsos.length > 0) && (
        <>
          <h3 className="pedidos-subtitulo">Registrado</h3>
          <ul className="pedidos-eventos">
            {recepciones.map((r, i) => (
              <li key={`r-${i}`}>
                Recibido en {r.ubicacion}
                {r.enOtraUbicacion ? " (otra ubicación)" : ""}: {r.productos.map((p) => `${p.cantidad} ${p.nombre} (${CONDICIONES[p.condicion]})`).join(", ")} · {r.usuario} ·{" "}
                {fechaYHora(r.fecha)}
                {r.nota && <span className="pedidos-evento-motivo">«{r.nota}»</span>}
              </li>
            ))}
            {reembolsos.map((r, i) => (
              <li key={`d-${i}`}>
                Devuelto {formatMoney(r.importe)} con {etiquetaDelMedio(r.medio)}
                {r.ubicacion ? ` desde ${r.ubicacion}` : " desde la cuenta de la empresa"}
                {r.enOtraUbicacion ? " (otra ubicación)" : ""} · {r.usuario} · {fechaYHora(r.fecha)}
                {r.referencia && <span className="pedidos-evento-motivo">Referencia: {r.referencia}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {cancelacion.bloqueoDeReembolsos && (
        <p className="alert-banner" role="alert">
          El efectivo de este pedido está en {cancelacion.bloqueoDeReembolsos}. Mientras no se confirme o se rechace en Liquidaciones, no se registran
          devoluciones en efectivo.
        </p>
      )}

      {obligaciones.length > 0 && (
        <>
          {/* 0050: quién devolvió efectivo que conserva otra ubicación. Se liquida en Liquidaciones; no es venta ni cobro. */}
          <h3 className="pedidos-subtitulo">Entre ubicaciones</h3>
          <ul className="pedidos-cobros">
            {obligaciones.map((o) => (
              <li key={`${o.debe}|${o.recibe}`}>
                <span>
                  {o.debe} le debe a {o.recibe}
                  <small>
                    {formatMoney(o.monto)} · liquidado {formatMoney(o.liquidado)}
                    {o.porConfirmar > 0 ? ` · por confirmar ${formatMoney(o.porConfirmar)}` : ""}
                  </small>
                </span>
                <span className={o.pendiente > 0 ? "pedidos-pendiente" : "pos-importe"}>
                  {o.pendiente > 0 ? `Pendiente ${formatMoney(o.pendiente)}` : o.porConfirmar > 0 ? "Por confirmar" : "Liquidado"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// Lo que dice la historia de cada paso, con el cambio de ubicación cuando lo hubo.
function textoDelEvento(evento) {
  if (evento.tipo === "rechazado") return `Rechazado en ${evento.rechazadoEn || evento.ubicacion}`
  if (evento.tipo === "reenviado") return `Enviado de ${evento.desde} a ${evento.hacia}`
  if (evento.tipo === "facturar_en_origen") return `Se factura en ${evento.hacia} (lo rechazó ${evento.desde})`

  return EVENTOS[evento.tipo] || evento.tipo
}

/*
  Un pedido cancelado ya no se le cobra a nadie: lo que se ve es lo que pagó el
  cliente, lo devuelto y lo que falta devolver. El saldo que tenía antes de
  cancelar queda como dato histórico, nunca como deuda.
*/
function TotalesDeCancelado({ pedido, cancelacion }) {
  const cifras = cifrasDeCancelado(pedido, cancelacion)

  return (
    <>
      <div className="totals-row">
        <span>Pagos recibidos antes de cancelar</span>
        <span className="v">{formatMoney(cifras.recibido)}</span>
      </div>
      {cifras.reembolsado !== null && (
        <>
          <div className="totals-row">
            <span>Reembolsado al cliente</span>
            <span className="v">{formatMoney(cifras.reembolsado)}</span>
          </div>
          <div className="totals-row">
            <span>Reembolso pendiente</span>
            <span className={cifras.porReembolsar > 0 ? "v pedidos-pendiente" : "v"}>{formatMoney(cifras.porReembolsar)}</span>
          </div>
        </>
      )}
      {cifras.saldoAntes > 0 && (
        <div className="totals-row pedidos-historico">
          <span>Saldo original antes de cancelar</span>
          <span className="v">{formatMoney(cifras.saldoAntes)}</span>
        </div>
      )}
      <div className="totals-row grand">
        <span>Saldo vigente por cobrar</span>
        <span className="v">{formatMoney(cifras.saldoVigente)}</span>
      </div>
    </>
  )
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

function AccionesDelPedido({ pedido, cancelacion, operando, sinConexion, onFacturar, onRechazar, onReenviar, onFacturarEnOrigen, onFormulario }) {
  if (!pedido) return null

  const ocupado = Boolean(operando) || sinConexion
  const bloqueado = Boolean(pedido.bloqueoPorLiquidacion)
  const completar = pendientesQuePuedeCompletar(cancelacion)

  return (
    <>
      {cancelacion?.puedeCancelar && (
        <button type="button" className="btn btn-danger" disabled={ocupado || Boolean(cancelacion.bloqueoPorLiquidacion)} onClick={() => onFormulario("cancelar")}>
          Cancelar pedido
        </button>
      )}

      {completar.recibir && (
        <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => onFormulario("recibir")}>
          Registrar productos recibidos
        </button>
      )}

      {completar.reembolsar && (
        <button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => onFormulario("reembolsar")}>
          Registrar reembolso
        </button>
      )}

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

function DetalleDePedido({
  pedido,
  cancelacion = null,
  cargando,
  error,
  operando,
  sinConexion,
  onFacturar,
  onRechazar,
  onReenviar,
  onFacturarEnOrigen,
  onFormulario = () => {},
  onCerrar,
}) {
  const titulo = pedido ? `Pedido ${pedido.numero}` : "Pedido"
  const cancelado = pedido?.estado === "cancelado"
  const completar = pendientesQuePuedeCompletar(cancelacion)
  const opera = Boolean(
    pedido && (pedido.puedeFacturar || pedido.puedeRechazar || pedido.puedeResolver || cancelacion?.puedeCancelar || completar.recibir || completar.reembolsar)
  )

  const acciones = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCerrar}>
        Cerrar
      </button>

      <AccionesDelPedido
        pedido={pedido}
        cancelacion={cancelacion}
        onFormulario={onFormulario}
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
                Facturar, rechazar, resolver o cancelar un pedido, y registrar productos devueltos o reembolsos, necesita conexión. Podrás
                hacerlo cuando vuelva.
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

            {cancelacion?.cancelacion && <SeccionDeCancelacion cancelacion={cancelacion} />}

            <dl className="ficha-datos">
              {[
                ["Estado", <span className={claseDelPedido(pedido.estado)}>{ESTADOS_DE_PEDIDO[pedido.estado] || pedido.estado}</span>],
                ["Cliente", `${pedido.cliente}${pedido.rtn ? ` · RTN ${pedido.rtn}` : ""}`],
                ["Entregó", `${pedido.origen} · ${pedido.entregadoPor || "—"} · ${fechaYHora(pedido.entregadoEn)}`],
                [
                  "Factura",
                  pedido.numeroFactura
                    ? `${pedido.destino} · ${pedido.numeroFactura}${cancelado ? " (anulada)" : ""} · ${fechaYHora(pedido.facturadoEn)}`
                    : pedido.estado === "por_resolver"
                      ? `Por decidir (lo rechazó ${pedido.destino})`
                      : pedido.estado === "cancelado"
                        ? `No se factura (iba a ${pedido.destino})`
                        : pedido.destino,
                ],
                [
                  "Forma de pago",
                  // Un pedido cancelado no vence: ya no se le cobra nada al cliente.
                  pedido.formaPago === "credito"
                    ? `Crédito${pedido.fechaVencimiento && !cancelado ? ` · vence ${pedido.fechaVencimiento}` : ""}`
                    : "Contado",
                ],
                ["Nota", pedido.nota || "—"],
              ].map(([termino, valor]) => (
                <div className="ficha-dato" key={termino}>
                  <dt>{termino}</dt>
                  <dd>{valor}</dd>
                </div>
              ))}
            </dl>

            <section className="ficha-seccion" aria-label="Productos">
              <h4>Productos ({pedido.productos.length})</h4>
              <div className="table-wrap">
                <table className="tabla-compacta">
                  <thead>
                    <tr>
                      <th scope="col">Producto</th>
                      <th scope="col" className="celda-cifra">Cant.</th>
                      <th scope="col" className="celda-cifra">Precio</th>
                      <th scope="col" className="celda-cifra">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedido.productos.map((producto) => (
                      <tr key={producto.id}>
                        <td className="pedidos-producto-nombre">
                          {producto.nombre}
                          <small>entregado en {pedido.origen}: {producto.entregado}</small>
                          <PrecioDelProducto producto={producto} />
                        </td>
                        <td className="celda-cifra">{producto.cantidad}</td>
                        <td className="celda-cifra">{formatMoney(producto.precio)}</td>
                        <td className="celda-cifra pos-importe">{formatMoney(producto.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="totals pedidos-totales">
              <div className="totals-row">
                <span>Subtotal</span>
                <span className="v">{formatMoney(pedido.subtotal)}</span>
              </div>
              <div className="totals-row">
                <span>ISV ({pedido.tasaIsv}%)</span>
                <span className="v">{formatMoney(pedido.isv)}</span>
              </div>
              <div className={cancelado ? "totals-row" : "totals-row grand"}>
                <span>{cancelado ? "Total original" : "Total"}</span>
                <span className="v">{formatMoney(pedido.total)}</span>
              </div>
              {pedido.cargo > 0 && (
                <div className="totals-row">
                  <span>Cargo por medio de pago{pedido.tasaCargo !== null ? ` (${textoDePorcentaje(pedido.tasaCargo)})` : ""}</span>
                  <span className="v">{formatMoney(pedido.cargo)}</span>
                </div>
              )}
              {cancelado ? (
                <TotalesDeCancelado pedido={pedido} cancelacion={cancelacion} />
              ) : (
                <>
                  <div className="totals-row">
                    <span>{pedido.formaPago === "credito" ? `Pago parcial recibido en ${pedido.origen}` : `Cobrado en ${pedido.origen}`}</span>
                    <span className="v">{formatMoney(pedido.cobrado)}</span>
                  </div>
                  <div className="totals-row">
                    <span>{pedido.formaPago === "credito" ? "Saldo pendiente del cliente" : "Saldo"}</span>
                    <span className="v">{formatMoney(pedido.saldo)}</span>
                  </div>
                </>
              )}
            </div>

            {pedido.cobros.length > 0 && (
              <>
                <h3 className="pedidos-subtitulo">{cancelado ? "Detalle de los pagos recibidos" : "Cobros recibidos en origen"}</h3>
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
