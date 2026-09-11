import {
  esVentaDelDia,
  esVentaDelMes,
  fechaDeVenta,
  getSaleBalance,
} from "../../utils/salesUtils"

/*
  Los números del panel.

  Viven aquí y no dentro de la pantalla por dos motivos: se pueden probar
  sin montar nada, y dejan claro de qué dato sale cada cifra. Todas
  trabajan sobre lo que los contextos ya tienen cargado —ventas, productos
  y clientes de la empresa en sesión—, sin consultas nuevas.

  Ninguna inventa valores. Cuando no hay con qué calcular algo, devuelven
  cero o una lista vacía y la pantalla enseña su estado vacío.
*/

const totalDe = (venta) => Number(venta?.total || 0)

const sumarTotales = (ventas) =>
  ventas.reduce((suma, venta) => suma + totalDe(venta), 0)

export function ventasDelDia(sales = [], dia = new Date()) {
  const delDia = sales.filter((venta) => esVentaDelDia(venta, dia))

  return { total: sumarTotales(delDia), cantidad: delDia.length }
}

export function ventasDelMes(sales = [], mes = new Date()) {
  const delMes = sales.filter((venta) => esVentaDelMes(venta, mes))

  return { total: sumarTotales(delMes), cantidad: delMes.length }
}

/*
  Lo que queda por cobrar es el saldo, no el total facturado:
  getSaleBalance ya descuenta los abonos registrados.
*/
export function saldoPorCobrar(sales = []) {
  return sales.reduce((suma, venta) => suma + getSaleBalance(venta), 0)
}

/*
  La variación frente a ayer solo tiene sentido si ayer hubo ventas:
  contra cero el porcentaje no está definido, y enseñar "+∞" o "+100 %"
  seria inventarse una lectura. En ese caso se devuelve null y la tarjeta
  no muestra nada.
*/
export function variacionFrenteAAyer(sales = [], hoy = new Date()) {
  const ayer = new Date(hoy)
  ayer.setDate(ayer.getDate() - 1)

  const deAyer = ventasDelDia(sales, ayer).total

  if (deAyer <= 0) return null

  const deHoy = ventasDelDia(sales, hoy).total

  return ((deHoy - deAyer) / deAyer) * 100
}

const existencia = (producto) => Number(producto?.stock || 0)
const minimo = (producto) => Number(producto?.minStock ?? 5)

/*
  Bajo mínimos es lo que todavía se puede vender pero está por debajo de
  su mínimo. Lo agotado se cuenta aparte porque pide otra reacción:
  reponer ya, no vigilar.
*/
export function productosBajoMinimo(products = []) {
  return products.filter(
    (producto) =>
      existencia(producto) > 0 && existencia(producto) <= minimo(producto)
  )
}

export function productosAgotados(products = []) {
  return products.filter((producto) => existencia(producto) <= 0)
}

/*
  Para la lista: primero lo agotado y después lo que menos margen tiene
  sobre su mínimo, que es el orden en que conviene atenderlo.
*/
export function productosPorAtender(products = [], cuantos = 5) {
  return [...productosAgotados(products), ...productosBajoMinimo(products)]
    .sort((a, b) => existencia(a) - existencia(b))
    .slice(0, cuantos)
}

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]

/*
  Ventas por día de los últimos siete, incluido hoy. Se agrupa por fecha
  local, la misma que usa esVentaDelDia, para que el total del día de hoy
  coincida con el de la tarjeta.
*/
export function ventasPorDia(sales = [], cuantosDias = 7, hoy = new Date()) {
  const dias = []

  for (let atras = cuantosDias - 1; atras >= 0; atras -= 1) {
    const dia = new Date(hoy)
    dia.setDate(dia.getDate() - atras)

    dias.push({
      fecha: dia,
      etiqueta: DIAS_CORTOS[dia.getDay()],
      total: ventasDelDia(sales, dia).total,
    })
  }

  return dias
}

export function hayVentasEn(dias = []) {
  return dias.some((dia) => dia.total > 0)
}

/*
  Lo más vendido sale del detalle que cada venta ya trae consigo. Se
  agrupa por nombre y no por identificador porque el renglón guarda el
  nombre con el que se vendió, y un producto renombrado seguiría contando
  como el mismo en su momento.
*/
export function productosMasVendidos(sales = [], cuantos = 5) {
  const acumulado = new Map()

  sales.forEach((venta) => {
    const renglones = venta?.items || venta?.products || []

    renglones.forEach((renglon) => {
      const nombre = renglon?.name || renglon?.productName || "Producto"
      const unidades = Number(renglon?.qty ?? renglon?.quantity ?? 0)
      const importe = Number(
        renglon?.subtotal ??
          Number(renglon?.price || 0) * (unidades || 0)
      )

      const previo = acumulado.get(nombre) || { nombre, unidades: 0, total: 0 }

      acumulado.set(nombre, {
        nombre,
        unidades: previo.unidades + unidades,
        total: previo.total + importe,
      })
    })
  })

  return [...acumulado.values()]
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, cuantos)
}

export function ventasRecientes(sales = [], cuantas = 5) {
  return [...sales]
    .sort((a, b) => {
      const fechaA = fechaDeVenta(a)
      const fechaB = fechaDeVenta(b)

      return (fechaB?.getTime() || 0) - (fechaA?.getTime() || 0)
    })
    .slice(0, cuantas)
}
