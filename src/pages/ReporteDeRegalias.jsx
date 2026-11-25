import { useContext, useEffect, useState } from "react"
import { FaGift } from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import { LocationsContext } from "../context/contexts"
import { ROLES } from "../context/permissions"
import { useAuth } from "../hooks/useAuth"
import { traerReporteDeRegalias } from "../lib/api/reportes"
import { formatMoney } from "../utils/format"
import { motivoParaLeer } from "../utils/regalias"
import { fechaYHoraEnHonduras, hoyEnHonduras } from "../utils/reporteDiario"

const ESTADO_DE_LA_FACTURA = {
  pagada: "Pagada",
  pendiente: "Pendiente",
  anulada: "Anulada · regalía no restituida",
}

// El mismo día de hace `dias`, como AAAA-MM-DD.
const diasAntes = (dia, dias) => {
  const fecha = new Date(`${dia}T12:00:00Z`)

  fecha.setUTCDate(fecha.getUTCDate() - dias)

  return fecha.toISOString().slice(0, 10)
}

/*
  Reporte de regalías (0054): lo entregado sin cargo, con su factura, su
  cliente, quién lo entregó y por qué. No suma ventas ni cobros: es una salida
  de inventario. Una factura anulada conserva su regalía, que no volvió.

  La base decide qué ve cada quien: el administrador toda la empresa y el
  costo; el contador todas las ubicaciones sin costo; el vendedor con
  «Historial» su ubicación. La columna de costo solo se dibuja si llega.
*/
function ReporteDeRegalias() {
  const { user, isAdmin } = useAuth()
  const { locations = [] } = useContext(LocationsContext) || {}
  const veTodas = isAdmin || user?.role === ROLES.CONTADOR

  const [hoy] = useState(() => hoyEnHonduras())
  const [desde, setDesde] = useState(() => diasAntes(hoy, 30))
  const [hasta, setHasta] = useState(hoy)
  const [ubicacionId, setUbicacionId] = useState("")
  const [estado, setEstado] = useState({ consulta: "", filas: null, error: "" })

  const consulta = `${desde}|${hasta}|${ubicacionId}`

  useEffect(() => {
    if (!desde || !hasta) return undefined

    let vigente = true
    const guardar = (resultado) => vigente && setEstado({ consulta, ...resultado })

    traerReporteDeRegalias(desde, hasta, ubicacionId || null).then(
      (filas) => guardar({ filas, error: "" }),
      (problema) => guardar({ filas: null, error: problema.message })
    )

    return () => {
      vigente = false
    }
  }, [desde, hasta, ubicacionId, consulta])

  const listo = estado.consulta === consulta
  const filas = listo ? estado.filas : null
  const conCosto = Boolean(filas?.some((f) => f.costoUnitario !== null))
  const unidades = (filas || []).reduce((suma, f) => suma + f.cantidad, 0)
  const costo = (filas || []).reduce((suma, f) => suma + (f.costoTotal || 0), 0)

  return (
    <div className="view active crud panel reportes">
      <PageHeader descripcion="Productos entregados sin cargo, con su factura, cliente y motivo. No suman a ventas ni cobros." />

      <div className="toolbar reportes-filtros">
        <div className="field">
          <label htmlFor="regalias-desde">Desde</label>
          <input id="regalias-desde" type="date" value={desde} max={hasta || hoy} onChange={(e) => setDesde(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="regalias-hasta">Hasta</label>
          <input id="regalias-hasta" type="date" value={hasta} min={desde} max={hoy} onChange={(e) => setHasta(e.target.value)} />
        </div>

        {veTodas && (
          <div className="field">
            <label htmlFor="regalias-ubicacion">Ubicación</label>
            <select id="regalias-ubicacion" value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>
              <option value="">Todas</option>
              {locations.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!listo && desde && hasta && <p className="crud-cargando" role="status">Cargando las regalías…</p>}

      {listo && estado.error && (
        <div className="alert-banner" role="alert">
          <strong>{estado.error}</strong>
        </div>
      )}

      {filas?.length === 0 && (
        <EmptyState Icono={FaGift} titulo="Sin regalías" descripcion="No se entregaron regalías en estas fechas." />
      )}

      {filas?.length > 0 && (
        <section className="panel-seccion reportes-seccion" aria-labelledby="regalias-titulo">
          <h2 className="panel-seccion-titulo" id="regalias-titulo">
            {filas.length} {filas.length === 1 ? "regalía" : "regalías"} · {unidades} {unidades === 1 ? "unidad" : "unidades"}
            {conCosto && ` · Costo ${formatMoney(costo)}`}
          </h2>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Fecha y hora</th>
                  <th scope="col">Factura</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Producto</th>
                  <th scope="col">Código</th>
                  <th scope="col" className="num">Cantidad</th>
                  <th scope="col">Ubicación</th>
                  <th scope="col">Entregó</th>
                  <th scope="col">Motivo</th>
                  {conCosto && <th scope="col" className="num">Costo unit.</th>}
                  {conCosto && <th scope="col" className="num">Costo total</th>}
                </tr>
              </thead>

              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td>{fechaYHoraEnHonduras(f.fecha)}</td>
                    <td>{f.factura}</td>
                    <td>{ESTADO_DE_LA_FACTURA[f.estadoFactura] || f.estadoFactura}</td>
                    <td>{f.cliente}</td>
                    <td>{f.producto}</td>
                    <td>{f.codigo || "S/C"}</td>
                    <td className="num">{f.cantidad}</td>
                    <td>{f.ubicacion}</td>
                    <td>{f.usuario}</td>
                    <td>{motivoParaLeer(f.motivo, f.detalleMotivo)}</td>
                    {conCosto && <td className="num">{formatMoney(f.costoUnitario)}</td>}
                    {conCosto && <td className="num">{formatMoney(f.costoTotal)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

export default ReporteDeRegalias
