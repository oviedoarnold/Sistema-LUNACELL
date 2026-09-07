import { describe, it, expect } from "vitest"

import {
  VIGENTE,
  POR_VENCER,
  VENCIDA,
  SIN_VIGENCIA,
  buildQuoteNumber,
  createQuoteId,
  getQuoteItemQuantity,
  calculateQuoteTotals,
  getDaysUntilExpiry,
  getQuoteStatus,
  isQuoteExpired,
  filterQuotesBySearchText,
  convertQuoteToCartLines,
  buildSaleDraftFromQuote,
  findUnavailableItems,
} from "./quotes"

const HOY = new Date(2026, 7, 28)

const cotizacion = (extra = {}) => ({
  id: "Q-1",
  quoteNumber: "COT-00001",
  clientId: "c1",
  clientName: "Ferremax",
  rtn: "0801199912345",
  validity: "2026-09-12",
  items: [
    { productId: "p1", name: "Martillo", code: "M-001", price: 180, quantity: 2 },
    { productId: "p2", name: "Cemento", code: "C-001", price: 250, qty: 3 },
  ],
  ...extra,
})

describe("buildQuoteNumber", () => {
  it("rellena a cinco dígitos", () => {
    expect(buildQuoteNumber(1)).toBe("COT-00001")
    expect(buildQuoteNumber(1234)).toBe("COT-01234")
  })
})

describe("createQuoteId", () => {
  it("genera identificadores distintos", () => {
    expect(createQuoteId()).not.toBe(createQuoteId())
  })

  it("usa el prefijo de cotización", () => {
    expect(createQuoteId()).toMatch(/^Q-/)
  })
})

describe("getQuoteItemQuantity", () => {
  it("lee el campo nuevo", () => {
    expect(getQuoteItemQuantity({ quantity: 4 })).toBe(4)
  })

  it("lee el campo antiguo de cotizaciones ya guardadas", () => {
    expect(getQuoteItemQuantity({ qty: 7 })).toBe(7)
  })

  it("prefiere el campo nuevo si vienen los dos", () => {
    expect(getQuoteItemQuantity({ quantity: 4, qty: 9 })).toBe(4)
  })

  it("devuelve cero si no hay cantidad", () => {
    expect(getQuoteItemQuantity({})).toBe(0)
    expect(getQuoteItemQuantity(null)).toBe(0)
  })
})

describe("calculateQuoteTotals", () => {
  const items = cotizacion().items

  it("suma respetando ambos nombres de cantidad", () => {
    const totales = calculateQuoteTotals(items, {
      includeTax: false,
      taxRate: 15,
    })

    expect(totales.subtotal).toBe(360 + 750)
  })

  it("aplica el impuesto cuando se incluye", () => {
    const totales = calculateQuoteTotals(items, {
      includeTax: true,
      taxRate: 15,
    })

    expect(totales.tax).toBeCloseTo(166.5, 2)
    expect(totales.total).toBeCloseTo(1276.5, 2)
  })

  it("omite el impuesto cuando no se incluye", () => {
    const totales = calculateQuoteTotals(items, {
      includeTax: false,
      taxRate: 15,
    })

    expect(totales.tax).toBe(0)
    expect(totales.total).toBe(totales.subtotal)
  })

  it("devuelve ceros sin artículos", () => {
    const totales = calculateQuoteTotals([], {
      includeTax: true,
      taxRate: 15,
    })

    expect(totales.total).toBe(0)
  })
})

describe("getDaysUntilExpiry", () => {
  it("cuenta los días que faltan", () => {
    expect(getDaysUntilExpiry("2026-09-12", HOY)).toBe(15)
  })

  it("devuelve cero el mismo día del vencimiento", () => {
    expect(getDaysUntilExpiry("2026-08-28", HOY)).toBe(0)
  })

  it("devuelve negativo si ya pasó", () => {
    expect(getDaysUntilExpiry("2026-08-20", HOY)).toBe(-8)
  })

  it("devuelve null sin vigencia", () => {
    expect(getDaysUntilExpiry("", HOY)).toBeNull()
    expect(getDaysUntilExpiry(null, HOY)).toBeNull()
  })

  it("devuelve null ante una fecha inválida", () => {
    expect(getDaysUntilExpiry("no-es-fecha", HOY)).toBeNull()
  })
})

