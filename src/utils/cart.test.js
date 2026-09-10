import { describe, it, expect } from "vitest"

import {
  SIN_EXISTENCIAS,
  EXCEDE_EXISTENCIAS,
  findCartLine,
  getQuantityInCart,
  getAvailableToAdd,
  hasEnoughStock,
  normalizeRequestedQuantity,
  validateRequestedQuantity,
  pluralizeUnits,
  buildStockWarningMessage,
  createCartLineFromProduct,
  addProductToCart,
  removeProductFromCart,
  setCartLineQuantity,
  calculateCartSubtotal,
  calculateCartTotals,
  countUnitsInCart,
  filterProductsBySearchText,
} from "./cart"

const martillo = {
  id: "p1",
  code: "M-001",
  name: "Martillo de uña 16oz",
  category: "Herramientas",
  price: 180,
  stock: 10,
}

const cemento = {
  id: "p2",
  code: "C-001",
  name: "Cemento gris 42.5kg",
  category: "Construcción",
  price: 250,
  stock: 4,
}

const carritoCon = (...lineas) => lineas

const linea = (product, quantity) =>
  createCartLineFromProduct(product, quantity)

describe("findCartLine", () => {
  it("encuentra la línea del producto", () => {
    const carrito = carritoCon(linea(martillo, 2))
    expect(findCartLine(carrito, "p1").name).toBe(martillo.name)
  })

  it("compara identificadores de distinto tipo", () => {
    const carrito = carritoCon({ ...linea(martillo, 1), id: 5 })
    expect(findCartLine(carrito, "5")).not.toBeNull()
  })

  it("devuelve null si no está", () => {
    expect(findCartLine([], "p1")).toBeNull()
    expect(findCartLine(null, "p1")).toBeNull()
  })
})

describe("getQuantityInCart", () => {
  it("devuelve la cantidad de la línea", () => {
    expect(getQuantityInCart(carritoCon(linea(martillo, 3)), "p1")).toBe(3)
  })

  it("devuelve cero si el producto no está en el carrito", () => {
    expect(getQuantityInCart([], "p1")).toBe(0)
  })
})

/*
  La existencia llega como número. Estas pruebas no construyen un producto
  a propósito: si alguna volviera a necesitar uno, sería la señal de que la
  regla se ató otra vez al catálogo.
*/
describe("getAvailableToAdd", () => {
  it("descuenta lo que ya está en el carrito", () => {
    expect(getAvailableToAdd(10, 4)).toBe(6)
  })

  it("devuelve la existencia completa con el carrito vacío", () => {
    expect(getAvailableToAdd(10, 0)).toBe(10)
  })

  it("nunca devuelve negativo aunque el carrito exceda la existencia", () => {
    expect(getAvailableToAdd(10, 99)).toBe(0)
  })

  it("trata una existencia ausente como cero", () => {
    expect(getAvailableToAdd(undefined, 0)).toBe(0)
    expect(getAvailableToAdd(null, 3)).toBe(0)
  })

  it("acepta la cantidad en carrito ausente como cero", () => {
    expect(getAvailableToAdd(10, undefined)).toBe(10)
  })
})

describe("hasEnoughStock", () => {
  it("alcanza cuando se pide menos de lo que hay", () => {
    expect(hasEnoughStock(3, 10)).toBe(true)
  })

  it("alcanza cuando se pide exactamente lo que hay", () => {
    expect(hasEnoughStock(10, 10)).toBe(true)
  })

  it("no alcanza cuando se pide más de lo que hay", () => {
    expect(hasEnoughStock(11, 10)).toBe(false)
  })

  it("no alcanza contra una existencia ausente", () => {
    expect(hasEnoughStock(1, undefined)).toBe(false)
  })
})

describe("normalizeRequestedQuantity", () => {
  it("acepta un entero válido", () => {
    expect(normalizeRequestedQuantity("3")).toBe(3)
  })

  it("nunca baja de uno", () => {
    expect(normalizeRequestedQuantity(0)).toBe(1)
    expect(normalizeRequestedQuantity(-8)).toBe(1)
  })

  it("cae en uno ante texto no numérico", () => {
    expect(normalizeRequestedQuantity("abc")).toBe(1)
    expect(normalizeRequestedQuantity("")).toBe(1)
  })

  it("trunca decimales", () => {
    expect(normalizeRequestedQuantity("2.9")).toBe(2)
  })
})

