import { calculateCartSubtotal } from "./cart"
import { crearId } from "./ids"

export const VIGENTE = "vigente"
export const POR_VENCER = "por-vencer"
export const VENCIDA = "vencida"
export const SIN_VIGENCIA = "sin-vigencia"

export const DIAS_PARA_AVISAR_VENCIMIENTO = 3

export function buildQuoteNumber(sequence) {
  return `COT-${String(sequence).padStart(5, "0")}`
}

export function createQuoteId() {
  return crearId("Q")
}

export function getQuoteItemQuantity(item) {
  return Number(item?.quantity ?? item?.qty ?? 0)
}

export function calculateQuoteTotals(items, { includeTax, taxRate }) {
  const subtotal = calculateCartSubtotal(
    (items || []).map((item) => ({
      price: item.price,
      quantity: getQuoteItemQuantity(item),
    }))
  )

  const rate = Number(taxRate) || 0
  const tax = includeTax ? subtotal * (rate / 100) : 0

  return { subtotal, tax, taxRate: rate, total: subtotal + tax }
}

function startOfDay(date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)

  return copy
}

export function getDaysUntilExpiry(validity, today = new Date()) {
  if (!validity) {
    return null
  }

  const expiry = new Date(`${validity}T00:00:00`)

  if (Number.isNaN(expiry.getTime())) {
    return null
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000

  return Math.round(
    (startOfDay(expiry) - startOfDay(today)) / millisecondsPerDay
  )
}

export function getQuoteStatus(quote, today = new Date()) {
  const daysLeft = getDaysUntilExpiry(quote?.validity, today)

  if (daysLeft === null) {
    return { code: SIN_VIGENCIA, daysLeft: null, label: "Sin vigencia" }
  }

  if (daysLeft < 0) {
    return { code: VENCIDA, daysLeft, label: "Vencida" }
  }

  if (daysLeft === 0) {
    return { code: POR_VENCER, daysLeft, label: "Vence hoy" }
  }

  if (daysLeft <= DIAS_PARA_AVISAR_VENCIMIENTO) {
    return {
      code: POR_VENCER,
      daysLeft,
      label: `Vence en ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`,
    }
  }

  return { code: VIGENTE, daysLeft, label: "Vigente" }
}

export function isQuoteExpired(quote, today = new Date()) {
  return getQuoteStatus(quote, today).code === VENCIDA
}

export function filterQuotesBySearchText(quotes, searchText) {
  const query = String(searchText || "").trim().toLowerCase()

  return (quotes || []).filter((quote) =>
    [quote.clientName, quote.quoteNumber]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query)
  )
}

export function convertQuoteToCartLines(quote) {
  return (quote?.items || []).map((item) => ({
    id: item.productId ?? item.id,
    code: item.code || "",
    name: item.name,
    category: item.category || "",
    price: Number(item.price || 0),
    quantity: getQuoteItemQuantity(item),
  }))
}

export function buildSaleDraftFromQuote(quote) {
  if (!quote) {
    return null
  }

  return {
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    clientId: quote.clientId || null,
    clientName: quote.clientName || "",
    rtn: quote.rtn || "",
    cart: convertQuoteToCartLines(quote),
  }
}

export function findUnavailableItems(cartLines, products) {
  return (cartLines || []).reduce((unavailable, line) => {
    const product = (products || []).find(
      (candidate) => String(candidate.id) === String(line.id)
    )

    if (!product) {
      return [...unavailable, { name: line.name, reason: "no-existe" }]
    }

    if (Number(product.stock || 0) < line.quantity) {
      return [
        ...unavailable,
        {
          name: line.name,
          reason: "stock-insuficiente",
          requested: line.quantity,
          available: Number(product.stock || 0),
        },
      ]
    }

    return unavailable
  }, [])
}
