import { useId } from "react"

import { MOTIVOS_DE_NEGOCIACION, necesitaMotivo } from "../../utils/preciosNegociados"

/*
  El precio unitario de una línea del carrito, editable ahí mismo: se borra, se
  escribe el nuevo y se sigue facturando. Vale solo para esta venta.

  Devuelve dos piezas de la cuadrícula de la línea: el campo, junto a la cantidad,
  y debajo, solo cuando hace falta, el motivo de la rebaja o qué está mal.
*/
function PrecioDeLinea({ linea, onEscribir, onTerminar, onMotivo }) {
  const id = useId()
  const valor = linea.precioEscrito ?? Number(linea.price).toFixed(2)
  const pideMotivo = Boolean(linea.negociado) && necesitaMotivo(linea.price, linea.precioReferencia)
  const problema = linea.problemaDePrecio
  const idDelProblema = problema ? `${id}-problema` : undefined

  return (
    <>
      <label className={`pos-precio-campo${problema ? " is-invalid" : ""}${linea.negociado ? " is-negociado" : ""}`}>
        <span aria-hidden="true">L</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={valor}
          aria-label={`Precio de ${linea.name}`}
          aria-invalid={problema ? "true" : undefined}
          aria-describedby={idDelProblema}
          onFocus={(evento) => evento.target.select()}
          onChange={(evento) => onEscribir(evento.target.value)}
          onBlur={onTerminar}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") evento.currentTarget.blur()
          }}
        />
      </label>

      {(pideMotivo || problema) && (
        <div className="pos-precio-ajuste">
          {pideMotivo && (
            <select
              value={linea.motivoNegociacion || ""}
              aria-label={`Motivo del precio de ${linea.name}`}
              aria-invalid={linea.motivoNegociacion ? undefined : "true"}
              onChange={(evento) => onMotivo(evento.target.value)}
            >
              <option value="">Motivo de la rebaja…</option>
              {MOTIVOS_DE_NEGOCIACION.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.texto}
                </option>
              ))}
            </select>
          )}

          {problema && (
            <small id={idDelProblema} className="pos-precio-problema" role="alert">
              {problema}
            </small>
          )}
        </div>
      )}
    </>
  )
}

export default PrecioDeLinea
