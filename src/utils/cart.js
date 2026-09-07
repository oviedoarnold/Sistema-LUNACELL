export const SIN_EXISTENCIAS = "sin-existencias"
export const EXCEDE_EXISTENCIAS = "excede-existencias"

function haveSameId(left, right) {
  return String(left) === String(right)
}

export function findCartLine(cart, productId) {
  return (cart || []).find((line) => haveSameId(line.id, productId)) || null
}

export function getQuantityInCart(cart, productId) {
  const line = findCartLine(cart, productId)

  return line ? Number(line.quantity) || 0 : 0
}

export function getStockAvailableToAdd(product, cart) {
  const stock = Number(product?.stock || 0)
  const alreadyInCart = getQuantityInCart(cart, product?.id)

  return Math.max(0, stock - alreadyInCart)
}

export function normalizeRequestedQuantity(value) {
  const parsed = Number.parseInt(value, 10)

  return Math.max(1, Number.isFinite(parsed) ? parsed : 1)
}

export function validateQuantityAgainstStock(product, cart, requestedQuantity) {
  const availableToAdd = getStockAvailableToAdd(product, cart)

  if (availableToAdd <= 0) {
    return { isAllowed: false, reason: SIN_EXISTENCIAS, availableToAdd }
  }

  if (requestedQuantity > availableToAdd) {
    return { isAllowed: false, reason: EXCEDE_EXISTENCIAS, availableToAdd }
  }

  return { isAllowed: true, reason: null, availableToAdd }
}

export function pluralizeUnits(quantity) {
  return Number(quantity) === 1 ? "unidad" : "unidades"
}

export function buildStockWarningMessage(productName, validation) {
  if (validation.reason === SIN_EXISTENCIAS) {
    return `No quedan unidades disponibles de ${productName}.`
  }

  const { availableToAdd } = validation

  return `Solo puedes agregar ${availableToAdd} ${pluralizeUnits(
    availableToAdd
  )} más de ${productName}.`
}

export function createCartLineFromProduct(product, quantity) {
  return {
    id: product.id,
    code: product.code || "",
    name: product.name,
    category: product.category || "",
    price: Number(product.price || 0),
    quantity,
  }
}

export function addProductToCart(cart, product, quantity) {
  const current = cart || []

  if (findCartLine(current, product.id)) {
    return current.map((line) =>
      haveSameId(line.id, product.id)
        ? { ...line, quantity: line.quantity + quantity }
        : line
    )
  }

  return [...current, createCartLineFromProduct(product, quantity)]
}

export function removeProductFromCart(cart, productId) {
  return (cart || []).filter((line) => !haveSameId(line.id, productId))
}

export function setCartLineQuantity(cart, productId, quantity) {
  if (quantity <= 0) {
    return removeProductFromCart(cart, productId)
  }

  return (cart || []).map((line) =>
    haveSameId(line.id, productId) ? { ...line, quantity } : line
  )
}

export function calculateCartSubtotal(cart) {
  return (cart || []).reduce(
    (total, line) => total + Number(line.price || 0) * Number(line.quantity || 0),
    0
  )
}

export function calculateCartTotals(cart, taxRate) {
  const subtotal = calculateCartSubtotal(cart)
  const rate = Number(taxRate) || 0
  const tax = subtotal * (rate / 100)

  return { subtotal, tax, taxRate: rate, total: subtotal + tax }
}

export function countUnitsInCart(cart) {
  return (cart || []).reduce(
    (units, line) => units + (Number(line.quantity) || 0),
    0
  )
}

export function filterProductsBySearchText(products, searchText) {
  const query = String(searchText || "").trim().toLowerCase()

  return (products || []).filter((product) =>
    [product.name, product.category, product.code]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query)
  )
}