describe("validateRequestedQuantity", () => {
  it("permite una cantidad dentro de la existencia", () => {
    const resultado = validateRequestedQuantity({
      requestedQuantity: 5,
      availableStock: 10,
    })

    expect(resultado.isAllowed).toBe(true)
    expect(resultado.availableToAdd).toBe(10)
  })

  it("permite tomar exactamente toda la existencia", () => {
    const resultado = validateRequestedQuantity({
      requestedQuantity: 4,
      availableStock: 4,
    })

    expect(resultado.isAllowed).toBe(true)
  })

  it("rechaza cuando no queda nada disponible", () => {
    const resultado = validateRequestedQuantity({
      requestedQuantity: 1,
      availableStock: 4,
      quantityInCart: 4,
    })

    expect(resultado.isAllowed).toBe(false)
    expect(resultado.reason).toBe(SIN_EXISTENCIAS)
  })

  it("rechaza cuando se pide más de lo que queda", () => {
    const resultado = validateRequestedQuantity({
      requestedQuantity: 2,
      availableStock: 4,
      quantityInCart: 3,
    })

    expect(resultado.isAllowed).toBe(false)
    expect(resultado.reason).toBe(EXCEDE_EXISTENCIAS)
    expect(resultado.availableToAdd).toBe(1)
  })

  /*
    La existencia es un dato de entrada: la misma cantidad se permite o se
    rechaza según lo que se le suministre, sin que nada del producto
    intervenga. Es lo que permitirá pasarle la existencia de una ubicación
    en lugar de la del catálogo.
  */
  it("decide según la existencia que se le entrega, no según el producto", () => {
    const conDiez = validateRequestedQuantity({
      requestedQuantity: 6,
      availableStock: 10,
    })

    const conTres = validateRequestedQuantity({
      requestedQuantity: 6,
      availableStock: 3,
    })

    expect(conDiez.isAllowed).toBe(true)
    expect(conTres.isAllowed).toBe(false)
    expect(conTres.availableToAdd).toBe(3)
  })

  it("da por vacío el carrito si no se indica cuánto lleva", () => {
    const resultado = validateRequestedQuantity({
      requestedQuantity: 10,
      availableStock: 10,
    })

    expect(resultado.isAllowed).toBe(true)
  })

  /*
    Las tres cifras viajan en el resultado para que el aviso al usuario
    pueda explicarlas sin volver a calcularlas.
  */
  it("devuelve las cuentas con las que decidió", () => {
    const resultado = validateRequestedQuantity({
      requestedQuantity: 6,
      availableStock: 15,
      quantityInCart: 3,
    })

    expect(resultado).toMatchObject({
      availableStock: 15,
      quantityInCart: 3,
      availableToAdd: 12,
    })
  })

  it("también las devuelve cuando rechaza", () => {
    const resultado = validateRequestedQuantity({
      requestedQuantity: 5,
      availableStock: 4,
      quantityInCart: 4,
    })

    expect(resultado.isAllowed).toBe(false)
    expect(resultado).toMatchObject({
      availableStock: 4,
      quantityInCart: 4,
      availableToAdd: 0,
    })
  })
})

describe("pluralizeUnits", () => {
  it("usa singular para uno", () => {
    expect(pluralizeUnits(1)).toBe("unidad")
  })

  it("usa plural para el resto", () => {
    expect(pluralizeUnits(0)).toBe("unidades")
    expect(pluralizeUnits(5)).toBe("unidades")
  })
})

