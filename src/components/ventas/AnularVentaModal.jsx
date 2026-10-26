import { useState } from "react"

import ModalShell from "../forms/ModalShell"
import FormField from "../forms/FormField"

import { anularVenta } from "../../lib/api/ventas"
import { MOTIVO_MINIMO, TRATAMIENTOS_DEL_DINERO, mensajeDeRechazo } from "../../utils/anulacion"
import { isCreditSale } from "../../utils/salesUtils"
import { formatMoney } from "../../utils/format"

/*
  Confirmar la anulación de una venta.

  Antes de confirmar se ve qué se anula —número, cliente, ubicación,
  productos y total— y qué va a pasar: el número se conserva y la
  mercadería vuelve a la ubicación de la venta. El motivo es obligatorio y
  queda registrado; en una venta de contado se dice además qué pasa con el
  dinero, que nunca se da por devuelto.

  Si la venta no se puede anular, la ventana lo dice y no deja confirmar.
  Es la misma regla que aplica la base, que es la que decide.

  Mientras la anulación está en curso no se puede cerrar ni repetir. La
  clave del intento es la de la venta: si la red se cae y se pulsa otra
  vez, la base responde que ya estaba anulada en vez de anular dos veces.
*/
function AnularVentaModal({ venta, ubicacion, moneda = "L", razon = null, onCerrar, onAnulada }) {
  const [motivo, setMotivo] = useState("")
  const [tratamiento, setTratamiento] = useState(TRATAMIENTOS_DEL_DINERO[0].id)
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState("")

  const credito = isCreditSale(venta)
  const motivoValido = motivo.trim().length >= MOTIVO_MINIMO

  const confirmar = async () => {
    if (razon || !motivoValido || enCurso) return

    setEnCurso(true)
    setError("")

    try {
      const respuesta = await anularVenta(venta.id, {
        motivo: motivo.trim(),
        tratamientoDinero: credito ? null : tratamiento,
        clave: `anular-${venta.id}`,
      })

      await onAnulada?.(respuesta)
    } catch (problema) {
      setError(mensajeDeRechazo(problema))
      setEnCurso(false)
    }
  }

  const acciones = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={enCurso}>
        Cancelar
      </button>

      <button type="button" className="btn btn-danger" onClick={confirmar} disabled={Boolean(razon) || !motivoValido || enCurso}>
        {enCurso ? "Anulando..." : "Anular venta"}
      </button>
    </>
  )

  return (
    <ModalShell titulo={`Anular ${venta.invoiceNumber}`} onCerrar={enCurso ? () => {} : onCerrar} acciones={acciones}>
      <dl className="anular-resumen">
        <dt>Documento</dt>
        <dd>{venta.invoiceNumber}</dd>
        <dt>Cliente</dt>
        <dd>{venta.clientName || "Consumidor Final"}</dd>
        <dt>Ubicación</dt>
        <dd>{ubicacion || "—"}</dd>
        <dt>Forma de pago</dt>
        <dd>{credito ? "Crédito" : "Contado"}</dd>
        <dt>Total</dt>
        <dd>{formatMoney(venta.total, moneda)}</dd>
      </dl>

      <ul className="anular-productos" aria-label="Productos de la venta">
        {(venta.items || []).map((item) => (
          <li key={`${item.productId}-${item.price}`}>
            <span>{item.name}</span>
            <b>× {item.qty ?? item.quantity}</b>
          </li>
        ))}
      </ul>

      {razon && (
        <div className="alert-banner" role="alert">
          {razon}
        </div>
      )}

      <p className="anular-aviso">
        El número {venta.invoiceNumber} se conserva y no se vuelve a usar. Las existencias regresan a {ubicacion || "la ubicación de la venta"}.
        {credito ? " El saldo pendiente de esta venta se cancela." : ""}
      </p>

      {!razon && (
        <>
          <FormField
            etiqueta="Motivo de la anulación"
            ayuda={`Obligatorio, al menos ${MOTIVO_MINIMO} caracteres. Queda registrado y no se puede cambiar.`}
            ancho="full"
          >
            <textarea id="anular-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={enCurso} />
          </FormField>

          {!credito && (
            <fieldset className="anular-dinero" disabled={enCurso}>
              <legend>¿Qué pasa con el dinero?</legend>
              {TRATAMIENTOS_DEL_DINERO.map((opcion) => (
                <label key={opcion.id}>
                  <input
                    type="radio"
                    name="anular-dinero"
                    value={opcion.id}
                    checked={tratamiento === opcion.id}
                    onChange={() => setTratamiento(opcion.id)}
                  />
                  <span>
                    <b>{opcion.etiqueta}</b>
                    <small>{opcion.ayuda}</small>
                  </span>
                </label>
              ))}
              <p className="hint">Anular no registra que el dinero se devolvió.</p>
            </fieldset>
          )}
        </>
      )}

      {error && (
        <div className="alert-banner" role="alert">
          {error}
        </div>
      )}
    </ModalShell>
  )
}

export default AnularVentaModal
