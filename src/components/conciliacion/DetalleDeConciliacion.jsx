import { useState } from "react"

import ModalShell from "../forms/ModalShell"
import { formatMoney } from "../../utils/format"
import { conciliarVenta } from "../../lib/api/conciliacion"
import { ACCIONES_DE_CONCILIACION_TEXTO, motivoDeConciliacion } from "../../lib/sinConexion/textos"

/*
  El detalle de una venta por conciliar y lo que un administrador puede
  hacer con ella (conciliar_venta, 0028):

  - Aplicar: se registra con el vendedor, la ubicación, la fecha y el precio
    que de verdad se cobraron, como documento interno.
  - Aplicar con ajuste: si falta existencia, primero un ajuste por exactamente
    lo que falta, con este motivo, y después la venta.
  - Anular: el registro se conserva con su motivo.

  El motivo es obligatorio. Mientras una acción está en curso no se puede
  pedir otra (y la base, además, solo deja resolver una vez).
*/
const fechaYHora = (iso) => (iso ? new Date(iso).toLocaleString("es-HN") : "—")

const ORIGEN = { vendedor: "Enviada por el vendedor", rescate: "Rescatada por un administrador" }
const ESTADO = { pendiente: "Pendiente", aplicada: "Aplicada", anulada: "Anulada" }

function DetalleDeConciliacion({ venta, nombreDelVendedor, nombreDeUbicacion, onCerrar, onResuelta }) {
  const [motivo, setMotivo] = useState("")
  const [enCurso, setEnCurso] = useState(null)
  const [error, setError] = useState("")
  const [resultado, setResultado] = useState(null)

  const pendiente = venta.estado === "pendiente" && !resultado

  const resolver = async (accion) => {
    if (enCurso) return

    if (!motivo.trim()) {
      setError("Escribe el motivo: queda registrado con la conciliación.")
      return
    }

    setError("")
    setEnCurso(accion)

    try {
      const respuesta = await conciliarVenta(venta.id, accion, motivo)

      setResultado(respuesta)
      onResuelta?.(respuesta)
    } catch (problema) {
      setError(problema?.message || "No se pudo conciliar la venta.")
    } finally {
      setEnCurso(null)
    }
  }

  const acciones = pendiente ? (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={Boolean(enCurso)}>
        Cerrar
      </button>
      {["anular", "aplicar_con_ajuste", "aplicar"].map((accion) => (
        <button
          key={accion}
          type="button"
          className={accion === "anular" ? "btn btn-secondary" : "btn btn-primary"}
          onClick={() => resolver(accion)}
          disabled={Boolean(enCurso)}
        >
          {enCurso === accion ? "Procesando…" : ACCIONES_DE_CONCILIACION_TEXTO[accion]}
        </button>
      ))}
    </>
  ) : (
    <button type="button" className="btn btn-primary" onClick={onCerrar}>
      Cerrar
    </button>
  )

  return (
    <ModalShell titulo={`Venta por conciliar ${venta.numeroProvisional}`} onCerrar={onCerrar} ancho="modal-lg" acciones={acciones}>
      <div className="conciliacion-detalle">
        <dl>
          <dt>Motivo</dt>
          <dd>{motivoDeConciliacion(venta.motivo)}</dd>
          {venta.detalle && (
            <>
              <dt>Detalle del servidor</dt>
              <dd>
                {venta.detalle}
                {venta.codigo ? ` (${venta.codigo})` : ""}
              </dd>
            </>
          )}
          <dt>Origen</dt>
          <dd>{ORIGEN[venta.recibidaPor] || venta.recibidaPor}</dd>
          <dt>Vendedor</dt>
          <dd>{nombreDelVendedor}</dd>
          <dt>Ubicación</dt>
          <dd>{nombreDeUbicacion}</dd>
          <dt>Dispositivo</dt>
          <dd>{venta.dispositivo}</dd>
          <dt>Fecha de la venta</dt>
          <dd>{fechaYHora(venta.registradaEn)}</dd>
          <dt>Recibida</dt>
          <dd>
            {fechaYHora(venta.recibidaEn)}
            {Number.isFinite(venta.desfaseSegundos) ? ` · reloj del teléfono con ${venta.desfaseSegundos} s de diferencia` : ""}
          </dd>
          <dt>Forma de pago</dt>
          <dd>
            {venta.formaPago === "credito" ? "Crédito" : "Contado"}
            {venta.fechaVencimiento ? ` · vence ${venta.fechaVencimiento}` : ""}
          </dd>
          <dt>Cliente</dt>
          <dd>
            {venta.nombreCliente || "Consumidor Final"}
            {venta.rtnComprador ? ` · RTN ${venta.rtnComprador}` : ""}
          </dd>
          {venta.nota && (
            <>
              <dt>Nota</dt>
              <dd>{venta.nota}</dd>
            </>
          )}
          <dt>Estado</dt>
          <dd>{ESTADO[venta.estado] || venta.estado}</dd>
        </dl>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col" className="r">
                  Cantidad
                </th>
                <th scope="col" className="r">
                  Precio cobrado
                </th>
                <th scope="col" className="r">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {venta.renglones.map((r, indice) => (
                <tr key={`${r.productoId}-${indice}`}>
                  <td>
                    {r.nombre}
                    {r.codigo ? ` · ${r.codigo}` : ""}
                  </td>
                  <td className="r">{r.cantidad}</td>
                  <td className="r">{formatMoney(r.precio)}</td>
                  <td className="r">{formatMoney(r.precio * r.cantidad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          <b>Total cobrado:</b> {formatMoney(venta.totalCobrado)} (ISV {venta.tasaIsv}%)
        </p>

        {venta.estado !== "pendiente" && (
          <p role="note">
            Resuelta el {fechaYHora(venta.resueltaEn)}: {ACCIONES_DE_CONCILIACION_TEXTO[venta.resolucionAccion] || "—"}.{" "}
            {venta.resolucionMotivo}
            {venta.ajustes.length > 0 && ` Ajustes de inventario: ${venta.ajustes.length}.`}
          </p>
        )}

        {pendiente && (
          <div className="field">
            <label htmlFor="conciliacion-motivo">Motivo de la decisión</label>
            <textarea
              id="conciliacion-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. El traslado al camión se registró tarde; se repone lo que faltaba."
            />
            <span className="hint">
              «Aplicar con ajuste» repone exactamente lo que falte en la ubicación, con este motivo, y nunca deja
              existencias negativas.
            </span>
          </div>
        )}

        {error && (
          <div className="alert-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        {resultado && (
          <div className="conciliacion-resultado" role="status">
            <p>
              <b>{textoDelResultado(resultado.estado)}</b>
              {resultado.numero_factura ? ` · Documento ${resultado.numero_factura}` : ""}
            </p>
            {Array.isArray(resultado.ajustes) && resultado.ajustes.length > 0 && (
              <p>Se registraron {resultado.ajustes.length} ajustes de inventario antes de aplicar la venta.</p>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

function textoDelResultado(estado) {
  const textos = {
    aplicada: "Venta aplicada",
    ya_aplicada: "Ya estaba aplicada",
    anulada: "Venta anulada",
    ya_anulada: "Ya estaba anulada",
  }

  return textos[estado] || "Conciliación registrada"
}

export default DetalleDeConciliacion