/*
  El aviso enseña las tres cifras con las que se decidió: cuánto hay, qué
  parte ya está en el carrito y cuánto cabe todavía. Antes solo mostraba
  la última, y el usuario no podía cuadrar ese número con las unidades que
  la pantalla decía tener disponibles.
*/
describe("buildStockWarningMessage", () => {
  const aviso = (validation) =>
    buildStockWarningMessage("Cargador", validation)

  describe("con unidades ya en el carrito", () => {
    it("explica existencia, carrito y cuánto cabe todavía", () => {
      const mensaje = aviso({
        availableStock: 15,
        quantityInCart: 3,
        availableToAdd: 12,
      })

      expect(mensaje).toBe(
        "Cargador tiene 15 unidades disponibles. Ya tienes 3 en el carrito, " +
          "por lo que puedes agregar 12 unidades más."
      )
    })

    /*
      Las cifras salen de la validación, no de constantes: con otra
      existencia el mismo mensaje dice otra cosa.
    */
    it("usa las cifras que recibe y no unas fijas", () => {
      const mensaje = aviso({
        availableStock: 7,
        quantityInCart: 5,
        availableToAdd: 2,
      })

      expect(mensaje).toBe(
        "Cargador tiene 7 unidades disponibles. Ya tienes 5 en el carrito, " +
          "por lo que puedes agregar 2 unidades más."
      )
    })

    it("concuerda en singular cuando solo cabe una más", () => {
      const mensaje = aviso({
        availableStock: 4,
        quantityInCart: 3,
        availableToAdd: 1,
      })

      expect(mensaje).toContain("puedes agregar 1 unidad más")
    })

    it("concuerda en singular cuando la existencia es de una", () => {
      const mensaje = aviso({
        availableStock: 1,
        quantityInCart: 1,
        availableToAdd: 0,
      })

      expect(mensaje).toContain("Cargador tiene 1 unidad disponible.")
    })

    it("lo dice claro cuando el carrito ya agotó la existencia", () => {
      const mensaje = aviso({
        availableStock: 4,
        quantityInCart: 4,
        availableToAdd: 0,
      })

      expect(mensaje).toBe(
        "Cargador tiene 4 unidades disponibles. Ya tienes 4 en el carrito, " +
          "así que no puedes agregar más."
      )
    })
  })

  describe("con el carrito vacío", () => {
    it("solo dice cuánto hay y que no puede pedirse más", () => {
      const mensaje = aviso({
        availableStock: 12,
        quantityInCart: 0,
        availableToAdd: 12,
      })

      expect(mensaje).toBe(
        "Cargador tiene 12 unidades disponibles. " +
          "No puedes agregar una cantidad mayor a la existencia actual."
      )
    })

    it("no menciona el carrito", () => {
      const mensaje = aviso({
        availableStock: 12,
        quantityInCart: 0,
        availableToAdd: 12,
      })

      expect(mensaje).not.toContain("carrito")
    })
  })

  describe("sin existencia", () => {
    it("no promete unidades que no hay", () => {
      const mensaje = aviso({
        availableStock: 0,
        quantityInCart: 0,
        availableToAdd: 0,
      })

      expect(mensaje).toBe("Cargador no tiene unidades disponibles.")
    })
  })

  it("siempre nombra el producto", () => {
    const mensajes = [
      aviso({ availableStock: 0, quantityInCart: 0, availableToAdd: 0 }),
      aviso({ availableStock: 9, quantityInCart: 0, availableToAdd: 9 }),
      aviso({ availableStock: 9, quantityInCart: 2, availableToAdd: 7 }),
    ]

    mensajes.forEach((mensaje) => expect(mensaje).toContain("Cargador"))
  })
})

describe("addProductToCart", () => {
  it("agrega el producto a un carrito vacío", () => {
    const carrito = addProductToCart([], martillo, 2)

    expect(carrito).toHaveLength(1)
    expect(carrito[0].quantity).toBe(2)
    expect(carrito[0].price).toBe(180)
  })

  it("acumula sobre la línea existente en vez de duplicarla", () => {
    const carrito = addProductToCart(carritoCon(linea(martillo, 2)), martillo, 3)

    expect(carrito).toHaveLength(1)
    expect(carrito[0].quantity).toBe(5)
  })

  it("no muta el carrito recibido", () => {
    const original = carritoCon(linea(martillo, 2))
    const copia = JSON.stringify(original)

    addProductToCart(original, cemento, 1)

    expect(JSON.stringify(original)).toBe(copia)
  })
})