describe("getQuoteStatus", () => {
  it("marca vigente una cotización con margen", () => {
    const estado = getQuoteStatus(cotizacion(), HOY)

    expect(estado.code).toBe(VIGENTE)
    expect(estado.label).toBe("Vigente")
  })

  it("marca vencida la que ya pasó", () => {
    const estado = getQuoteStatus(
      cotizacion({ validity: "2026-08-01" }),
      HOY
    )

    expect(estado.code).toBe(VENCIDA)
    expect(estado.label).toBe("Vencida")
  })

  it("avisa el mismo día del vencimiento", () => {
    const estado = getQuoteStatus(
      cotizacion({ validity: "2026-08-28" }),
      HOY
    )

    expect(estado.code).toBe(POR_VENCER)
    expect(estado.label).toBe("Vence hoy")
  })

  it("avisa cuando faltan pocos días y concuerda el plural", () => {
    expect(
      getQuoteStatus(cotizacion({ validity: "2026-08-29" }), HOY).label
    ).toBe("Vence en 1 día")

    expect(
      getQuoteStatus(cotizacion({ validity: "2026-08-31" }), HOY).label
    ).toBe("Vence en 3 días")
  })

  it("marca sin vigencia la que no tiene fecha", () => {
    const estado = getQuoteStatus(cotizacion({ validity: "" }), HOY)
    expect(estado.code).toBe(SIN_VIGENCIA)
  })
})

describe("isQuoteExpired", () => {
  it("es verdadero solo para las vencidas", () => {
    expect(isQuoteExpired(cotizacion({ validity: "2026-01-01" }), HOY)).toBe(true)
    expect(isQuoteExpired(cotizacion(), HOY)).toBe(false)
  })
})

describe("filterQuotesBySearchText", () => {
  const lista = [
    cotizacion(),
    cotizacion({ id: "Q-2", quoteNumber: "COT-00002", clientName: "Taller Díaz" }),
  ]

  it("encuentra por nombre de cliente", () => {
    expect(filterQuotesBySearchText(lista, "taller")).toHaveLength(1)
  })

  it("encuentra por número de cotización", () => {
    expect(filterQuotesBySearchText(lista, "COT-00001")).toHaveLength(1)
  })

  it("devuelve todas con la búsqueda vacía", () => {
    expect(filterQuotesBySearchText(lista, "")).toHaveLength(2)
  })
})

describe("convertQuoteToCartLines", () => {
  it("traduce los artículos al formato del carrito", () => {
    const lineas = convertQuoteToCartLines(cotizacion())

    expect(lineas).toHaveLength(2)
    expect(lineas[0]).toMatchObject({ id: "p1", quantity: 2, price: 180 })
  })

  it("normaliza la cantidad guardada como qty", () => {
    const lineas = convertQuoteToCartLines(cotizacion())
    expect(lineas[1].quantity).toBe(3)
  })

  it("devuelve vacío si la cotización no tiene artículos", () => {
    expect(convertQuoteToCartLines({ items: [] })).toEqual([])
    expect(convertQuoteToCartLines(null)).toEqual([])
  })
})

describe("buildSaleDraftFromQuote", () => {
  it("arrastra el cliente y su RTN", () => {
    const draft = buildSaleDraftFromQuote(cotizacion())

    expect(draft.clientId).toBe("c1")
    expect(draft.clientName).toBe("Ferremax")
    expect(draft.rtn).toBe("0801199912345")
    expect(draft.quoteNumber).toBe("COT-00001")
  })

  it("devuelve null sin cotización", () => {
    expect(buildSaleDraftFromQuote(null)).toBeNull()
  })
})

describe("findUnavailableItems", () => {
  const inventario = [
    { id: "p1", stock: 10 },
    { id: "p2", stock: 1 },
  ]

  it("no reporta nada cuando alcanza el stock", () => {
    const lineas = [{ id: "p1", name: "Martillo", quantity: 2 }]
    expect(findUnavailableItems(lineas, inventario)).toEqual([])
  })

  it("reporta el producto que ya no existe", () => {
    const lineas = [{ id: "borrado", name: "Fantasma", quantity: 1 }]
    const faltantes = findUnavailableItems(lineas, inventario)

    expect(faltantes[0].reason).toBe("no-existe")
  })

  it("reporta el stock insuficiente con las cantidades", () => {
    const lineas = [{ id: "p2", name: "Cemento", quantity: 5 }]
    const faltantes = findUnavailableItems(lineas, inventario)

    expect(faltantes[0]).toMatchObject({
      reason: "stock-insuficiente",
      requested: 5,
      available: 1,
    })
  })

  it("acepta exactamente el stock disponible", () => {
    const lineas = [{ id: "p2", name: "Cemento", quantity: 1 }]
    expect(findUnavailableItems(lineas, inventario)).toEqual([])
  })
})
