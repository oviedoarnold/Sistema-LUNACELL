import { useContext, useMemo } from "react"
import {
  FaArrowDown,
  FaArrowUp,
  FaBoxOpen,
  FaCalendarAlt,
  FaCreditCard,
  FaExclamationTriangle,
  FaReceipt,
} from "react-icons/fa"

import {
  ClientsContext,
  ProductContext,
  SalesContext,
} from "../context/contexts"

import { formatMoney as money, todayForDisplay } from "../utils/format"
import StatCard from "./dashboard/StatCard"

import {
  hayVentasEn,
  productosAgotados,
  productosBajoMinimo,
  productosMasVendidos,
  productosPorAtender,
  saldoPorCobrar,
  variacionFrenteAAyer,
  ventasDelDia,
  ventasDelMes,
  ventasPorDia,
  ventasRecientes,
} from "./dashboard/metricas"

/*
  Panel de LUNACELL.

  Todo lo que se ve sale de lo que los contextos ya tienen cargado: las
  ventas de la empresa en sesión, su catálogo y sus clientes. No hay
  consultas nuevas, ni vistas, ni cifras de ejemplo. Cuando una sección no
  tiene datos, enseña su estado vacío en lugar de dibujar algo.

  El título de la página lo pone la barra superior, así que aquí no se
  repite: solo queda una entradilla con la fecha.
*/
function Dashboard() {
  const { products = [], cargando: cargandoProductos } =
    useContext(ProductContext)

  const { sales = [], cargando: cargandoVentas } = useContext(SalesContext)
  const { clients = [] } = useContext(ClientsContext)

  /*
    Un solo recorrido por conjunto de datos. Se recalcula cuando cambian
    las ventas o el catálogo, no en cada pintado.
  */
  const deVentas = useMemo(
    () => ({
      hoy: ventasDelDia(sales),
      mes: ventasDelMes(sales),
      porCobrar: saldoPorCobrar(sales),
      variacion: variacionFrenteAAyer(sales),
      porDia: ventasPorDia(sales),
      masVendidos: productosMasVendidos(sales),
      recientes: ventasRecientes(sales),
    }),
    [sales]
  )

  const deInventario = useMemo(
    () => ({
      bajoMinimo: productosBajoMinimo(products).length,
      agotados: productosAgotados(products).length,
      porAtender: productosPorAtender(products),
    }),
    [products]
  )

  const cargando = cargandoVentas || cargandoProductos
  const conVentas = hayVentasEn(deVentas.porDia)
  const maximoDelPeriodo = Math.max(1, ...deVentas.porDia.map((d) => d.total))
  const requierenAtencion = deInventario.bajoMinimo + deInventario.agotados

  return (
    <div className="panel">
      <p className="panel-entradilla">
        Resumen general · <span>{todayForDisplay()}</span>
      </p>

      {cargando && (
        <p className="panel-cargando" role="status">
          Cargando información…
        </p>
      )}

      {requierenAtencion > 0 && (
        <div className="alert-banner" role="status">
          <FaExclamationTriangle aria-hidden="true" />

          <div>
            <strong>
              {requierenAtencion}{" "}
              {requierenAtencion === 1 ? "producto" : "productos"} requieren
              atención
            </strong>
            Revisa las existencias antes de que falten en una venta.
          </div>
        </div>
      )}

      <section className="panel-kpis" aria-label="Indicadores principales">
        <StatCard
          etiqueta="Ventas hoy"
          valor={money(deVentas.hoy.total)}
          Icono={FaReceipt}
          tono="orange"
          detalle={
            deVentas.hoy.cantidad === 1
              ? "1 venta registrada"
              : `${deVentas.hoy.cantidad} ventas registradas`
          }
        >
          {/*
            Una flecha sobre un 0,0 % se lee como subida y no lo es. Por
            debajo de una decima la diferencia se cuenta como igual.
          */}
          {deVentas.variacion !== null &&
            (Math.abs(deVentas.variacion) < 0.05 ? (
              <p className="panel-variacion igual">Igual que ayer</p>
            ) : (
              <p
                className={
                  deVentas.variacion > 0
                    ? "panel-variacion sube"
                    : "panel-variacion baja"
                }
              >
                {deVentas.variacion > 0 ? (
                  <FaArrowUp aria-hidden="true" />
                ) : (
                  <FaArrowDown aria-hidden="true" />
                )}
                {`${Math.abs(deVentas.variacion).toFixed(1)} % frente a ayer`}
              </p>
            ))}
        </StatCard>

        <StatCard
          etiqueta="Ventas del mes"
          valor={money(deVentas.mes.total)}
          Icono={FaCalendarAlt}
          tono="blue"
          detalle={
            deVentas.mes.cantidad === 1
              ? "1 factura emitida"
              : `${deVentas.mes.cantidad} facturas emitidas`
          }
        />

        <StatCard
          etiqueta="Por cobrar"
          valor={money(deVentas.porCobrar)}
          Icono={FaCreditCard}
          tono="warn"
          detalle="Saldo de ventas a crédito"
        />

        <StatCard
          etiqueta="Productos"
          valor={products.length}
          Icono={FaBoxOpen}
          tono="ok"
          detalle={
            clients.length === 1 ? "1 cliente" : `${clients.length} clientes`
          }
        />
      </section>

      <div className="panel-fila">
        <section className="panel-seccion" aria-labelledby="panel-ventas-7d">
          <h2 className="panel-seccion-titulo" id="panel-ventas-7d">
            Ventas de los últimos 7 días
          </h2>

          {conVentas ? (
            /*
              El gráfico es una ayuda visual, no la única forma de leer el
              dato: cada barra lleva su importe escrito encima.
            */
            <div className="panel-barras">
              {deVentas.porDia.map((dia) => (
                <div className="panel-barra-col" key={dia.fecha.toISOString()}>
                  <span className="panel-barra-valor">
                    {dia.total > 0 ? money(dia.total) : "—"}
                  </span>

                  <div
                    className="panel-barra"
                    style={{
                      height: `${Math.max(
                        3,
                        (dia.total / maximoDelPeriodo) * 100
                      )}%`,
                    }}
                  />

                  <span className="panel-barra-dia">{dia.etiqueta}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>Sin ventas todavía</strong>
              No hay ventas registradas en este período.
            </div>
          )}
        </section>

        <section className="panel-seccion" aria-labelledby="panel-inventario">
          <h2 className="panel-seccion-titulo" id="panel-inventario">
            Inventario
          </h2>

          <div className="panel-kpis-mini">
            <StatCard
              etiqueta="Stock bajo"
              valor={deInventario.bajoMinimo}
              tono="warn"
              detalle="Por debajo del mínimo"
            />

            <StatCard
              etiqueta="Agotados"
              valor={deInventario.agotados}
              tono="danger"
              detalle="Sin existencias"
            />
          </div>

          {deInventario.porAtender.length > 0 ? (
            <div className="panel-tabla-wrap">
              <table className="panel-tabla">
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col" className="num">
                      Stock
                    </th>
                    <th scope="col" className="num">
                      Mínimo
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {deInventario.porAtender.map((producto) => (
                    <tr key={producto.id}>
                      <td>{producto.name}</td>
                      <td className="num">
                        <span
                          className={
                            Number(producto.stock) <= 0
                              ? "badge badge-out"
                              : "badge badge-low"
                          }
                        >
                          {Number(producto.stock) <= 0
                            ? "Agotado"
                            : `${producto.stock} u.`}
                        </span>
                      </td>
                      <td className="num">{producto.minStock ?? 5}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <strong>Todo en orden</strong>
              Ningún producto está por debajo de su mínimo.
            </div>
          )}
        </section>
      </div>

      <div className="panel-fila">
        <section className="panel-seccion" aria-labelledby="panel-mas-vendidos">
          <h2 className="panel-seccion-titulo" id="panel-mas-vendidos">
            Top productos vendidos
          </h2>

          {deVentas.masVendidos.length > 0 ? (
            <div className="panel-tabla-wrap">
              <table className="panel-tabla">
                <thead>
                  <tr>
                    <th scope="col">Producto</th>
                    <th scope="col" className="num">
                      Unidades
                    </th>
                    <th scope="col" className="num">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {deVentas.masVendidos.map((producto) => (
                    <tr key={producto.nombre}>
                      <td>{producto.nombre}</td>
                      <td className="num">{producto.unidades}</td>
                      <td className="num">{money(producto.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <strong>Sin ventas todavía</strong>
              Aquí aparecerá lo que más se venda.
            </div>
          )}
        </section>

        <section className="panel-seccion" aria-labelledby="panel-recientes">
          <h2 className="panel-seccion-titulo" id="panel-recientes">
            Ventas recientes
          </h2>

          {deVentas.recientes.length > 0 ? (
            <ul className="panel-lista">
              {deVentas.recientes.map((venta) => (
                <li className="panel-lista-fila" key={venta.id}>
                  <span className="panel-lista-nombre">
                    {venta.customer ||
                      venta.clientName ||
                      "Consumidor Final"}
                    <small>{venta.invoiceNumber || venta.date}</small>
                  </span>

                  <span className="panel-lista-valor">
                    {money(venta.total)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <strong>Sin ventas todavía</strong>
              Las últimas facturas aparecerán aquí.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default Dashboard