describe("removeProductFromCart", () => {
  it("quita solo el producto indicado", () => {
    const carrito = carritoCon(linea(martillo, 1), linea(cemento, 2))
    const resultado = removeProductFromCart(carrito, "p1")

    expect(resultado).toHaveLength(1)
    expect(resultado[0].id).toBe("p2")
  })

  it("deja el carrito igual si el producto no está", () => {
    const carrito = carritoCon(linea(martillo, 1))
    expect(removeProductFromCart(carrito, "inexistente")).toHaveLength(1)
  })
})

describe("setCartLineQuantity", () => {
  it("cambia la cantidad de la línea", () => {
    const carrito = setCartLineQuantity(carritoCon(linea(martillo, 1)), "p1", 7)
    expect(carrito[0].quantity).toBe(7)
  })

  it("elimina la línea al llegar a cero", () => {
    const carrito = setCartLineQuantity(carritoCon(linea(martillo, 1)), "p1", 0)
    expect(carrito).toHaveLength(0)
  })

  it("elimina la línea con cantidad negativa", () => {
    const carrito = setCartLineQuantity(carritoCon(linea(martillo, 1)), "p1", -3)
    expect(carrito).toHaveLength(0)
  })
})

describe("calculateCartSubtotal", () => {
  it("suma precio por cantidad de cada línea", () => {
    const carrito = carritoCon(linea(martillo, 2), linea(cemento, 3))
    expect(calculateCartSubtotal(carrito)).toBe(360 + 750)
  })

  it("devuelve cero con el carrito vacío", () => {
    expect(calculateCartSubtotal([])).toBe(0)
    expect(calculateCartSubtotal(null)).toBe(0)
  })
})

describe("calculateCartTotals", () => {
  it("aplica el impuesto sobre el subtotal", () => {
    const totales = calculateCartTotals(carritoCon(linea(martillo, 1)), 15)

    expect(totales.subtotal).toBe(180)
    expect(totales.tax).toBe(27)
    expect(totales.total).toBe(207)
  })

  it("con impuesto cero el total es el subtotal", () => {
    const totales = calculateCartTotals(carritoCon(linea(cemento, 2)), 0)

    expect(totales.tax).toBe(0)
    expect(totales.total).toBe(totales.subtotal)
  })

  it("trata una tasa inválida como cero", () => {
    const totales = calculateCartTotals(carritoCon(linea(cemento, 1)), "abc")
    expect(totales.tax).toBe(0)
  })
})

describe("countUnitsInCart", () => {
  it("suma las unidades de todas las líneas", () => {
    const carrito = carritoCon(linea(martillo, 2), linea(cemento, 3))
    expect(countUnitsInCart(carrito)).toBe(5)
  })

  it("devuelve cero con el carrito vacío", () => {
    expect(countUnitsInCart([])).toBe(0)
  })
})

describe("filterProductsBySearchText", () => {
  const catalogo = [martillo, cemento]

  it("encuentra por nombre sin distinguir mayúsculas", () => {
    expect(filterProductsBySearchText(catalogo, "MARTILLO")).toHaveLength(1)
  })

  it("encuentra por categoría", () => {
    const resultado = filterProductsBySearchText(catalogo, "construcción")
    expect(resultado[0].id).toBe("p2")
  })

  it("encuentra por código", () => {
    expect(filterProductsBySearchText(catalogo, "M-001")).toHaveLength(1)
  })

  it("devuelve todo con la búsqueda vacía", () => {
    expect(filterProductsBySearchText(catalogo, "   ")).toHaveLength(2)
  })

  it("devuelve vacío cuando nada coincide", () => {
    expect(filterProductsBySearchText(catalogo, "taladro")).toHaveLength(0)
  })

  it("tolera productos sin categoría ni código", () => {
    const parcial = [{ id: "p3", name: "Clavo" }]
    expect(filterProductsBySearchText(parcial, "clavo")).toHaveLength(1)
  })
})
