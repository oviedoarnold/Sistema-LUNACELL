import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import Swal from "sweetalert2"

import { useCarrito } from "./useCarrito"

/*
  El carrito compartido por el punto de venta y las cotizaciones.

  Lo que estas pruebas fijan es que las reglas de existencias del carrito
  no leen `producto.stock`: preguntan por la existencia a quien se lo diga
  el llamador. Hoy ese llamador es el catálogo y mañana será la ubicación
  activa, y ninguna de estas reglas debería enterarse.

  El caso decisivo es "decide según la existencia que se le suministra":
  monta productos cuyo `stock` dice una cosa y una existencia inyectada que
  dice otra, y comprueba que gana la inyectada. Con la versión anterior del
  hook —que leía el producto por dentro— ese caso falla.
*/

const MARTILLO = {
  id: "p1",
  code: "M-001",
  name: "Martillo de uña 16oz",
  category: "Herramientas",
  price: 180,
  stock: 10,
}

const CEMENTO = {
  id: "p2",
  code: "C-001",
  name: "Cemento gris 42.5kg",
  category: "Construcción",
  price: 250,
  stock: 4,
}

const CATALOGO = [MARTILLO, CEMENTO]

const montar = (opciones = {}) =>
  renderHook(() => useCarrito({ productos: CATALOGO, ...opciones }))

const cantidadDe = (resultado, productoId) =>
  resultado.current.lineas.find((linea) => linea.id === productoId)?.quantity

const seAviso = () =>
  Swal.fire.mock.calls.some(
    ([opciones]) => opciones?.title === "Stock insuficiente"
  )

const textoDelAviso = () =>
  Swal.fire.mock.calls.find(
    ([opciones]) => opciones?.title === "Stock insuficiente"
  )?.[0]?.text || ""

beforeEach(() => {
  Swal.fire.mockClear()
})

describe("agregar al carrito", () => {
  it("agrega el producto con la cantidad pedida", () => {
    // Arrange
    const { result } = montar()

    // Act
    act(() => result.current.agregar(MARTILLO, 3))

    // Assert
    expect(cantidadDe(result, "p1")).toBe(3)
  })

  it("suma sobre la línea que ya estaba", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, 2))
    act(() => result.current.agregar(MARTILLO, 3))

    expect(result.current.lineas).toHaveLength(1)
    expect(cantidadDe(result, "p1")).toBe(5)
  })

  it("normaliza una cantidad que no es un entero válido", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, "abc"))

    expect(cantidadDe(result, "p1")).toBe(1)
  })
})

describe("el límite de existencia al agregar", () => {
  it("permite tomar exactamente toda la existencia", () => {
    const { result } = montar()

    act(() => result.current.agregar(CEMENTO, 4))

    expect(cantidadDe(result, "p2")).toBe(4)
    expect(seAviso()).toBe(false)
  })

  it("no agrega más de lo que hay y avisa", () => {
    const { result } = montar()

    act(() => result.current.agregar(CEMENTO, 5))

    expect(result.current.lineas).toHaveLength(0)
    expect(seAviso()).toBe(true)
  })

  it("cuenta lo que ya está en el carrito contra la existencia", () => {
    const { result } = montar()

    act(() => result.current.agregar(CEMENTO, 3))
    act(() => result.current.agregar(CEMENTO, 2))

    expect(cantidadDe(result, "p2")).toBe(3)
    expect(seAviso()).toBe(true)
  })
})

describe("cambiar la cantidad de una línea", () => {
  it("sube de a uno", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, 2))
    act(() => result.current.cambiarCantidad("p1", 1))

    expect(cantidadDe(result, "p1")).toBe(3)
  })

  it("baja de a uno", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, 2))
    act(() => result.current.cambiarCantidad("p1", -1))

    expect(cantidadDe(result, "p1")).toBe(1)
  })

  it("llegar a cero quita la línea", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, 1))
    act(() => result.current.cambiarCantidad("p1", -1))

    expect(result.current.lineas).toHaveLength(0)
  })

  it("no pasa de la existencia y avisa", () => {
    const { result } = montar()

    act(() => result.current.agregar(CEMENTO, 4))
    Swal.fire.mockClear()

    act(() => result.current.cambiarCantidad("p2", 1))

    expect(cantidadDe(result, "p2")).toBe(4)
    expect(seAviso()).toBe(true)
  })

  /*
    El identificador de una línea de carrito es `id`. Las cotizaciones
    llamaban con `item.productId`, que no existe, y el paso de cantidad no
    hacía nada sin que nadie se enterara.
  */
  it("ignora un identificador que no está en el carrito", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, 2))
    act(() => result.current.cambiarCantidad(undefined, 1))

    expect(cantidadDe(result, "p1")).toBe(2)
  })
})

describe("quitar del carrito", () => {
  it("elimina la línea del producto", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, 2))
    act(() => result.current.agregar(CEMENTO, 1))
    act(() => result.current.quitar("p1"))

    expect(result.current.lineas.map((linea) => linea.id)).toEqual(["p2"])
  })

  it("vaciar deja el carrito sin líneas", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, 2))
    act(() => result.current.vaciar())

    expect(result.current.lineas).toHaveLength(0)
    expect(result.current.unidades).toBe(0)
  })
})

