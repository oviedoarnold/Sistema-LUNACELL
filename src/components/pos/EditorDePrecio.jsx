import { useId, useState } from "react"

import { formatMoney } from "../../utils/format"
import { MOTIVOS_DE_NEGOCIACION, necesitaMotivo, problemaDelPrecioNegociado } from "../../utils/preciosNegociados"

/*
  Cambia el precio de una línea solo para esta venta. El motivo aparece únicamente
  cuando hace falta: al bajar el precio de referencia.
*/
function EditorDePrecio({ nombre, referencia, precioActual, motivoActual, onAplicar, onCancelar }) {
  const id = useId()
  const [valor, setValor] = useState(String(precioActual))
  const [motivo, setMotivo] = useState(motivoActual || "")
  const [problema, setProblema] = useState("")

  const pideMotivo = valor.trim() !== "" && necesitaMotivo(valor, referencia)

  const aplicar = (evento) => {
    evento.preventDefault()

    const encontrado = problemaDelPrecioNegociado(valor, referencia, motivo)

    if (encontrado) {
      setProblema(encontrado)
      return
    }

    onAplicar({ precio: Number(valor), motivo: pideMotivo ? motivo : null })
  }

  return (
    <form className="pos-editor-precio" onSubmit={aplicar} noValidate>
      <p className="pos-editor-actual">Precio actual: {formatMoney(precioActual)}</p>

      <div className="pos-editor-campos">
        <div className="field">
          <label htmlFor={`${id}-precio`}>Nuevo precio</label>
          <input
            id={`${id}-precio`}
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={valor}
            aria-label={`Nuevo precio de ${nombre}`}
            onChange={(evento) => {
              setValor(evento.target.value)
              setProblema("")
            }}
          />
        </div>

        {pideMotivo && (
          <div className="field">
            <label htmlFor={`${id}-motivo`}>Motivo</label>
            <select
              id={`${id}-motivo`}
              value={motivo}
              aria-label={`Motivo del precio de ${nombre}`}
              onChange={(evento) => {
                setMotivo(evento.target.value)
                setProblema("")
              }}
            >
              <option value="">Elegir…</option>
              {MOTIVOS_DE_NEGOCIACION.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.texto}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {problema && (
        <p className="pos-aviso-precios is-error" role="alert">
          {problema}
        </p>
      )}

      <div className="pos-editor-acciones">
        <button type="submit" className="btn btn-secondary btn-sm">
          Aplicar
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

export default EditorDePrecio
