import { useContext, useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import Swal from "sweetalert2"
import { ProductContext } from "../context/contexts"
import { MiniaturaDeProducto } from "../components/ImagenDeProducto"
import { claveDeIdempotencia } from "../utils/ids"
import { SalesContext } from "../context/contexts"
import { ClientsContext } from "../context/contexts"
import InvoiceTemplate from "../components/InvoiceTemplate"
import ClientAutocomplete from "../components/documents/ClientAutocomplete"
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal"

import {
  formatMoney,
  toISODateInDays,
  todayForDisplay,
} from "../utils/format"

import {
  addProductToCart,
  buildStockWarningMessage,
  calculateCartTotals,
  filterProductsBySearchText,
  findCartLine,
  getStockAvailableToAdd,
  normalizeRequestedQuantity,
  removeProductFromCart,
  setCartLineQuantity,
  validateQuantityAgainstStock,
} from "../utils/cart"

const ISV_POR_OMISION = 15

function POS() {
  const { products = [], company } = useContext(ProductContext)
  const { addSale } = useContext(SalesContext)

  /*
    La tasa sale de la configuración de la ferretería. Tenerla fija aquí
    hacía que cambiarla en Configuración no afectara lo que se cobra.
  */
  const tasaISV = Number(company?.taxRate ?? ISV_POR_OMISION)

  /*
    Identifica al intento de cobro, no al clic. Se conserva mientras la
    venta no se haya emitido: si el cajero vuelve a pulsar porque la red
    tardo y no vio respuesta, viaja la misma clave y la base devuelve la
    factura que ya existe en vez de emitir otra. Se renueva al limpiar la
    venta, que es cuando empieza un cobro distinto.
  */
  const [claveDeVenta, setClaveDeVenta] = useState(claveDeIdempotencia)

  const [facturando, setFacturando] = useState(false)
  const { clients = [], addClient } = useContext(ClientsContext)

  const location = useLocation()
  const navigate = useNavigate()

  const saleDraft = location.state?.saleDraft

  const [search, setSearch] = useState("")
  const [cart, setCart] = useState(
    () => saleDraft?.cart || []
  )
  const [qtyMap, setQtyMap] = useState({})

  const [paymentType, setPaymentType] = useState("contado")
  const [clientSearch, setClientSearch] = useState(
    () => saleDraft?.clientName || ""
  )
  const [selectedClient, setSelectedClient] = useState(
    () =>
      clients.find(
        (candidate) =>
          String(candidate.id) ===
          String(saleDraft?.clientId)
      ) || null
  )
  const [buyerRTN, setBuyerRTN] = useState(
    () => saleDraft?.rtn || ""
  )
  const [dueDate, setDueDate] = useState(toISODateInDays(30))

  const [clientModalOpen, setClientModalOpen] = useState(false)

  const [clientForm, setClientForm] = useState({
    name: "",
    rtn: "",
    phone: "",
    address: "",
    email: "",
  })

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSale, setPreviewSale] = useState(null)
  const [previewMode, setPreviewMode] = useState("preview")

  /*
    Se limpia el borrador del historial para que recargar la pagina
    no vuelva a cargar la cotizacion ya facturada.
  */
  useEffect(() => {
    if (!saleDraft) return

    navigate("/pos", {
      replace: true,
      state: null,
    })

    Swal.fire({
      icon: "success",
      title: "Cotización cargada",
      text: `Se cargaron los productos de ${saleDraft.quoteNumber}. Revisa antes de facturar.`,
    })
  }, [saleDraft, navigate])

  const filteredProducts = useMemo(
    () =>
      filterProductsBySearchText(
        products,
        search
      ),
    [products, search]
  )

  const availableStockFor = (product) =>
    getStockAvailableToAdd(product, cart)

  const addToCartWithQty = (
    product,
    requestedQty
  ) => {
    const quantity =
      normalizeRequestedQuantity(
        requestedQty
      )

    const validation =
      validateQuantityAgainstStock(
        product,
        cart,
        quantity
      )

    if (!validation.isAllowed) {
      Swal.fire({
        icon: "warning",
        title: "Stock insuficiente",
        text: buildStockWarningMessage(
          product.name,
          validation
        ),
      })

      return
    }

    setCart((currentCart) =>
      addProductToCart(
        currentCart,
        product,
        quantity
      )
    )

    setQtyMap((current) => ({
      ...current,
      [product.id]: 1,
    }))
  }

  const removeFromCart = (
    productId
  ) => {
    setCart((currentCart) =>
      removeProductFromCart(
        currentCart,
        productId
      )
    )
  }

  const changeQuantity = (
    productId,
    delta
  ) => {
    const product = products.find(
      (item) =>
        String(item.id) ===
        String(productId)
    )

    const cartItem = findCartLine(
      cart,
      productId
    )

    if (!product || !cartItem) return

    const nextQuantity =
      cartItem.quantity + delta

    if (
      nextQuantity >
      Number(product.stock || 0)
    ) {
      Swal.fire({
        icon: "warning",
        title: "Stock insuficiente",
        text: buildStockWarningMessage(
          product.name,
          {
            reason: "excede-existencias",
            availableToAdd: Number(
              product.stock || 0
            ),
          }
        ),
      })

      return
    }

    setCart((currentCart) =>
      setCartLineQuantity(
        currentCart,
        productId,
        nextQuantity
      )
    )
  }

  const {
    subtotal,
    tax,
    total,
  } = useMemo(
    () =>
      calculateCartTotals(
        cart,
        tasaISV
      ),
    [cart, tasaISV]
  )

  const handlePaymentTypeChange = (
    type
  ) => {
    setPaymentType(type)
    setSelectedClient(null)
    setClientSearch("")
    setBuyerRTN("")

    if (type === "credito") {
      setDueDate(toISODateInDays(30))
    }
  }

  const handleClientSearchChange = (
    value
  ) => {
    setClientSearch(value)

    if (selectedClient) {
      setSelectedClient(null)
      setBuyerRTN("")
    }
  }

  const handleSelectClient = (
    client
  ) => {
    setSelectedClient(client)
    setClientSearch(client.name)
    setBuyerRTN(client.rtn || "")
  }

  const handleClearClient = () => {
    setSelectedClient(null)
    setClientSearch("")
    setBuyerRTN("")
  }

  const openNewClientModal = () => {
    setClientForm({
      name: clientSearch.trim(),
      rtn: "",
      phone: "",
      address: "",
      email: "",
    })

    setClientModalOpen(true)
  }

  const saveNewClient = () => {
    const name =
      clientForm.name.trim()

    const phone =
      clientForm.phone.trim()

    const address =
      clientForm.address.trim()

    if (!name || !phone || !address) {
      Swal.fire({
        icon: "warning",
        title: "Faltan datos",
        text:
          "Nombre, teléfono y dirección son obligatorios.",
      })
      return
    }

    try {
      const newClient = addClient({
        ...clientForm,
        name,
        phone,
        address,
        rtn: clientForm.rtn.trim(),
        email:
          clientForm.email.trim(),
      })

      setClientModalOpen(false)

      if (newClient) {
        handleSelectClient(
          newClient
        )
      }

      Swal.fire({
        icon: "success",
        title: "Cliente guardado",
      })
    } catch (error) {
      Swal.fire({
        icon: "error",
        title:
          "No se pudo guardar el cliente",
        text: error.message,
      })
    }
  }

  const validateSale = () => {
    if (cart.length === 0) {
      Swal.fire({
        icon: "warning",
        title: "Factura vacía",
        text:
          "Agrega al menos un producto antes de continuar.",
      })

      return false
    }

    for (const item of cart) {
      const product = products.find(
        (candidate) =>
          String(candidate.id) ===
          String(item.id)
      )

      if (!product) {
        Swal.fire({
          icon: "error",
          title:
            "Producto no encontrado",
          text: `${item.name} ya no existe en el inventario.`,
        })

        return false
      }

      if (
        item.quantity >
        Number(product.stock || 0)
      ) {
        Swal.fire({
          icon: "warning",
          title:
            "Stock insuficiente",
          text: `${item.name} solo tiene ${product.stock} unidades disponibles.`,
        })

        return false
      }
    }

    if (
      paymentType === "credito" &&
      !selectedClient
    ) {
      Swal.fire({
        icon: "warning",
        title: "Cliente requerido",
        text:
          "Para vender al crédito debes seleccionar un cliente registrado.",
      })

      return false
    }

    if (
      paymentType === "credito" &&
      !dueDate
    ) {
      Swal.fire({
        icon: "warning",
        title: "Fecha requerida",
        text:
          "Indica la fecha de vencimiento de la venta a crédito.",
      })

      return false
    }

    return true
  }

  const getCustomerName = () => {
    if (selectedClient) {
      return selectedClient.name
    }

    if (
      paymentType === "contado" &&
      clientSearch.trim()
    ) {
      return clientSearch.trim()
    }

    return "Consumidor Final"
  }

  const buildPreviewSale = () => ({
    invoiceNumber: "VISTA PREVIA",
    date: todayForDisplay(),

    clientId:
      selectedClient?.id || null,

    clientName:
      getCustomerName(),

    client:
      getCustomerName(),

    clientPhone:
      selectedClient?.phone || "",

    clientAddress:
      selectedClient?.address || "",

    rtn:
      buyerRTN.trim() ||
      selectedClient?.rtn ||
      "",

    items: cart.map((item) => ({
      productId: item.id,
      code: item.code,
      name: item.name,
      qty: item.quantity,
      price: item.price,
      subtotal:
        item.price *
        item.quantity,
    })),

    subtotal,
    tax,
    taxRate: tasaISV,
    total,

    paymentType,

    dueDate:
      paymentType === "credito"
        ? dueDate
        : null,

    status:
      paymentType === "credito"
        ? "pendiente"
        : "pagada",
  })

  const buildSalePayload = () => ({
    items: cart.map((item) => ({
      id: item.id,
      productId: item.id,
      qty: item.quantity,
      price: item.price,
    })),

    type: paymentType,
    paymentType,

    clientId:
      selectedClient?.id || null,

    customerName:
      getCustomerName(),

    customer:
      getCustomerName(),

    rtn:
      buyerRTN.trim() ||
      selectedClient?.rtn ||
      "",

    dueDate:
      paymentType === "credito"
        ? dueDate
        : null,

    subtotal,
    tax,
    total,
    note: "",
  })

  const openPreview = () => {
    if (!validateSale()) return

    setPreviewMode("preview")
    setPreviewSale(
      buildPreviewSale()
    )
    setPreviewOpen(true)
  }

  const clearSaleForm = () => {
    // Termino un cobro: el siguiente es una operacion distinta.
    setClaveDeVenta(claveDeIdempotencia())

    setCart([])
    setQtyMap({})
    setSearch("")
    setPaymentType("contado")
    setSelectedClient(null)
    setClientSearch("")
    setBuyerRTN("")
    setDueDate(toISODateInDays(30))
  }

  const generateSale = async () => {
    if (!validateSale()) {
      return null
    }

    if (facturando) {
      return null
    }

    setFacturando(true)

    try {
      const createdSale = await addSale(
        buildSalePayload(),
        claveDeVenta
      )

      if (!createdSale) {
        throw new Error(
          "SalesContext no devolvió la venta creada."
        )
      }

      const invoiceForDisplay = {
        ...createdSale,

        clientPhone:
          selectedClient?.phone ||
          "",

        clientAddress:
          selectedClient?.address ||
          "",
      }

      setPreviewMode("saved")

      setPreviewSale(
        invoiceForDisplay
      )

      setPreviewOpen(true)

      clearSaleForm()

      Swal.fire({
        icon: "success",

        title: `Factura ${
          createdSale.invoiceNumber ||
          "generada"
        }`,

        text:
          "La venta fue registrada y el inventario fue actualizado.",
      })

      return createdSale
    } catch (error) {
      Swal.fire({
        icon: "error",

        title:
          "No se pudo registrar la venta",

        text:
          error.message ||
          "Ocurrió un error al generar la factura.",
      })

      return null
    } finally {
      setFacturando(false)
    }
  }

  const confirmPreviewSale = async () => {
    const createdSale =
      await generateSale()

    if (!createdSale) return

    setPreviewMode("saved")
  }

  const clearCurrentSale =
    async () => {
      if (cart.length === 0) {
        return
      }

      const result =
        await Swal.fire({
          icon: "question",

          title:
            "¿Vaciar la venta actual?",

          text:
            "Se quitarán todos los productos del carrito.",

          showCancelButton: true,

          confirmButtonText:
            "Sí, vaciar",

          cancelButtonText:
            "Cancelar",
        })

      if (result.isConfirmed) {
        clearSaleForm()
      }
    }

  return (
    <div className="view active">
      <div className="view-header">
        <div>
          <h2>Facturar</h2>
          <p className="sub">
            Arma la venta y genera la
            factura
          </p>
        </div>
      </div>

      <div className="bill-grid">
        <div>
          <div
            className="search-box"
            style={{
              maxWidth: "none",
              marginBottom: 12,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle
                cx="11"
                cy="11"
                r="8"
              />

              <line
                x1="21"
                y1="21"
                x2="16.65"
                y2="16.65"
              />
            </svg>

            <input
              type="text"
              placeholder="Buscar producto para agregar..."
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
            />
          </div>

          <div className="picker-list">
            {filteredProducts.length ===
            0 ? (
              <div className="cart-empty">
                No se encontraron
                resultados
              </div>
            ) : (
              filteredProducts.map(
                (product) => {
                  const available =
                    availableStockFor(
                      product
                    )

                  const disabled =
                    available <= 0

                  const quantity =
                    qtyMap[
                      product.id
                    ] ?? 1

                  return (
                    <div
                      key={product.id}
                      className={`picker-item${
                        disabled
                          ? " disabled"
                          : ""
                      }`}
                    >
                      <MiniaturaDeProducto
                        url={product.imageUrl}
                        nombre={product.name}
                        tamano={44}
                      />

                      <div className="info">
                        <strong>
                          {
                            product.name
                          }
                        </strong>

                        <span>
                          {product.code ||
                            "S/C"}{" "}
                          ·{" "}
                          {product.category ||
                            "Sin categoría"}{" "}
                          · {available}{" "}
                          disp.
                        </span>
                      </div>

                      <div className="picker-actions">
                        <span className="price">
                          {formatMoney(
                            product.price
                          )}
                        </span>

                        <input
                          type="number"
                          className="qty-input"
                          min="1"
                          max={Math.max(
                            available,
                            1
                          )}
                          disabled={
                            disabled
                          }
                          value={
                            quantity
                          }
                          onChange={(
                            event
                          ) =>
                            setQtyMap(
                              (
                                current
                              ) => ({
                                ...current,
                                [product.id]:
                                  event
                                    .target
                                    .value,
                              })
                            )
                          }
                        />

                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={
                            disabled
                          }
                          onClick={() =>
                            addToCartWithQty(
                              product,
                              quantity
                            )
                          }
                        >
                          Agregar
                        </button>
                      </div>
                    </div>
                  )
                }
              )
            )}
          </div>
        </div>

        <aside className="card cart-card">
          <div className="card-pad">
            <h3
              style={{
                fontSize: 17,
                marginBottom: 12,
              }}
            >
              🧾 Venta actual
            </h3>

            {/*
              No es la etiqueta de un campo sino el nombre de un grupo de
              botones. Como <label> no anunciaba nada y dejaba el grupo sin
              nombre, pasa a rotularlo con aria-labelledby.
            */}
            <div
              className="field"
              role="group"
              aria-labelledby="pos-forma-pago"
              style={{
                marginBottom: 8,
              }}
            >
              <span
                id="pos-forma-pago"
                className="rotulo-de-grupo"
              >
                Forma de pago
              </span>

              <div className="pay-toggle">
                <button
                  type="button"
                  className={
                    paymentType ===
                    "contado"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    handlePaymentTypeChange(
                      "contado"
                    )
                  }
                >
                  $ Contado
                </button>

                <button
                  type="button"
                  className={
                    paymentType ===
                    "credito"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    handlePaymentTypeChange(
                      "credito"
                    )
                  }
                >
                  ▣ Crédito
                </button>
              </div>
            </div>

            <div
              style={{
                marginBottom: 10,
              }}
            >
              <ClientAutocomplete
                clients={clients}
                label={
                  paymentType ===
                  "credito"
                    ? "Cliente requerido para crédito"
                    : "Cliente"
                }
                placeholder={
                  paymentType ===
                  "credito"
                    ? "Busca el nombre del cliente..."
                    : "Escribe el nombre o busca un cliente..."
                }
                value={
                  clientSearch
                }
                selectedClient={
                  selectedClient
                }
                required={
                  paymentType ===
                  "credito"
                }
                allowFreeText={
                  paymentType ===
                  "contado"
                }
                onChange={
                  handleClientSearchChange
                }
                onSelect={
                  handleSelectClient
                }
                onClear={
                  handleClearClient
                }
                onCreateNew={
                  openNewClientModal
                }
              />
            </div>

            {paymentType ===
              "credito" && (
              <div
                className="field"
                style={{
                  marginBottom: 10,
                }}
              >
                <label htmlFor="pos-fecha-de-vencimiento">
                  Fecha de
                  vencimiento
                </label>

                <input id="pos-fecha-de-vencimiento"
                  type="date"
                  value={dueDate}
                  onChange={(
                    event
                  ) =>
                    setDueDate(
                      event.target
                        .value
                    )
                  }
                />
              </div>
            )}

            <div
              className="field"
              style={{
                marginBottom: 10,
              }}
            >
              <label htmlFor="pos-rtn-del-comprador-opcional">
                RTN del comprador{" "}
                <span
                  style={{
                    fontWeight: 400,
                  }}
                >
                  (opcional)
                </span>
              </label>

              <input id="pos-rtn-del-comprador-opcional"
                type="text"
                maxLength="20"
                placeholder="Ej. 0801-1990-01234"
                value={buyerRTN}
                onChange={(
                  event
                ) =>
                  setBuyerRTN(
                    event.target
                      .value
                  )
                }
              />

              <span className="hint">
                Se imprime en la
                factura si el cliente
                lo solicita.
              </span>
            </div>

            <div className="cart-items">
              {cart.length === 0 ? (
                <div className="cart-empty">
                  Agrega productos de
                  la lista para iniciar
                  la venta
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.id}
                    className="cart-row"
                  >
                    <div className="name">
                      {item.name}

                      <small>
                        {formatMoney(
                          item.price
                        )}{" "}
                        c/u
                      </small>
                    </div>

                    <div className="stepper">
                      <button
                        type="button"
                        onClick={() =>
                          changeQuantity(
                            item.id,
                            -1
                          )
                        }
                      >
                        −
                      </button>

                      <span>
                        {
                          item.quantity
                        }
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          changeQuantity(
                            item.id,
                            1
                          )
                        }
                      >
                        +
                      </button>
                    </div>

                    <div className="sub">
                      {formatMoney(
                        item.price *
                          item.quantity
                      )}
                    </div>

                    <button
                      type="button"
                      className="icon-btn danger cart-remove-button"
                      onClick={() =>
                        removeFromCart(
                          item.id
                        )
                      }
                      title="Eliminar producto"
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="totals">
              <div className="totals-row">
                <span>
                  Subtotal
                </span>

                <span className="v">
                  {formatMoney(
                    subtotal
                  )}
                </span>
              </div>

              <div className="totals-row">
                <span>
                  ISV ({tasaISV}%)
                </span>

                <span className="v">
                  {formatMoney(tax)}
                </span>
              </div>

              <div className="totals-row grand">
                <span>Total</span>

                <span className="v">
                  {formatMoney(total)}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              style={{
                marginTop: 14,
              }}
              disabled={
                cart.length === 0 ||
                facturando
              }
              onClick={generateSale}
            >
              {facturando
                ? "Registrando…"
                : "Generar factura"}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-block"
              style={{
                marginTop: 7,
              }}
              disabled={
                cart.length === 0
              }
              onClick={openPreview}
            >
              Vista previa
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{
                marginTop: 5,
              }}
              disabled={
                cart.length === 0
              }
              onClick={
                clearCurrentSale
              }
            >
              Vaciar venta
            </button>
          </div>
        </aside>
      </div>

      {clientModalOpen && (
        <div className="modal-overlay open">
          <div className="modal">
            <div className="modal-head">
              <h3>
                Nuevo cliente
              </h3>

              <button
                type="button"
                className="icon-btn"
                onClick={() =>
                  setClientModalOpen(
                    false
                  )
                }
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="pos-nombre">
                    Nombre
                  </label>

                  <input id="pos-nombre"
                    value={
                      clientForm.name
                    }
                    onChange={(
                      event
                    ) =>
                      setClientForm(
                        (
                          current
                        ) => ({
                          ...current,
                          name: event
                            .target
                            .value,
                        })
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="pos-rtn-opcional">
                    RTN (opcional)
                  </label>

                  <input id="pos-rtn-opcional"
                    value={
                      clientForm.rtn
                    }
                    onChange={(
                      event
                    ) =>
                      setClientForm(
                        (
                          current
                        ) => ({
                          ...current,
                          rtn: event
                            .target
                            .value,
                        })
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="pos-telefono">
                    Teléfono
                  </label>

                  <input id="pos-telefono"
                    value={
                      clientForm.phone
                    }
                    onChange={(
                      event
                    ) =>
                      setClientForm(
                        (
                          current
                        ) => ({
                          ...current,
                          phone:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="pos-correo">
                    Correo
                  </label>

                  <input id="pos-correo"
                    type="email"
                    value={
                      clientForm.email
                    }
                    onChange={(
                      event
                    ) =>
                      setClientForm(
                        (
                          current
                        ) => ({
                          ...current,
                          email:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                  />
                </div>

                <div className="field full">
                  <label htmlFor="pos-direccion">
                    Dirección
                  </label>

                  <input id="pos-direccion"
                    value={
                      clientForm.address
                    }
                    onChange={(
                      event
                    ) =>
                      setClientForm(
                        (
                          current
                        ) => ({
                          ...current,
                          address:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                  />
                </div>
              </div>
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-primary"
                onClick={
                  saveNewClient
                }
              >
                Guardar cliente
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  setClientModalOpen(
                    false
                  )
                }
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <DocumentPreviewModal
        open={
          previewOpen &&
          !!previewSale
        }
        title={
          previewMode === "saved"
            ? "Factura"
            : "Vista previa de factura"
        }
        fileName={
          previewMode === "saved"
            ? `Factura-${
                previewSale?.invoiceNumber ||
                "venta"
              }.pdf`
            : "Vista-previa-factura.pdf"
        }
        printTitle="Factura"
        canExport={
          previewMode === "saved"
        }
        onConfirm={
          previewMode === "preview"
            ? confirmPreviewSale
            : undefined
        }
        confirmLabel="Generar factura"
        onClose={() => {
          setPreviewOpen(false)
          setPreviewSale(null)
        }}
      >
        <InvoiceTemplate
          sale={previewSale}
        />
      </DocumentPreviewModal>
    </div>
  )
}

export default POS