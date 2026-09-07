import { useCallback, useContext, useEffect, useMemo, useState } from "react"

import { ProductContext, SalesContext } from "./contexts"
import { useAuth } from "../hooks/useAuth"

import {
  traerVentas,
  conFormaDeApp,
  crearVenta,
  crearAbono,
  eliminarAbono,
  ajustarEstadoPorSaldo,
} from "../lib/api/ventas"

import {
  roundMoney,
  isCreditSale,
  getSalePayments,
  getSaleBalance,
  applyPayments,
} from "../utils/salesUtils"

const ISV_POR_OMISION = 15

function SalesProvider({ children }) {
  const { user } = useAuth()

  const {
    products,
    company,
    refrescarProductos,
  } = useContext(ProductContext)

  const [filas, setFilas] = useState([])
  const [empresaCargada, setEmpresaCargada] = useState(null)
  const [error, setError] = useState("")

  const empresaId = user?.empresa_id
  const usuarioId = user?.id

  const cargando = Boolean(empresaId) && empresaCargada !== empresaId

  useEffect(() => {
    if (!empresaId) {
      return
    }

    let vigente = true

    traerVentas()
      .then((lista) => {
        if (!vigente) return

        setFilas(lista)
        setError("")
      })
      .catch((problema) => {
        if (vigente) setError(problema.message)
      })
      .finally(() => {
        if (vigente) setEmpresaCargada(empresaId)
      })

    return () => {
      vigente = false
    }
  }, [empresaId])

  /*
    Los datos de la ferretería son encabezado de la factura impresa, no
    parte de la venta. Aplicarlos aquí evita recargar el historial entero
    cada vez que cambian, que era donde se perdía una venta recién hecha.
  */
  const sales = useMemo(
    () => conFormaDeApp(filas, company),
    [filas, company]
  )

  const refrescarVentas = useCallback(async () => {
    setFilas(await traerVentas())
  }, [])

  const buscarProducto = useCallback(
    (id) => products.find((p) => String(p.id) === String(id)),
    [products]
  )

  const validarRenglones = useCallback(
    (items = []) => {
      if (!Array.isArray(items)) {
        throw new Error("Los productos de la venta no son válidos.")
      }

      if (items.length === 0) {
        throw new Error("La venta debe contener al menos un producto.")
      }

      items.forEach((item) => {
        const productId = item.productId ?? item.id
        const cantidad = Number(item.qty ?? item.quantity ?? 0)

        if (!productId) {
          throw new Error("Uno de los productos no tiene identificador.")
        }

        if (!Number.isFinite(cantidad) || cantidad <= 0) {
          throw new Error(
            "La cantidad de los productos debe ser mayor que cero."
          )
        }

        const producto = buscarProducto(productId)

        if (!producto) {
          throw new Error("Uno de los productos ya no existe en el inventario.")
        }

        if (cantidad > Number(producto.stock || 0)) {
          throw new Error(
            `Stock insuficiente de ${producto.name}. Solo hay ${producto.stock} unidades disponibles.`
          )
        }
      })
    },
    [buscarProducto]
  )

  const armarRenglones = useCallback(
    (items = []) =>
      items.map((item) => {
        const productId = item.productId ?? item.id
        const producto = buscarProducto(productId)
        const cantidad = Number(item.qty ?? item.quantity ?? 1)
        const precio = Number(item.price ?? producto?.price ?? 0)

        return {
          productId,
          id: productId,
          code: producto?.code || "",
          name: producto?.name || item.name || "Producto",
          category: producto?.category || item.category || "",
          qty: cantidad,
          quantity: cantidad,
          price: precio,
          subtotal: roundMoney(precio * cantidad),
        }
      }),
    [buscarProducto]
  )

  const calcularTotales = useCallback(
    (renglones) => {
      const subtotal = roundMoney(
        renglones.reduce((suma, item) => suma + item.subtotal, 0)
      )

      const taxRate = Number(company?.taxRate ?? ISV_POR_OMISION)
      const tax = roundMoney(subtotal * (taxRate / 100))

      return { subtotal, tax, taxRate, total: roundMoney(subtotal + tax) }
    },
    [company]
  )

  /*
    El número de factura, el estado y la descarga de inventario los decide
    la base. La pantalla solo manda lo que el cajero eligió.
  */
  const addSale = useCallback(
    async (venta, clave = null) => {
      if (!venta) {
        throw new Error("No se recibieron datos de la venta.")
      }

      validarRenglones(venta.items)

      const renglones = armarRenglones(venta.items)
      const totales = calcularTotales(renglones)
      const formaPago = venta.paymentType || venta.type || "contado"

      if (formaPago === "credito" && !venta.clientId) {
        throw new Error(
          "Para una venta a crédito debes seleccionar un cliente registrado."
        )
      }

      const nombreCliente =
        venta.customerName || venta.customer || "Consumidor Final"

      const ventaId = await crearVenta(
        {
          ...venta,
          ...totales,
          items: renglones,
          paymentType: formaPago,
          customerName: nombreCliente,
        },
        { empresaId, usuarioId, empresa: company, clave }
      )

      const [listaVentas] = await Promise.all([
        traerVentas(),
        refrescarProductos(),
      ])

      setFilas(listaVentas)

      return conFormaDeApp(listaVentas, company).find((v) => v.id === ventaId)
    },
    [
      validarRenglones,
      armarRenglones,
      calcularTotales,
      empresaId,
      usuarioId,
      company,
      refrescarProductos,
    ]
  )

  const buscarVenta = useCallback(
    (id) => sales.find((venta) => String(venta.id) === String(id)),
    [sales]
  )

  /*
    Registra un abono sobre una venta a crédito. Al quedar el saldo en
    cero la factura pasa a pagada.
  */
  const addPayment = useCallback(
    async (saleId, payment = {}, clave = null) => {
      const venta = buscarVenta(saleId)

      if (!venta) {
        throw new Error("La factura no existe.")
      }

      if (!isCreditSale(venta)) {
        throw new Error("Solo las facturas a crédito admiten abonos.")
      }

      const monto = roundMoney(payment.amount)

      if (!Number.isFinite(monto) || monto <= 0) {
        throw new Error("El monto del abono debe ser mayor que cero.")
      }

      const saldo = getSaleBalance(venta)

      if (saldo <= 0) {
        throw new Error("Esta factura ya está cancelada.")
      }

      if (monto > saldo) {
        throw new Error(
          `El abono no puede superar el saldo pendiente de ${saldo.toFixed(2)}.`
        )
      }

      const abono = await crearAbono(
        saleId,
        { ...payment, amount: monto },
        { empresaId, usuarioId, clave }
      )

      const conElAbono = applyPayments(venta, [
        ...getSalePayments(venta),
        abono,
      ])

      await ajustarEstadoPorSaldo(saleId, getSaleBalance(conElAbono))
      await refrescarVentas()

      return abono
    },
    [buscarVenta, empresaId, usuarioId, refrescarVentas]
  )

  /*
    Permite corregir un abono mal registrado; el saldo y el estado se
    recalculan solos.
  */
  const deletePayment = useCallback(
    async (saleId, paymentId) => {
      const venta = buscarVenta(saleId)

      if (!venta) {
        throw new Error("La factura no existe.")
      }

      await eliminarAbono(paymentId)

      const sinElAbono = applyPayments(
        venta,
        getSalePayments(venta).filter(
          (abono) => String(abono.id) !== String(paymentId)
        )
      )

      await ajustarEstadoPorSaldo(saleId, getSaleBalance(sinElAbono))
      await refrescarVentas()
    },
    [buscarVenta, refrescarVentas]
  )

  const getSaleByInvoiceNumber = useCallback(
    (invoiceNumber) =>
      sales.find(
        (venta) => String(venta.invoiceNumber) === String(invoiceNumber)
      ),
    [sales]
  )

  /*
    Las pantallas siguen leyendo counters.invoice; la cuenta ahora la
    lleva la empresa en la base.
  */
  const counters = useMemo(
    () => ({
      invoice: company?.nextInvoice ?? 1,
      quote: company?.nextQuote ?? 1,
    }),
    [company]
  )

  const value = useMemo(
    () => ({
      sales,
      cargando,
      error,

      addSale,
      addPayment,
      deletePayment,

      getSaleById: buscarVenta,
      getSaleByInvoiceNumber,

      refrescarVentas,
      counters,
    }),
    [
      sales,
      cargando,
      error,
      addSale,
      addPayment,
      deletePayment,
      buscarVenta,
      getSaleByInvoiceNumber,
      refrescarVentas,
      counters,
    ]
  )

  return (
    <SalesContext.Provider value={value}>{children}</SalesContext.Provider>
  )
}

export default SalesProvider
