import { describe, it, expect } from "vitest"

import {
  agregarAlTraslado,
  cantidadValida,
  cuantos,
  escribirCantidad,
  quitarDelTraslado,
  resumenDelTraslado,
  revalidarParaOrigen,
  sumarAlRenglon,
} from "./carritoDeTraslado"

describe("carrito del traslado", () => {
  it("una cantidad válida es un entero entre 1 y lo disponible", () => {
    expect(cantidadValida("1", 5)).toBe(true)
    expect(cantidadValida("5", 5)).toBe(true)
    expect(cantidadValida("6", 5)).toBe(false)
    expect(cantidadValida("0", 5)).toBe(false)
    expect(cantidadValida("-2", 5)).toBe(false)
    expect(cantidadValida("2.5", 5)).toBe(false)
    expect(cantidadValida("", 5)).toBe(false)
  })

  it("agregar crea el renglón con 1; repetirlo suma, sin duplicar, hasta lo disponible", () => {
    let { carrito, agregado } = agregarAlTraslado([], "p1", 2)
    expect([carrito, agregado]).toEqual([[{ productId: "p1", cantidad: "1" }], true])
    ;({ carrito, agregado } = agregarAlTraslado(carrito, "p1", 2))
    expect([carrito, agregado]).toEqual([[{ productId: "p1", cantidad: "2" }], true])
    ;({ carrito, agregado } = agregarAlTraslado(carrito, "p1", 2))
    expect([carrito, agregado]).toEqual([[{ productId: "p1", cantidad: "2" }], false])
    expect(agregarAlTraslado([], "p9", 0)).toEqual({ carrito: [], agregado: false })
  })

  it("− y + no bajan de 1 ni pasan de lo disponible", () => {
    const carrito = [{ productId: "p1", cantidad: "2" }]

    expect(sumarAlRenglon(carrito, "p1", 1, 3)[0].cantidad).toBe("3")
    expect(sumarAlRenglon(carrito, "p1", 5, 3)[0].cantidad).toBe("3")
    expect(sumarAlRenglon(carrito, "p1", -1, 3)[0].cantidad).toBe("1")
    expect(sumarAlRenglon([{ productId: "p1", cantidad: "1" }], "p1", -1, 3)[0].cantidad).toBe("1")
    expect(sumarAlRenglon([{ productId: "p1", cantidad: "" }], "p1", 1, 3)[0].cantidad).toBe("1")
    expect(sumarAlRenglon(carrito, "otro", 1, 3)).toBe(carrito)
  })

  it("escribir y quitar tocan solo su renglón", () => {
    const carrito = [{ productId: "p1", cantidad: "2" }, { productId: "p2", cantidad: "1" }]

    expect(escribirCantidad(carrito, "p2", "30")).toEqual([{ productId: "p1", cantidad: "2" }, { productId: "p2", cantidad: "30" }])
    expect(quitarDelTraslado(carrito, "p1")).toEqual([{ productId: "p2", cantidad: "1" }])
  })

  it("al cambiar el origen retira lo que no hay y baja lo que pasa de lo disponible", () => {
    const carrito = [
      { productId: "p1", cantidad: "8" },
      { productId: "p2", cantidad: "2" },
      { productId: "p3", cantidad: "4" },
      { productId: "p4", cantidad: "abc" },
    ]
    const disponible = { p1: 5, p2: 10, p3: 0, p4: 3 }

    expect(revalidarParaOrigen(carrito, (id) => disponible[id] ?? 0)).toEqual({
      carrito: [
        { productId: "p1", cantidad: "5" },
        { productId: "p2", cantidad: "2" },
        { productId: "p4", cantidad: "1" },
      ],
      retirados: ["p3"],
      ajustados: ["p1", "p4"],
    })
  })

  it("el resumen cuenta productos distintos y unidades válidas", () => {
    expect(resumenDelTraslado([{ productId: "p1", cantidad: "2" }, { productId: "p2", cantidad: "5" }, { productId: "p3", cantidad: "" }])).toEqual({
      productos: 3,
      unidades: 7,
    })
    expect(cuantos(1, "producto", "productos")).toBe("1 producto")
    expect(cuantos(3, "unidad", "unidades")).toBe("3 unidades")
  })
})
