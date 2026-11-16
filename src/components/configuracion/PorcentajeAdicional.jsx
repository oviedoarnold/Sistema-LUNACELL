import { useContext, useEffect, useState } from "react"
import Swal from "sweetalert2"

import { ProductContext } from "../../context/contexts"
import { useAuth } from "../../hooks/useAuth"
import { traerCambiosDeCargo } from "../../lib/api/catalogos"
import { etiquetaDelMedio, leerPorcentaje, textoDePorcentaje } from "../../utils/mediosDePago"
import { fechaYHoraEnHonduras } from "../../utils/reporteDiario"

/*
  El porcentaje adicional de tarjeta y enlace de pago, uno por medio.

  Lo cambia solo un administrador, y la base lo vuelve a comprobar (0044): a
  quien no lo es se lo rechaza aunque llegara a enviar. Cada cambio queda en el
  historial con quién, cuándo, el valor anterior y el nuevo. Lo ya cobrado
  conserva su porcentaje: cambiarlo solo afecta lo que se cobre después.
*/

const MEDIOS = ["tarjeta", "enlace"]

const aTexto = (tasa) => (tasa === null || tasa === undefined ? "" : String(tasa))

const formularioDe = (cargos) => ({ tarjeta: aTexto(cargos?.tarjeta), enlace: aTexto(cargos?.enlace) })

function PorcentajeAdicional() {
  const { company, guardarCargos } = useContext(ProductContext)
  const { isAdmin } = useAuth()

  const [formulario, setFormulario] = useState(() => formularioDe(company?.cargos))
  const [mostrados, setMostrados] = useState(company?.cargos)
  const [guardando, setGuardando] = useState(false)
  const [cambios, setCambios] = useState([])
  // Sube al guardar, para volver a leer el historial.
  const [version, setVersion] = useState(0)

  // Cuando la empresa vuelve de la base (al cargar o al guardar), el formulario dice lo guardado.
  if (company?.cargos !== mostrados) {
    setMostrados(company?.cargos)
    setFormulario(formularioDe(company?.cargos))
  }

  useEffect(() => {
    if (!isAdmin) return

    let vigente = true

    traerCambiosDeCargo()
      .then((lista) => {
        if (vigente) setCambios(lista)
      })
      .catch(() => {})

    return () => {
      vigente = false
    }
  }, [isAdmin, version])

  const valores = { tarjeta: leerPorcentaje(formulario.tarjeta), enlace: leerPorcentaje(formulario.enlace) }
  const invalido = MEDIOS.find((medio) => valores[medio] === null)
  const sinCambios = MEDIOS.every((medio) => valores[medio] === company?.cargos?.[medio])

  const guardar = async (evento) => {
    evento.preventDefault()

    if (!isAdmin || guardando || sinCambios) return

    if (invalido) {
      Swal.fire({
        icon: "warning",
        title: "Porcentaje inválido",
        text: `El porcentaje de ${etiquetaDelMedio(invalido)} debe estar entre 0 y 100, con hasta dos decimales.`,
      })

      return
    }

    const detalle = MEDIOS.filter((medio) => valores[medio] !== company?.cargos?.[medio])
      .map((medio) => {
        const anterior = company?.cargos?.[medio]
        const antes = anterior === null || anterior === undefined ? "" : `${textoDePorcentaje(anterior)} → `

        return `${etiquetaDelMedio(medio)}: ${antes}${textoDePorcentaje(valores[medio])}`
      })
      .join(". ")

    const respuesta = await Swal.fire({
      icon: "question",
      title: "¿Cambiar el porcentaje adicional?",
      text: `${detalle}. Se aplica a las ventas y abonos que se cobren desde ahora; lo ya cobrado no cambia.`,
      showCancelButton: true,
      confirmButtonText: "Sí, cambiar",
      cancelButtonText: "Cancelar",
    })

    if (!respuesta.isConfirmed) return

    setGuardando(true)

    try {
      await guardarCargos(valores)
      setVersion((v) => v + 1)

      Swal.fire({ icon: "success", title: "Porcentaje guardado", text: "El POS y los abonos ya usan el porcentaje nuevo." })
    } catch (error) {
      Swal.fire({ icon: "error", title: "No se guardó el porcentaje", text: error.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="config-card" aria-labelledby="config-cargos">
      <div className="config-section">
        <h2 className="config-titulo" id="config-cargos">
          Porcentaje adicional por medio de pago
        </h2>

        <p className="config-descripcion">
          Se suma a lo que paga el comprador al cobrar con tarjeta o enlace de pago, sobre el importe de ese
          medio. Las ventas y abonos ya registrados conservan el porcentaje con que se cobraron.
        </p>

        <form onSubmit={guardar}>
          <div className="form-grid">
            {MEDIOS.map((medio) => (
              <div className="field" key={medio}>
                <label htmlFor={`config-cargo-${medio}`}>{etiquetaDelMedio(medio)} (%)</label>

                <input
                  id={`config-cargo-${medio}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={formulario[medio]}
                  readOnly={!isAdmin}
                  aria-invalid={valores[medio] === null}
                  onChange={(e) => setFormulario((actual) => ({ ...actual, [medio]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          {!isAdmin && <p className="config-descripcion config-nota">Solo un administrador puede cambiarlos.</p>}

          {isAdmin && (
            <div className="config-acciones">
              <button type="submit" className="btn btn-primary" disabled={guardando || sinCambios}>
                {guardando ? "Guardando…" : "Guardar porcentajes"}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                disabled={guardando || sinCambios}
                onClick={() => setFormulario(formularioDe(company?.cargos))}
              >
                Descartar cambios
              </button>
            </div>
          )}
        </form>

        {isAdmin && cambios.length > 0 && (
          <div className="config-subseccion">
            <h3 className="config-subtitulo">Últimos cambios</h3>

            <ul className="config-historial" aria-label="Últimos cambios del porcentaje adicional">
              {cambios.map((c) => (
                <li key={c.id}>
                  <span>{fechaYHoraEnHonduras(c.en)}</span>
                  <span>
                    {etiquetaDelMedio(c.medio)}: {textoDePorcentaje(c.anterior)} → {textoDePorcentaje(c.nueva)}
                  </span>
                  <span>{c.por}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

export default PorcentajeAdicional
