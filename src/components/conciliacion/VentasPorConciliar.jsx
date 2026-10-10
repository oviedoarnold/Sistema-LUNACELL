import { useCallback, useEffect, useMemo, useState } from "react"
import { FaBalanceScale } from "react-icons/fa"

import EmptyState from "../crud/EmptyState"
import StatusBadge from "../crud/StatusBadge"
import { formatMoney } from "../../utils/format"
import { traerVentasPorConciliar } from "../../lib/api/conciliacion"
import { motivoDeConciliacion } from "../../lib/sinConexion/textos"
import DetalleDeConciliacion from "./DetalleDeConciliacion"

/*
  Las ventas sin conexión que el servidor no pudo aplicar solo: precio
  distinto, existencia insuficiente, ubicación cambiada, rescates… Ya se
  cobraron y se entregaron; aquí se decide cómo quedan en los libros.
*/
const VARIANTE = { pendiente: "low", aplicada: "ok", anulada: "neutral" }
const ESTADO = { pendiente: "Pendiente", aplicada: "Aplicada", anulada: "Anulada" }

function VentasPorConciliar({ nombreDelVendedor, nombreDeUbicacion, traer = traerVentasPorConciliar }) {
  const [carga, setCarga] = useState({ lista: [], error: "", cargada: false })
  const [vuelta, setVuelta] = useState(0)
  const [filtro, setFiltro] = useState("pendiente")
  const [abierta, setAbierta] = useState(null)

  const recargar = useCallback(() => setVuelta((n) => n + 1), [])

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

  const visibles = useMemo(
    () => (filtro ? carga.lista.filter((v) => v.estado === filtro) : carga.lista),
    [carga.lista, filtro]
  )

  return (
    <section aria-labelledby="conciliacion-titulo-lista">
      <h2 id="conciliacion-titulo-lista" className="solo-lector">
        Ventas por conciliar
      </h2>

      <div className="toolbar">
        <label htmlFor="conciliacion-filtro">
          Mostrar{" "}
          <select id="conciliacion-filtro" className="filter-select" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="pendiente">Pendientes</option>
            <option value="aplicada">Aplicadas</option>
            <option value="anulada">Anuladas</option>
            <option value="">Todas</option>
          </select>
        </label>

        <button type="button" className="btn btn-secondary" onClick={recargar}>
          Actualizar
        </button>
      </div>

      {carga.error && (
        <div className="alert-banner" role="alert">
          <span>{carga.error}</span>
        </div>
      )}

      {!carga.cargada && <p role="status">Cargando ventas por conciliar…</p>}

      {carga.cargada && !carga.error && visibles.length === 0 && (
        <EmptyState Icono={FaBalanceScale} titulo="No hay ventas en esta lista" descripcion="Las ventas sin conexión que requieran revisión aparecerán aquí." />
      )}

      {visibles.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Recibida</th>
                <th scope="col">Comprobante</th>
                <th scope="col">Vendedor</th>
                <th scope="col">Ubicación</th>
                <th scope="col" className="r">
                  Total cobrado
                </th>
                <th scope="col">Motivo</th>
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="solo-lector">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((venta) => (
                <tr key={venta.id}>
                  <td>{new Date(venta.recibidaEn).toLocaleString("es-HN")}</td>
                  <td>{venta.numeroProvisional}</td>
                  <td>{nombreDelVendedor(venta.usuarioId)}</td>
                  <td>{nombreDeUbicacion(venta.ubicacionId)}</td>
                  <td className="r">{formatMoney(venta.totalCobrado)}</td>
                  <td>{motivoDeConciliacion(venta.motivo)}</td>
                  <td>
                    <StatusBadge variante={VARIANTE[venta.estado] || "neutral"}>{ESTADO[venta.estado] || venta.estado}</StatusBadge>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setAbierta(venta)}
                      aria-label={`Revisar ${venta.numeroProvisional}`}
                    >
                      Revisar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierta && (
        <DetalleDeConciliacion
          venta={abierta}
          nombreDelVendedor={nombreDelVendedor(abierta.usuarioId)}
          nombreDeUbicacion={nombreDeUbicacion(abierta.ubicacionId)}
          onCerrar={() => setAbierta(null)}
          onResuelta={recargar}
        />
      )}
    </section>
  )
}

export default VentasPorConciliar
