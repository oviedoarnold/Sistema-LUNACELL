import { useId } from "react"

import { formatMoney } from "../../utils/format"
import {
  MEDIOS_DE_PAGO,
  MIXTO,
  cobrosDelSelector,
  faltaPorAsignar,
  llevaReferencia,
} from "../../utils/mediosDePago"

/*
  Con qué se cobra una venta de contado o un abono.

  No sabe qué pantalla lo usa: recibe el total y entrega el estado. La comisión
  del proveedor no aparece aquí porque el vendedor no la ve y no le cambia nada
  al cliente: lo que se cobra es el total, con cualquier medio.
*/
function SelectorDeMedios({ valor, total, moneda, onCambiar }) {
  const id = useId()

  const elegir = (medio) => onCambiar({ ...valor, medio })

  const escribir = (campo, medio, texto) =>
    onCambiar({ ...valor, [campo]: { ...valor[campo], [medio]: texto } })

  const falta = valor.medio === MIXTO ? faltaPorAsignar(cobrosDelSelector(valor, total), total) : 0

  return (
    <div className="medios-de-pago">
      <div className="field pos-campo">
        <label htmlFor={`${id}-medio`}>Medio de pago</label>

        <select id={`${id}-medio`} value={valor.medio} onChange={(e) => elegir(e.target.value)}>
          <option value="">Elige el medio…</option>
          {MEDIOS_DE_PAGO.map((m) => <option key={m.id} value={m.id}>{m.etiqueta}</option>)}
          <option value={MIXTO}>Pago mixto</option>
        </select>
      </div>

      {llevaReferencia(valor.medio) && (
        <div className="field pos-campo">
          <label htmlFor={`${id}-referencia`}>Referencia</label>

          <input
            id={`${id}-referencia`}
            type="text"
            maxLength="120"
            placeholder="Número de autorización o comprobante"
            value={valor.referencias[valor.medio]}
            onChange={(e) => escribir("referencias", valor.medio, e.target.value)}
          />
        </div>
      )}

      {valor.medio === MIXTO && (
        <fieldset className="medios-de-pago-mixto">
          <legend>Importe por medio</legend>

          {MEDIOS_DE_PAGO.map((m) => (
            <div key={m.id} className="medios-de-pago-fila">
              <div className="field">
                <label htmlFor={`${id}-monto-${m.id}`}>{m.etiqueta}</label>

                <input
                  id={`${id}-monto-${m.id}`}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={valor.montos[m.id]}
                  onChange={(e) => escribir("montos", m.id, e.target.value)}
                />
              </div>

              {m.conReferencia && valor.montos[m.id] !== "" && (
                <div className="field">
                  <label htmlFor={`${id}-referencia-${m.id}`}>Referencia de {m.etiqueta}</label>

                  <input
                    id={`${id}-referencia-${m.id}`}
                    type="text"
                    maxLength="120"
                    value={valor.referencias[m.id]}
                    onChange={(e) => escribir("referencias", m.id, e.target.value)}
                  />
                </div>
              )}
            </div>
          ))}

          <p className="medios-de-pago-resto" role="status">
            {falta === 0 && "Los importes suman el total."}
            {falta > 0 && `Falta asignar ${formatMoney(falta, moneda)}.`}
            {falta < 0 && `Sobran ${formatMoney(-falta, moneda)}.`}
          </p>
        </fieldset>
      )}
    </div>
  )
}

export default SelectorDeMedios