describe("la existencia llega como dato, no se lee del producto", () => {
  /*
    El producto dice 10 y la existencia suministrada dice 2. Si el hook
    siguiera leyendo `producto.stock`, agregar 5 pasaría.
  */
  const existenciaFija = (cuantas) => () => cuantas

  it("rechaza lo que la existencia suministrada no alcanza a cubrir", () => {
    // Arrange
    const { result } = montar({ existenciaDe: existenciaFija(2) })

    // Act
    act(() => result.current.agregar(MARTILLO, 5))

    // Assert
    expect(result.current.lineas).toHaveLength(0)
    expect(seAviso()).toBe(true)
  })

  it("permite lo que la existencia suministrada sí cubre", () => {
    const { result } = montar({ existenciaDe: existenciaFija(2) })

    act(() => result.current.agregar(MARTILLO, 2))

    expect(cantidadDe(result, "p1")).toBe(2)
  })

  /*
    El producto dice 4 y la existencia suministrada dice 20: la regla se
    apoya en el dato, no en el catálogo, en las dos direcciones.
  */
  it("permite más de lo que dice el producto si así llega la existencia", () => {
    const { result } = montar({ existenciaDe: existenciaFija(20) })

    act(() => result.current.agregar(CEMENTO, 12))

    expect(cantidadDe(result, "p2")).toBe(12)
    expect(seAviso()).toBe(false)
  })

  it("el paso de cantidad usa la misma existencia suministrada", () => {
    const { result } = montar({ existenciaDe: existenciaFija(2) })

    act(() => result.current.agregar(MARTILLO, 2))
    Swal.fire.mockClear()

    act(() => result.current.cambiarCantidad("p1", 1))

    expect(cantidadDe(result, "p1")).toBe(2)
    expect(seAviso()).toBe(true)
  })

  it("lo disponible para agregar sale de la existencia suministrada", () => {
    const { result } = montar({ existenciaDe: existenciaFija(6) })

    act(() => result.current.agregar(MARTILLO, 2))

    expect(result.current.disponibleDe(MARTILLO)).toBe(4)
  })

  it("se consulta con el producto entero, para poder mirar la ubicación", () => {
    const existenciaDe = vi.fn(() => 5)
    const { result } = montar({ existenciaDe })

    act(() => result.current.agregar(MARTILLO, 1))

    expect(existenciaDe).toHaveBeenCalledWith(MARTILLO)
  })
})

describe("sin existencia suministrada, la toma del catálogo", () => {
  it("respeta el stock que trae el producto", () => {
    const { result } = montar()

    act(() => result.current.agregar(CEMENTO, 4))

    expect(cantidadDe(result, "p2")).toBe(4)
  })

  it("lo disponible descuenta lo que ya está en el carrito", () => {
    const { result } = montar()

    act(() => result.current.agregar(MARTILLO, 4))

    expect(result.current.disponibleDe(MARTILLO)).toBe(6)
  })

  it("un producto sin stock no admite nada", () => {
    const sinExistencia = { id: "p3", name: "Funda", price: 100 }
    const { result } = montar({ productos: [sinExistencia] })

    act(() => result.current.agregar(sinExistencia, 1))

    expect(result.current.lineas).toHaveLength(0)
    expect(seAviso()).toBe(true)
  })
})

/*
  El texto que ve el usuario, armado con las cifras del momento y no con
  constantes. Se prueba desde el hook —y no solo contra
  buildStockWarningMessage— porque lo que interesa es que las cifras que
  llegan al mensaje sean las del carrito real.
*/
describe("qué dice el aviso de existencias", () => {
  const CARGADOR = {
    id: "p9",
    code: "11",
    name: "Cargador",
    category: "Accesorios",
    price: 250,
    stock: 15,
  }

  const conCargador = (opciones = {}) =>
    renderHook(() => useCarrito({ productos: [CARGADOR], ...opciones }))

  it("explica existencia, carrito y cuánto cabe todavía", () => {
    // Arrange: 15 disponibles, 3 ya en el carrito
    const { result } = conCargador()
    act(() => result.current.agregar(CARGADOR, 3))
    Swal.fire.mockClear()

    // Act: pedir 13 más, que no caben
    act(() => result.current.agregar(CARGADOR, 13))

    // Assert
    expect(textoDelAviso()).toBe(
      "Cargador tiene 15 unidades disponibles. Ya tienes 3 en el carrito, " +
        "por lo que puedes agregar 12 unidades más."
    )
  })

  it("con el carrito vacío no menciona el carrito", () => {
    const { result } = conCargador()

    act(() => result.current.agregar(CARGADOR, 20))

    expect(textoDelAviso()).toBe(
      "Cargador tiene 15 unidades disponibles. " +
        "No puedes agregar una cantidad mayor a la existencia actual."
    )
  })

  it("al subir la cantidad desde el carrito dice cuánto queda de verdad", () => {
    const { result } = conCargador()
    act(() => result.current.agregar(CARGADOR, 15))
    Swal.fire.mockClear()

    act(() => result.current.cambiarCantidad("p9", 1))

    expect(textoDelAviso()).toBe(
      "Cargador tiene 15 unidades disponibles. Ya tienes 15 en el carrito, " +
        "así que no puedes agregar más."
    )
  })

  /*
    Las cifras siguen a la existencia que se inyecte, que es lo que
    permitirá que el aviso hable de la ubicación activa.
  */
  it("las cifras siguen a la existencia suministrada", () => {
    const { result } = conCargador({ existenciaDe: () => 5 })
    act(() => result.current.agregar(CARGADOR, 2))
    Swal.fire.mockClear()

    act(() => result.current.agregar(CARGADOR, 9))

    expect(textoDelAviso()).toBe(
      "Cargador tiene 5 unidades disponibles. Ya tienes 2 en el carrito, " +
        "por lo que puedes agregar 3 unidades más."
    )
  })

  it("un producto sin existencia no promete unidades", () => {
    const agotado = { id: "p8", name: "Funda", price: 100, stock: 0 }
    const { result } = renderHook(() => useCarrito({ productos: [agotado] }))

    act(() => result.current.agregar(agotado, 1))

    expect(textoDelAviso()).toBe("Funda no tiene unidades disponibles.")
  })
})
