import { describe, it, expect } from "vitest"

import {
  SIN_EXISTENCIAS,
  EXCEDE_EXISTENCIAS,
  findCartLine,
  getQuantityInCart,
  getStockAvailableToAdd,
  normalizeRequestedQuantity,
  validateQuantityAgainstStock,
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

describe("getStockAvailableToAdd", () => {
  it("descuenta lo que ya está en el carrito", () => {
    const carrito = carritoCon(linea(martillo, 4))
    expect(getStockAvailableToAdd(martillo, carrito)).toBe(6)
  })

  it("devuelve el stock completo con el carrito vacío", () => {
    expect(getStockAvailableToAdd(martillo, [])).toBe(10)
  })

  it("nunca devuelve negativo aunque el carrito exceda el stock", () => {
    const carrito = carritoCon(linea(martillo, 99))
    expect(getStockAvailableToAdd(martillo, carrito)).toBe(0)
  })

  it("trata un producto sin stock como cero", () => {
    expect(getStockAvailableToAdd({ id: "x" }, [])).toBe(0)
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

describe("validateQuantityAgainstStock", () => {
  it("permite una cantidad dentro del stock", () => {
    const resultado = validateQuantityAgainstStock(martillo, [], 5)

    expect(resultado.isAllowed).toBe(true)
    expect(resultado.availableToAdd).toBe(10)
  })

  it("permite tomar exactamente todo el stock", () => {
    expect(validateQuantityAgainstStock(cemento, [], 4).isAllowed).toBe(true)
  })

  it("rechaza cuando no queda nada disponible", () => {
    const carrito = carritoCon(linea(cemento, 4))
    const resultado = validateQuantityAgainstStock(cemento, carrito, 1)

    expect(resultado.isAllowed).toBe(false)
    expect(resultado.reason).toBe(SIN_EXISTENCIAS)
  })

  it("rechaza cuando se pide más de lo que queda", () => {
    const carrito = carritoCon(linea(cemento, 3))
    const resultado = validateQuantityAgainstStock(cemento, carrito, 2)

    expect(resultado.isAllowed).toBe(false)
    expect(resultado.reason).toBe(EXCEDE_EXISTENCIAS)
    expect(resultado.availableToAdd).toBe(1)
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

describe("buildStockWarningMessage", () => {
  it("avisa cuando no queda nada", () => {
    const mensaje = buildStockWarningMessage(cemento.name, {
      reason: SIN_EXISTENCIAS,
      availableToAdd: 0,
    })

    expect(mensaje).toContain("No quedan unidades")
    expect(mensaje).toContain(cemento.name)
  })

  it("dice cuántas se pueden agregar todavía", () => {
    const mensaje = buildStockWarningMessage(cemento.name, {
      reason: EXCEDE_EXISTENCIAS,
      availableToAdd: 2,
    })

    expect(mensaje).toContain("2 unidades")
  })

  it("concuerda en singular con una sola unidad", () => {
    const mensaje = buildStockWarningMessage(cemento.name, {
      reason: EXCEDE_EXISTENCIAS,
      availableToAdd: 1,
    })

    expect(mensaje).toContain("1 unidad más")
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
