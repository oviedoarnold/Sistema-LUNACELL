import { useContext, useEffect, useState } from "react"
import { FaBoxOpen, FaGift, FaTag } from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import { LocationsContext } from "../context/contexts"
import { ROLES } from "../context/permissions"
import { useAuth } from "../hooks/useAuth"
import { traerReporteDeRegalias } from "../lib/api/reportes"
import { formatMoney } from "../utils/format"
import { motivoParaLeer, resumenDeRegalias } from "../utils/regalias"
import { fechaYHoraEnHonduras, hoyEnHonduras } from "../utils/reporteDiario"
import StatCard from "./dashboard/StatCard"

const ESTADO_DE_LA_FACTURA = {
  pagada: "Pagada",
  pendiente: "Pendiente",
  anulada: "Anulada · regalía no restituida",
}

const NO_REGISTRADO = "No registrado"

// El mismo día de hace `dias`, como AAAA-MM-DD.
const diasAntes = (dia, dias) => {
  const fecha = new Date(`${dia}T12:00:00Z`)

  fecha.setUTCDate(fecha.getUTCDate() - dias)

  return fecha.toISOString().slice(0, 10)
}

// Un importe, o «No registrado» si no se guardó: un cero se muestra como L 0.00.
const importe = (valor) => (valor === null || valor === undefined ? <span className="reporte-regalias-sin-precio">{NO_REGISTRADO}</span> : formatMoney(valor))

// La nota del valor comercial: sin ISV, o cuántas regalías quedan fuera por no tener precio.
function detalleDelValor({ regalias, sinPrecio }) {
  if (sinPrecio === 0) return "A precio de venta, sin ISV"
  if (sinPrecio === regalias) return "Ninguna regalía del período tiene precio registrado"

  return `No incluye ${sinPrecio} ${sinPrecio === 1 ? "regalía" : "regalías"} sin precio registrado`
}

/*
  Reporte de regalías (0054 y 0055): lo entregado sin cargo, con su factura,
  su cliente, quién lo entregó y por qué, y cuánto vale a precio de venta. No
  suma ventas ni cobros: es una salida de inventario. Una factura anulada
  conserva su regalía, que no volvió.

  La base decide qué ve cada quien: el administrador toda la empresa y el
  costo; el contador todas las ubicaciones sin costo; el vendedor con
  «Historial» su ubicación. La columna de costo solo se dibuja si llega.

  El valor comercial es precio de venta (sin ISV) × cantidad, con el precio
  guardado al entregar. Una regalía anterior a la 0055 no tiene precio: se
  muestra «No registrado» y queda fuera del valor, nunca como L 0.00.
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
  const resumen = resumenDeRegalias(filas || [])
  const valorTotal = resumen.valorComercial === null ? NO_REGISTRADO : formatMoney(resumen.valorComercial)

  return (
    <div className="view active crud panel reportes reporte-regalias">
      <header className="crud-encabezado">
        <div>
          <h2 className="reporte-regalias-titulo">Reporte de regalías</h2>
          <p className="crud-descripcion">Detalle de productos entregados como regalía.</p>
        </div>
      </header>

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
        <>
          <section className="panel-kpis" aria-label="Resumen de las regalías">
            <StatCard etiqueta="Regalías" valor={resumen.regalias} Icono={FaGift} tono="blue" />
            <StatCard etiqueta="Unidades entregadas" valor={resumen.unidades} Icono={FaBoxOpen} />
            <StatCard etiqueta="Valor comercial total" valor={valorTotal} detalle={detalleDelValor(resumen)} Icono={FaTag} tono="ok" />
          </section>

          <section className="panel-seccion reportes-seccion" aria-label="Detalle de las regalías">
            <div className="table-wrap">
              <table className="tabla-adaptable">
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
                    {conCosto && <th scope="col" className="num">Costo unitario</th>}
                    <th scope="col" className="num">Precio de venta unitario</th>
                    <th scope="col" className="num">Valor comercial</th>
                  </tr>
                </thead>

                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id}>
                      <td data-etiqueta="Fecha y hora">{fechaYHoraEnHonduras(f.fecha)}</td>
                      <td data-etiqueta="Factura">{f.factura}</td>
                      <td data-etiqueta="Estado">{ESTADO_DE_LA_FACTURA[f.estadoFactura] || f.estadoFactura}</td>
                      <td data-etiqueta="Cliente">{f.cliente}</td>
                      <td data-etiqueta="Producto">{f.producto}</td>
                      <td data-etiqueta="Código">{f.codigo || "S/C"}</td>
                      <td data-etiqueta="Cantidad" className="num">{f.cantidad}</td>
                      <td data-etiqueta="Ubicación">{f.ubicacion}</td>
                      <td data-etiqueta="Entregó">{f.usuario}</td>
                      <td data-etiqueta="Motivo">{motivoParaLeer(f.motivo, f.detalleMotivo)}</td>
                      {conCosto && <td data-etiqueta="Costo unitario" className="num">{formatMoney(f.costoUnitario)}</td>}
                      <td data-etiqueta="Precio de venta unitario" className="num">{importe(f.precioUnitario)}</td>
                      <td data-etiqueta="Valor comercial" className="num">{importe(f.valorComercial)}</td>
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr>
                    <th scope="row" colSpan={6}>Totales</th>
                    <td className="num">{resumen.unidades}</td>
                    <td colSpan={conCosto ? 5 : 4} />
                    <td className="num">{valorTotal}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default ReporteDeRegalias
