import { useContext, useMemo } from "react"
import { ProductContext } from "../context/contexts"
import { SalesContext } from "../context/contexts"
import { esVentaDelDia, esVentaDelMes, getSaleBalance } from "../utils/salesUtils"
import { formatMoney as money } from "../utils/format"
import { ClientsContext } from "../context/contexts"


function Dashboard() {
  const { products = [] } = useContext(ProductContext)
  const { sales = [] } = useContext(SalesContext)
  const { clients = [] } = useContext(ClientsContext)

  const stats = useMemo(() => {
    const sumarTotales = (ventas) => ventas.reduce((a, s) => a + Number(s.total || 0), 0)
    const todaySales = sumarTotales(sales.filter((s) => esVentaDelDia(s)))
    const monthSales = sumarTotales(sales.filter((s) => esVentaDelMes(s)))
    const low = products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.minStock ?? 5)).length
    const out = products.filter((p) => Number(p.stock) <= 0).length
    // Descuenta los abonos: lo pendiente es el saldo, no el total facturado.
    const receivable = sales.reduce((a, s) => a + getSaleBalance(s), 0)
    return { todaySales, monthSales, low, out, receivable }
  }, [products, sales])

  const topProducts = useMemo(() => {
    const map = new Map()
    sales.forEach((s) => (s.items || s.products || []).forEach((i) => {
      const name = i.name || i.productName || "Producto"
      const qty = Number(i.qty ?? i.quantity ?? 1)
      map.set(name, (map.get(name) || 0) + qty)
    }))
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [sales])

  const recentSales = [...sales].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)).slice(0, 5)

  return <div className="view active">
    <div className="view-header"><div><h2>Dashboard</h2><p className="sub">{new Date().toLocaleDateString("es-HN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p></div></div>
    <div className="dash-grid dash-grid-wide">
      <div className="stat-card orange"><div className="icon">🧾</div><div className="label">Ventas hoy</div><div className="value">{money(stats.todaySales)}</div><div className="sub-val">Total del día</div></div>
      <div className="stat-card blue"><div className="icon">🛒</div><div className="label">Ventas del mes</div><div className="value">{money(stats.monthSales)}</div><div className="sub-val">Mes actual</div></div>
      <div className="stat-card warn"><div className="icon">⚠</div><div className="label">Stock bajo</div><div className="value">{stats.low}</div><div className="sub-val">productos</div></div>
      <div className="stat-card danger"><div className="icon">⚠</div><div className="label">Agotados</div><div className="value">{stats.out}</div><div className="sub-val">productos</div></div>
      <div className="stat-card warn"><div className="icon">💳</div><div className="label">Por cobrar</div><div className="value">{money(stats.receivable)}</div><div className="sub-val">ventas a crédito</div></div>
      <div className="stat-card ok"><div className="icon">✓</div><div className="label">Productos</div><div className="value">{products.length}</div><div className="sub-val">{clients.length} clientes</div></div>
    </div>

    <div className="dash-row">
      <div className="chart-wrap"><div className="chart-title">Ventas por mes</div><div className="bar-chart">{Array.from({ length: 6 }, (_, idx) => {
        const d = new Date(); d.setMonth(d.getMonth() - (5 - idx));
        const total = sales.filter((s) => { const sd = new Date(s.timestamp || s.date); return !Number.isNaN(sd.getTime()) && sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear() }).reduce((a, s) => a + Number(s.total || 0), 0)
        const max = Math.max(1, ...sales.map((s) => Number(s.total || 0)))
        return <div className="bar-col" key={idx}><div className="bar-val">{total ? money(total) : "—"}</div><div className="bar" style={{ height: `${Math.max(4, Math.min(100, (total / max) * 100))}%` }}></div><div className="bar-label">{d.toLocaleDateString("es-HN", { month: "short" })}</div></div>
      })}</div></div>
      <div className="chart-wrap"><div className="chart-title">Top productos vendidos</div><div className="dash-mini-list">{topProducts.length ? topProducts.map(([name, qty]) => <div className="dash-mini-row" key={name}><span className="name">{name}</span><span className="val">{qty} u.</span></div>) : <div className="empty-state">Sin ventas todavía</div>}</div></div>
    </div>

    <div className="dash-bottom">
      <div className="chart-wrap"><div className="chart-title">Últimas ventas</div><div className="dash-mini-list">{recentSales.length ? recentSales.map((s) => <div className="dash-mini-row" key={s.id}><span className="name">{s.customer || s.clientName || "Consumidor Final"}</span><span className="val">{money(s.total)}</span></div>) : <div className="empty-state">Sin ventas todavía</div>}</div></div>
      <div className="chart-wrap"><div className="chart-title">Clientes</div><div className="dash-mini-list">{clients.slice(0, 5).map((c) => <div className="dash-mini-row" key={c.id}><span className="name">{c.name}</span><span className="val">{c.phone || "—"}</span></div>)}{!clients.length && <div className="empty-state">Sin clientes registrados</div>}</div></div>
    </div>
  </div>
}

export default Dashboard
