import { useId, useState } from "react"

import { formatMoney } from "../../utils/format"
import {
  MEDIOS_DE_PAGO,
  alternarMedio,
  cobrosDelSelector,
  escribirImporte,
  escribirReferencia,
  faltaPorAsignar,
  importeBloqueado,
  importeVisible,
  problemaDeCobros,
} from "../../utils/mediosDePago"

/*
  Con qué se cobra una venta de contado o un abono.

  No sabe qué pantalla lo usa: recibe el total y entrega el estado. La comisión
  del proveedor no aparece aquí porque el vendedor no la ve y no le cambia nada
  al cliente: lo que se cobra es el total, con cualquier medio.

  El campo de importe es de texto y no numérico: un campo numérico vacía lo que
  se pega con comas, y así el tope no llegaría a verlo. Al entrar se selecciona
  lo escrito: lo que se teclea lo reemplaza, en vez de agregarse al final y
  chocar con el tope.
*/
function SelectorDeMedios({ valor, total, moneda, onCambiar }) {
  const id = useId()
  const [ajustado, setAjustado] = useState(false)

  const cobros = cobrosDelSelector(valor, total)
  const pendiente = faltaPorAsignar(cobros, total)
  const problema = valor.elegidos.length > 0 && total > 0 ? problemaDeCobros(cobros, total) : null

  const alternar = (medio) => {
    setAjustado(false)
    onCambiar(alternarMedio(valor, medio, total))
  }

  const escribir = (medio, texto) => {
    const resultado = escribirImporte(valor, medio, texto, total)

    setAjustado(resultado.ajustado)
    onCambiar(resultado.valor)
  }

  return (
    <fieldset className="medios-de-pago">
      <legend>Medio de pago</legend>

      <div className="medios-de-pago-casillas">
        {MEDIOS_DE_PAGO.map((m) => (
          <label key={m.id} className="medios-de-pago-casilla">
            <input type="checkbox" checked={valor.elegidos.includes(m.id)} onChange={() => alternar(m.id)} />
            {m.etiqueta}
          </label>
        ))}
      </div>

      {MEDIOS_DE_PAGO.filter((m) => valor.elegidos.includes(m.id)).map((m) => {
        const importe = importeVisible(valor, m.id, total)
        const unico = valor.elegidos.length === 1

        return (
          <div key={m.id} className="medios-de-pago-fila">
            <div className="field">
              <label htmlFor={`${id}-monto-${m.id}`}>Importe de {m.etiqueta}</label>

              <input
                id={`${id}-monto-${m.id}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={importe}
                readOnly={unico}
                disabled={importeBloqueado(valor, m.id, total)}
                onFocus={(e) => e.target.select()}
                onChange={(e) => escribir(m.id, e.target.value)}
              />
            </div>

            {m.conReferencia && Number(importe) > 0 && (
              <div className="field">
                <label htmlFor={`${id}-referencia-${m.id}`}>Referencia de {m.etiqueta}</label>

                <input
                  id={`${id}-referencia-${m.id}`}
                  type="text"
                  maxLength="120"
                  autoComplete="off"
                  placeholder="Autorización o comprobante"
                  value={valor.referencias[m.id]}
                  onChange={(e) => onCambiar(escribirReferencia(valor, m.id, e.target.value))}
                />
              </div>
            )}
          </div>
        )
      })}

      <dl className="medios-de-pago-resumen">
        <div>
          <dt>Total</dt>
          <dd>{formatMoney(total, moneda)}</dd>
        </div>

        <div>
          <dt>Importe asignado</dt>
          <dd>{formatMoney(total - pendiente, moneda)}</dd>
        </div>

        <div>
          <dt>{pendiente < 0 ? "Excedente" : "Pendiente"}</dt>
          <dd>{formatMoney(Math.abs(pendiente), moneda)}</dd>
        </div>
      </dl>

      <p className="medios-de-pago-aviso" role="status">
        {ajustado && "El importe se ajustó a lo que quedaba pendiente. "}
        {pendiente < 0 && "El total bajó: reduce un importe. "}
        {pendiente >= 0 && problema}
      </p>
    </fieldset>
  )
}

export default SelectorDeMedios
