import { useEffect, useState } from "react"

import { traerAuditoriaRescates } from "../../lib/api/conciliacion"
import { RESULTADOS_DE_RESCATE } from "../../lib/sinConexion/textos"

/*
  Cada intento de rescate queda en auditoria_rescates (0027): quién, cuándo,
  de qué lote y con qué resultado, también los rechazados. Solo se lee: la
  tabla no se puede cambiar ni borrar.
*/
function AuditoriaDeRescates({ traer = traerAuditoriaRescates, vuelta = 0 }) {
  const [carga, setCarga] = useState({ lista: [], error: "", cargada: false })

  useEffect(() => {
    let sigue = true

    traer()
      .then((lista) => {
        if (sigue) setCarga({ lista, error: "", cargada: true })
      })
      .catch((problema) => {
        if (sigue) setCarga({ lista: [], error: problema.message, cargada: true })
      })

    return () => {
      sigue = false
    }
  }, [traer, vuelta])

  return (
    <section aria-labelledby="auditoria-titulo">
      <h2 id="auditoria-titulo" className="pos-titulo">
        Auditoría de rescates
      </h2>

      {carga.error && (
        <div className="alert-banner" role="alert">
          <span>{carga.error}</span>
        </div>
      )}

      {!carga.cargada && <p role="status">Cargando auditoría…</p>}

      {carga.cargada && !carga.error && carga.lista.length === 0 && <p>Todavía no hay rescates.</p>}

      {carga.lista.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Lote</th>
                <th scope="col">Dispositivo</th>
                <th scope="col">Resultado</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {carga.lista.map((fila) => (
                <tr key={fila.id}>
                  <td>{new Date(fila.creadoEn).toLocaleString("es-HN")}</td>
                  <td>{fila.lote || "—"}</td>
                  <td>{fila.dispositivo || "—"}</td>
                  <td>{RESULTADOS_DE_RESCATE[fila.resultado] || fila.resultado}</td>
                  <td>{[fila.codigo, fila.detalle].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default AuditoriaDeRescates
