import { useMemo, useState } from "react"
import Swal from "sweetalert2"

import {
  EXCEDE_EXISTENCIAS,
  addProductToCart,
  buildStockWarningMessage,
  findCartLine,
  getAvailableToAdd,
  getQuantityInCart,
  hasEnoughStock,
  normalizeRequestedQuantity,
  removeProductFromCart,
  setCartLineQuantity,
  validateRequestedQuantity,
} from "../utils/cart"

import { existenciaEnCatalogo } from "../utils/existencias"

/*
  Carrito compartido por el punto de venta y las cotizaciones.

  Las dos pantallas resolvían esto con el mismo código escrito dos veces, y
  una de las dos copias se había desviado: las cotizaciones llamaban a sus
  propios manejadores con `item.productId`, un campo que una línea de
  carrito no tiene —lleva `id`—, así que el paso de cantidad y la papelera
  no hacían nada. Nadie lo notó porque ninguna prueba los tocaba.

  Ese es el argumento del refactor: no ahorrar líneas, sino que no haya dos
  versiones de la misma regla para que uno se equivoque a solas.

  Los avisos de existencias viven aquí y no en la pantalla porque los dos
  diálogos eran idénticos hasta la palabra. Sacarlos obligaría a repetirlos.

  Lo que NO entra: los totales. El punto de venta siempre cobra ISV y una
  cotización puede emitirse sin él, así que cada pantalla calcula los suyos.

  `existenciaDe` dice cuánto hay de un producto. Por omisión lo pregunta al
  catálogo, que es el único número que existe hoy. Es el punto por donde
  entrará la ubicación activa: el hook nunca lee `producto.stock`, así que
  cambiar de dónde sale la existencia no toca ninguna de estas reglas.
*/
export function useCarrito({
  productos = [],
  lineasIniciales = [],
  existenciaDe = existenciaEnCatalogo,
} = {}) {
  const [lineas, setLineas] = useState(lineasIniciales)

  /*
    Cuántas unidades pide el usuario de cada producto antes de agregarlo.
    Vive junto al carrito porque se reinicia al agregar.
  */
  const [cantidadPedida, setCantidadPedida] = useState({})

  const avisarDeExistencias = (producto, validacion) =>
    Swal.fire({
      icon: "warning",
      title: "Stock insuficiente",
      text: buildStockWarningMessage(producto.name, validacion),
    })

  const cantidadEnCarrito = (productoId) =>
    getQuantityInCart(lineas, productoId)

  const agregar = (producto, cantidadSolicitada) => {
    const cantidad = normalizeRequestedQuantity(cantidadSolicitada)

    const validacion = validateRequestedQuantity({
      requestedQuantity: cantidad,
      availableStock: existenciaDe(producto),
      quantityInCart: cantidadEnCarrito(producto?.id),
    })

    if (!validacion.isAllowed) {
      avisarDeExistencias(producto, validacion)
      return
    }

    setLineas((actuales) => addProductToCart(actuales, producto, cantidad))
    setCantidadPedida((actual) => ({ ...actual, [producto.id]: 1 }))
  }

  const quitar = (productoId) =>
    setLineas((actuales) => removeProductFromCart(actuales, productoId))

  /*
    Aquí la cantidad que se compara es la nueva cantidad total de la línea,
    no un incremento: lo que ya estaba en el carrito es justo lo que se va
    a reemplazar, así que no se descuenta.
  */
  const cambiarCantidad = (productoId, diferencia) => {
    const producto = productos.find(
      (candidato) => String(candidato.id) === String(productoId)
    )

    const linea = findCartLine(lineas, productoId)

    if (!producto || !linea) return

    const siguiente = linea.quantity + diferencia
    const existencia = existenciaDe(producto)

    if (!hasEnoughStock(siguiente, existencia)) {
      avisarDeExistencias(producto, {
        reason: EXCEDE_EXISTENCIAS,
        availableToAdd: existencia,
      })

      return
    }

    setLineas((actuales) =>
      setCartLineQuantity(actuales, productoId, siguiente)
    )
  }

  const vaciar = () => {
    setLineas([])
    setCantidadPedida({})
  }

  const disponibleDe = (producto) =>
    getAvailableToAdd(existenciaDe(producto), cantidadEnCarrito(producto?.id))

  const unidades = useMemo(
    () => lineas.reduce((total, linea) => total + Number(linea.quantity || 0), 0),
    [lineas]
  )

  return {
    lineas,
    setLineas,
    cantidadPedida,
    setCantidadPedida,
    unidades,

    agregar,
    quitar,
    cambiarCantidad,
    vaciar,

    disponibleDe,
    cantidadEnCarrito,
  }
}
