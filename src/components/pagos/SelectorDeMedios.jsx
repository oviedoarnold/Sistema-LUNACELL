import { useId, useState } from "react"

import { formatMoney } from "../../utils/format"
import {
  MEDIOS_DE_PAGO,
  MEDIOS_EN_MIXTO,
  MIXTO,
  UNICO,
  cambiarModalidad,
  cobrosDelSelector,
  elegirMedio,
  escribirImporte,
  escribirReferencia,
  faltaPorAsignar,
  importeCalculado,
  importeDe,
  problemaDelSelector,
} from "../../utils/mediosDePago"

const MODALIDADES = [
  { id: UNICO, etiqueta: "Pago único" },
  { id: MIXTO, etiqueta: "Pago mixto" },
]

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
function SelectorDeMedios({ valor, total, onCambiar }) {
  const id = useId()
  const [ajustado, setAjustado] = useState(false)

  const mixto = valor.modalidad === MIXTO
  const lleno = valor.elegidos.length >= MEDIOS_EN_MIXTO

  const cambiar = (siguiente) => {
    setAjustado(false)
    onCambiar(siguiente)
  }

  const escribir = (medio, texto) => {
    const resultado = escribirImporte(valor, medio, texto, total)

    // Si se sigue tecleando sobre el tope, el importe no cambia y el aviso se queda.
    setAjustado(resultado.ajustado || (ajustado && resultado.valor.montos[medio] === valor.montos[medio]))
    onCambiar(resultado.valor)
  }

  return (
    <fieldset className="medios-de-pago">
      <legend>Medio de pago</legend>

      <div className="medios-de-pago-opciones">
        {MODALIDADES.map((m) => (
          <label key={m.id} className="medios-de-pago-opcion medios-de-pago-modalidad">
            <input
              type="radio"
              name={`${id}-modalidad`}
              checked={valor.modalidad === m.id}
              onChange={() => cambiar(cambiarModalidad(valor, m.id))}
            />
            {m.etiqueta}
          </label>
        ))}
      </div>

      <div className="medios-de-pago-opciones">
        {MEDIOS_DE_PAGO.map((m) => {
          const elegido = valor.elegidos.includes(m.id)

          return (
            <label key={m.id} className="medios-de-pago-opcion">
              <input
                type={mixto ? "checkbox" : "radio"}
                name={mixto ? undefined : `${id}-medio`}
                checked={elegido}
                disabled={mixto && lleno && !elegido}
                onChange={() => cambiar(elegirMedio(valor, m.id))}
              />
              {m.etiqueta}
            </label>
          )
        })}
      </div>

      <div className="medios-de-pago-filas">
        {MEDIOS_DE_PAGO.filter((m) => valor.elegidos.includes(m.id) && (mixto || m.conReferencia)).map((m) => (
          <div key={m.id} className="medios-de-pago-fila">
            {mixto && (
              <div className={`field${importeCalculado(valor, m.id) ? " medios-de-pago-calculado" : ""}`}>
                <label htmlFor={`${id}-monto-${m.id}`}>Importe de {m.etiqueta}</label>

                <input
                  id={`${id}-monto-${m.id}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={importeDe(valor, m.id, total)}
                  disabled={!(total > 0)}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => escribir(m.id, e.target.value)}
                />
              </div>
            )}

            {m.conReferencia && (
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
        ))}
      </div>

      {ajustado && (
        <p className="medios-de-pago-aviso" role="status">
          El importe se ajustó al total.
        </p>
      )}
    </fieldset>
  )
}

/*
  Cuánto va asignado y qué falta. Va aparte del selector para que el punto de
  venta lo ponga junto al botón de facturar: ahí se ve por qué no se puede
  confirmar, aunque los campos hayan quedado fuera de la vista. No repite el
  total: cada pantalla ya lo muestra.
*/
export function ResumenDeMedios({ valor, total, moneda }) {
  const pendiente = faltaPorAsignar(cobrosDelSelector(valor, total), total)
  const problema = total > 0 ? problemaDelSelector(valor, total) : null

  return (
    <div className="medios-de-pago-cuadre">
      <dl className="medios-de-pago-resumen">
        <div>
          <dt>Importe asignado</dt>
          <dd>{formatMoney(total - pendiente, moneda)}</dd>
        </div>

        <div className={pendiente === 0 ? undefined : "medios-de-pago-falta"}>
          <dt>{pendiente < 0 ? "Excedente" : "Pendiente"}</dt>
          <dd>{formatMoney(Math.abs(pendiente), moneda)}</dd>
        </div>
      </dl>

      <p className="medios-de-pago-aviso" role="status">
        {pendiente < 0 ? "El total bajó: reduce un importe." : problema}
      </p>
    </div>
  )
}

export default SelectorDeMedios
