import { useContext, useEffect, useState } from "react"
import { FaFileCsv, FaFilePdf, FaLock } from "react-icons/fa"
import Swal from "sweetalert2"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import { LocationsContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"
import { traerReporteDiario } from "../lib/api/reportes"
import StatCard from "./dashboard/StatCard"
import {
  celdaParaLeer,
  hoyEnHonduras,
  indicadoresDelReporte,
  nombreDelArchivo,
  reporteEnCsv,
  seccionesDelReporte,
} from "../utils/reporteDiario"

const TODAS = ""

function descargar(contenido, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const enlace = document.createElement("a")

  enlace.href = url
  enlace.download = nombre
  enlace.click()
  URL.revokeObjectURL(url)
}

function TablaDelReporte({ seccion, moneda }) {
  const idTitulo = `reporte-${seccion.id}`

  return (
    <section className="panel-seccion reportes-seccion" aria-labelledby={idTitulo}>
      <h2 className="panel-seccion-titulo" id={idTitulo}>{seccion.titulo}</h2>

      {seccion.filas.length === 0 ? (
        <p className="reportes-vacio">{seccion.vacio}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {seccion.columnas.map((columna) => (
                  <th key={columna.titulo} scope="col" className={columna.tipo === "texto" ? undefined : "num"}>
                    {columna.titulo}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {seccion.filas.map((fila) => (
                <tr key={fila.clave}>
                  {fila.celdas.map((valor, i) => (
                    <td key={seccion.columnas[i].titulo} className={seccion.columnas[i].tipo === "texto" ? undefined : "num"}>
                      {celdaParaLeer(valor, seccion.columnas[i].tipo, moneda)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/*
  Reporte diario de ventas y movimientos.

  Solo para administradores: reporte_diario() lo exige en la base, y aquí se
  dice antes de preguntarle. Esta pantalla no calcula ningún importe.
*/
function Reports() {
  const { isAdmin } = useAuth()
  const { locations = [] } = useContext(LocationsContext) || {}

  const [hoy] = useState(() => hoyEnHonduras())
  const [dia, setDia] = useState(hoy)
  const [ubicacionId, setUbicacionId] = useState(TODAS)
  const [vuelta, setVuelta] = useState(0)

  /*
    Lo cargado se guarda con la consulta que lo pidió: al cambiar un filtro,
    lo anterior deja de valer en ese mismo render y no se ven las cifras de
    otro día bajo el filtro nuevo.
  */
  const consulta = `${dia}|${ubicacionId}|${vuelta}`
  const [cargado, setCargado] = useState(null)
  const vigente = cargado?.consulta === consulta ? cargado : null

  useEffect(() => {
    if (!isAdmin || !dia) return

    let sigue = true

    traerReporteDiario(dia, ubicacionId || null)
      .then((reporte) => {
        if (sigue) setCargado({ consulta, reporte, error: "" })
      })
      .catch((problema) => {
        if (sigue) setCargado({ consulta, reporte: null, error: problema.message })
      })

    return () => {
      sigue = false
    }
  }, [isAdmin, dia, ubicacionId, consulta])

  if (!isAdmin) {
    return (
      <div className="view active crud">
        <PageHeader descripcion="Ventas, cobros y movimientos del día por ubicación." />
        <EmptyState
          Icono={FaLock}
          titulo="Solo para administradores"
          descripcion="El reporte diario solo lo puede consultar un administrador."
        />
      </div>
    )
  }

  const reporte = vigente?.reporte
  const nombreDeUbicacion = locations.find((u) => u.id === ubicacionId)?.name || "Todas"

  const exportarCsv = () => {
    descargar(reporteEnCsv(reporte, nombreDeUbicacion), nombreDelArchivo(reporte, "csv"), "text/csv;charset=utf-8")
  }

  const exportarPdf = async () => {
    try {
      const { reporteEnPdf } = await import("../utils/reporteDiarioPdf")

      reporteEnPdf(reporte, nombreDeUbicacion).save(nombreDelArchivo(reporte, "pdf"))
    } catch (problema) {
      console.error("No se pudo generar el PDF:", problema)
      Swal.fire({ icon: "error", title: "No se pudo generar el PDF" })
    }
  }

  return (
    <div className="view active crud panel reportes">
      <PageHeader descripcion="Ventas, cobros y movimientos del día por ubicación, en hora de Honduras.">
        <button type="button" className="btn btn-secondary" onClick={exportarCsv} disabled={!reporte}>
          <FaFileCsv aria-hidden="true" />CSV
        </button>
        <button type="button" className="btn btn-secondary" onClick={exportarPdf} disabled={!reporte}>
          <FaFilePdf aria-hidden="true" />PDF
        </button>
      </PageHeader>

      <div className="toolbar reportes-filtros">
        <div className="field">
          <label htmlFor="reportes-dia">Día</label>
          <input id="reportes-dia" type="date" value={dia} max={hoy} onChange={(e) => setDia(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="reportes-ubicacion">Ubicación</label>
          <select id="reportes-ubicacion" value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>
            <option value={TODAS}>Todas</option>
            {locations.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      {!dia && <p className="reportes-vacio">Elige un día.</p>}

      {dia && !vigente && <p className="crud-cargando" role="status">Cargando el reporte…</p>}

      {vigente?.error && (
        <div className="alert-banner" role="alert">
          <div>
            <strong>{vigente.error}</strong>
            <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setVuelta((n) => n + 1)}>Reintentar</button></div>
          </div>
        </div>
      )}

      {reporte && (
        <>
          <section className="panel-kpis reportes-indicadores" aria-label="Indicadores del día">
            {indicadoresDelReporte(reporte).map((i) => (
              <StatCard key={i.id} etiqueta={i.etiqueta} valor={celdaParaLeer(i.valor, i.tipo, reporte.moneda)} detalle={i.detalle} />
            ))}
          </section>

          {reporte.indicadores.por_conciliar > 0 && (
            <p className="reportes-aviso" role="status">
              Hay {reporte.indicadores.por_conciliar} {reporte.indicadores.por_conciliar === 1 ? "venta" : "ventas"} de este día por conciliar, que no se incluyen en estas cifras.
            </p>
          )}

          {seccionesDelReporte(reporte).map((seccion) => (
            <TablaDelReporte key={seccion.id} seccion={seccion} moneda={reporte.moneda} />
          ))}
        </>
      )}
    </div>
  )
}

export default Reports
