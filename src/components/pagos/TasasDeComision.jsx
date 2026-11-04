import { useEffect, useState } from "react"
import Swal from "sweetalert2"

import { useAuth } from "../../hooks/useAuth"
import { configurarTasaDeComision, traerTasasDeComision } from "../../lib/api/comisiones"

const MEDIOS = [
  { id: "tarjeta", etiqueta: "Tarjeta" },
  { id: "enlace", etiqueta: "Enlace de pago" },
]

/*
  La tasa con la que se estima la comisión del proveedor de pagos.

  Es un dato interno del negocio: no cambia lo que paga el cliente ni aparece en
  la factura. Una tasa nueva vale de ahora en adelante.
*/
function TasasDeComision() {
  const { isAdmin } = useAuth()
  const [tasas, setTasas] = useState(null)
  const [escritas, setEscritas] = useState({})
  const [error, setError] = useState("")
  const [guardando, setGuardando] = useState("")

  useEffect(() => {
    if (!isAdmin) return undefined

    let sigue = true

    traerTasasDeComision()
      .then((vigentes) => {
        if (sigue) setTasas(vigentes)
      })
      .catch((problema) => {
        if (sigue) setError(problema.message)
      })

    return () => {
      sigue = false
    }
  }, [isAdmin])

  if (!isAdmin) return null

  const guardar = async (medio) => {
    setGuardando(medio)

    try {
      const tasa = Number(escritas[medio])

      await configurarTasaDeComision(medio, tasa)
      setTasas((actuales) => ({ ...actuales, [medio]: tasa }))
      setEscritas((actuales) => ({ ...actuales, [medio]: undefined }))

      Swal.fire({ icon: "success", title: "Tasa actualizada", text: "Se aplica a los cobros de ahora en adelante." })
    } catch (problema) {
      Swal.fire({ icon: "error", title: "No se cambió la tasa", text: problema.message })
    } finally {
      setGuardando("")
    }
  }

  return (
    <section className="config-card" aria-labelledby="config-comisiones">
      <div className="config-section">
        <h2 className="config-titulo" id="config-comisiones">Comisión del proveedor de pagos</h2>

        <p className="config-descripcion">
          Estimación interna para los reportes y para conciliar con el proveedor. No se le cobra al
          cliente, no cambia el total de la venta y no aparece en la factura. Una tasa nueva se aplica
          de ahora en adelante.
        </p>

        {error && <p role="alert">{error}</p>}

        {tasas && MEDIOS.map(({ id, etiqueta }) => {
          const escrita = escritas[id] ?? String(tasas[id] ?? "")

          return (
            <div key={id} className="tasas-de-comision-fila">
              <div className="field">
                <label htmlFor={`comision-${id}`}>{etiqueta} (%)</label>

                <input
                  id={`comision-${id}`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={escrita}
                  onChange={(e) => setEscritas((actuales) => ({ ...actuales, [id]: e.target.value }))}
                />
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                disabled={guardando === id || escrita === "" || Number(escrita) === tasas[id]}
                onClick={() => guardar(id)}
              >
                Guardar tasa de {etiqueta}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default TasasDeComision
