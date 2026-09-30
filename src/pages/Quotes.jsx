import {
  useContext,
  useMemo,
  useState,
} from "react"

import Swal from "sweetalert2"

import { FaFileAlt, FaPlus, FaSearch, FaTrash } from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"

import { ProductContext } from "../context/contexts"
import { ClientsContext } from "../context/contexts"
import { QuotesContext } from "../context/contexts"
import { claveDeIdempotencia } from "../utils/ids"

import QuoteTemplate from "../components/QuoteTemplate"

import ClientAutocomplete from "../components/documents/ClientAutocomplete"
import ModalDeCliente from "../components/documents/ModalDeCliente"
import { useCarrito } from "../hooks/useCarrito"
import { useClienteDelDocumento } from "../hooks/useClienteDelDocumento"
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal"

import {
  formatMoney,
  toISODateInDays,
} from "../utils/format"

import { filterProductsBySearchText } from "../utils/cart"

import { useNavigate } from "react-router-dom"

import {
  buildSaleDraftFromQuote,
  findUnavailableItems,
  calculateQuoteTotals,
  filterQuotesBySearchText,
  getQuoteStatus,
} from "../utils/quotes"

const CLASE_POR_ESTADO = {
  vencida: "badge-overdue",
  "por-vencer": "badge-low",
  vigente: "badge-ok",
  "sin-vigencia": "badge-credit",
}

function QuoteStatusBadge({ quote }) {
  const status = getQuoteStatus(quote)

  return (
    <span
      className={`badge ${
        CLASE_POR_ESTADO[status.code]
      }`}
    >
      <span className="badge-dot" />
      {status.label}
    </span>
  )
}

function Quotes() {
  const navigate = useNavigate()

  const {
    products = [],
    company = {},
  } = useContext(ProductContext)

  const {
    clients = [],
    addClient,
  } = useContext(ClientsContext)

  const {
    quotes = [],
    cargando: cargandoCotizaciones,
    addQuote,
    deleteQuote: quitarCotizacion,
  } = useContext(QuotesContext)

  const [guardandoCotizacion, setGuardandoCotizacion] = useState(false)

  /*
    Identifica al intento y no al clic: si se reintenta, la base devuelve
    la cotizacion que ya guardo en vez de gastar otro correlativo.
  */
  const [claveDeCotizacion, setClaveDeCotizacion] = useState(claveDeIdempotencia)

  const [search, setSearch] =
    useState("")

  const [
    historySearch,
    setHistorySearch,
  ] = useState("")

  /*
    El carrito y el alta de cliente son los mismos que en el punto de venta
    y viven en hooks compartidos. Se renombran al vocabulario que ya usaba
    esta pantalla para no reescribir el resto del archivo.
  */
  const {
    lineas: cart,
    cantidadPedida: qtyMap,
    setCantidadPedida: setQtyMap,
    agregar: addToCart,
    quitar: removeFromCart,
    cambiarCantidad: changeQuantity,
    vaciar: vaciarCarrito,
    cantidadEnCarrito: cartQuantityFor,
  } = useCarrito({ productos: products })

  const {
    busqueda: clientSearch,
    seleccionado: selectedClient,
    formulario: clientForm,
    setFormulario: setClientForm,
    modalAbierto: clientModalOpen,
    guardando: guardandoCliente,
    seleccionar: handleSelectClient,
    escribirBusqueda: handleClientChange,
    soltar: clearSelectedClient,
    abrirAlta: openNewClientModal,
    cerrarAlta: cerrarModalDeCliente,
    guardarNuevo: saveNewClient,
  } = useClienteDelDocumento({ addClient })

  const [validity, setValidity] =
    useState(
      toISODateInDays(15)
    )

  const [notes, setNotes] =
    useState("")

  const [
    includeTax,
    setIncludeTax,
  ] = useState(true)

  const [
    previewOpen,
    setPreviewOpen,
  ] = useState(false)

  const [
    selectedQuote,
    setSelectedQuote,
  ] = useState(null)

  const currency =
    company?.currency || "L"

  const taxRate = Number(
    company?.taxRate ?? 15
  )

  const filteredProducts = useMemo(
    () =>
      filterProductsBySearchText(
        products,
        search
      ),
    [products, search]
  )

  const filteredQuotes = useMemo(
    () =>
      filterQuotesBySearchText(
        quotes,
        historySearch
      ),
    [quotes, historySearch]
  )

  const {
    subtotal,
    tax,
    total,
  } = useMemo(
    () =>
      calculateQuoteTotals(cart, {
        includeTax,
        taxRate,
      }),
    [cart, includeTax, taxRate]
  )

  const buildQuote = () => {
    const customerName =
      selectedClient?.name ||
      clientSearch.trim() ||
      "Cliente General"

    return {
      clientId:
        selectedClient?.id ||
        null,

      clientName:
        customerName,

      clientPhone:
        selectedClient?.phone ||
        "",

      clientAddress:
        selectedClient?.address ||
        "",

      rtn:
        selectedClient?.rtn ||
        "",

      validity:
        validity || "",

      notes:
        notes.trim(),

      includeTax,

      taxRate,

      items: cart.map(
        // Una línea de carrito lleva `id`, nunca `productId`.
        (item) => ({
          productId:
            item.id,

          id:
            item.id,

          code:
            item.code || "",

          name:
            item.name,

          category:
            item.category ||
            "",

          price: Number(
            item.price || 0
          ),

          qty: Number(
            item.quantity || 0
          ),

          quantity: Number(
            item.quantity || 0
          ),

          subtotal:
            Number(
              item.price || 0
            ) *
            Number(
              item.quantity || 0
            ),
        })
      ),

      subtotal,

      tax,

      total,

      company: {
        name:
          company?.name || "",

        address:
          company?.address ||
          "",

        phone:
          company?.phone ||
          "",

        currency,

        taxRate,
      },
    }
  }

  const clearQuoteForm = () => {
    // Termino una cotizacion: la siguiente es otra operacion.
    setClaveDeCotizacion(claveDeIdempotencia())

    setSearch("")
    vaciarCarrito()
    clearSelectedClient()

    setValidity(
      toISODateInDays(15)
    )

    setNotes("")

    setIncludeTax(true)
  }

  const generateQuote =
    async () => {
      if (
        cart.length === 0
      ) {
        Swal.fire({
          icon: "warning",

          title:
            "Cotización vacía",

          text:
            "Agrega al menos un producto.",
        })

        return
      }

      if (guardandoCotizacion) {
        return
      }

      setGuardandoCotizacion(true)

      try {
        const quote = await addQuote(
          buildQuote(),
          claveDeCotizacion
        )

        setSelectedQuote(quote)

        setPreviewOpen(true)

        /*
         * Igual que en el HTML:
         * generar y guardar limpia
         * la cotización actual.
         */
        clearQuoteForm()

        Swal.fire({
          icon: "success",

          title: `Cotización ${quote.quoteNumber} guardada`,

          text:
            "El inventario no fue modificado.",
        })
      } catch (error) {
        Swal.fire({
          icon: "error",

          title:
            "No se pudo guardar la cotización",

          text: error.message,
        })
      } finally {
        setGuardandoCotizacion(false)
      }
    }

  const convertQuoteToSale = async (
    quote
  ) => {
    const draft =
      buildSaleDraftFromQuote(quote)

    const unavailable =
      findUnavailableItems(
        draft.cart,
        products
      )

    if (unavailable.length > 0) {
      const detalle = unavailable
        .map((item) =>
          item.reason === "no-existe"
            ? `${item.name}: ya no está en el inventario`
            : `${item.name}: se piden ${item.requested} y hay ${item.available}`
        )
        .join("\n")

      const confirmar =
        await Swal.fire({
          icon: "warning",
          title:
            "Hay productos con problemas",
          text: `${detalle}\n\n¿Quieres pasar la cotización al punto de venta de todos modos?`,
          showCancelButton: true,
          confirmButtonText:
            "Sí, continuar",
          cancelButtonText:
            "Cancelar",
        })

      if (!confirmar.isConfirmed) {
        return
      }
    }

    navigate("/pos", {
      state: { saleDraft: draft },
    })
  }

  const viewQuote = (
    quote
  ) => {
    setSelectedQuote(
      quote
    )

    setPreviewOpen(true)
  }

  const deleteQuote = async (
    quoteId
  ) => {
    const result =
      await Swal.fire({
        icon: "warning",

        title:
          "¿Eliminar cotización?",

        text:
          "Esta acción eliminará el registro guardado.",

        showCancelButton: true,

        confirmButtonText:
          "Sí, eliminar",

        cancelButtonText:
          "Cancelar",

        confirmButtonColor:
          "#C0392B",
      })

    if (
      !result.isConfirmed
    ) {
      return
    }

    try {
      await quitarCotizacion(quoteId)

      Swal.fire({
        icon: "success",

        title:
          "Cotización eliminada",
      })
    } catch (error) {
      Swal.fire({
        icon: "error",

        title:
          "No se pudo eliminar la cotización",

        text: error.message,
      })
    }
  }

  const clearCurrentQuote =
    async () => {
      if (
        cart.length === 0
      ) {
        return
      }

      const result =
        await Swal.fire({
          icon: "question",

          title:
            "¿Vaciar la cotización actual?",

          text:
            "Se quitarán todos los productos agregados.",

          showCancelButton: true,

          confirmButtonText:
            "Sí, vaciar",

          cancelButtonText:
            "Cancelar",
        })

      if (
        result.isConfirmed
      ) {
        clearQuoteForm()
      }
    }

  return (
    <div className="view active crud quotes">
      {/*
        La barra superior ya escribe «Cotizar»; el h2 que habia aqui lo
        repetia justo debajo. PageHeader deja solo la frase que explica la
        pantalla, igual que en el resto del sistema.
      */}
      <PageHeader descripcion="Genera cotizaciones de productos sin afectar el inventario." />

      <div className="bill-grid">
        {/* PRODUCTOS */}
        <section className="quotes-catalogo" aria-labelledby="quotes-titulo-catalogo">
          <h2 id="quotes-titulo-catalogo" className="quotes-titulo">
            Productos
          </h2>

          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar producto para cotizar..."
            etiqueta="Buscar producto por nombre o código"
          />

          <div className="picker-list">
            {filteredProducts.length === 0 ? (
              <EmptyState
                Icono={FaSearch}
                titulo="No se encontraron resultados"
                descripcion="Prueba con otro nombre o código."
              />
            ) : (
              filteredProducts.map(
                (product) => {
                  const quantity =
                    qtyMap[
                      product.id
                    ] ?? 1

                  const alreadyAdded =
                    cartQuantityFor(
                      product.id
                    )

                  return (
                    <div
                      key={
                        product.id
                      }
                      className="picker-item"
                    >
                      <div className="info">
                        <strong>
                          {
                            product.name
                          }
                        </strong>

                        <span>
                          {product.code ||
                            "S/C"}

                          {" · "}

                          {product.category ||
                            "Sin categoría"}

                          {alreadyAdded >
                            0 && (
                            <>
                              {" · "}

                              <b>
                                {
                                  alreadyAdded
                                }{" "}
                                en
                                cotización
                              </b>
                            </>
                          )}
                        </span>
                      </div>

                      <div className="picker-actions">
                        <span className="price">
                          {formatMoney(
                            product.price,
                            currency
                          )}
                        </span>

                        <input
                          type="number"
                          className="qty-input"
                          min="1"
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
                          onClick={() =>
                            addToCart(
                              product,
                              quantity
                            )
                          }
                        >
                          <FaPlus aria-hidden="true" />
                          Agregar
                        </button>
                      </div>
                    </div>
                  )
                }
              )
            )}
          </div>
        </section>

        {/* COTIZACIÓN ACTUAL */}
        <aside className="card cart-card">
          <div className="card-pad">
            <h2 id="quotes-titulo-actual" className="quotes-titulo">
              Cotización actual
            </h2>

            <div
              className="quotes-campo"
            >
              <ClientAutocomplete
                clients={clients}
                label="Cliente / Empresa"
                placeholder="Busca o escribe el nombre del cliente..."
                value={
                  clientSearch
                }
                selectedClient={
                  selectedClient
                }
                required={
                  false
                }
                allowFreeText
                onChange={
                  handleClientChange
                }
                onSelect={
                  handleSelectClient
                }
                onClear={
                  clearSelectedClient
                }
                onCreateNew={
                  openNewClientModal
                }
              />
            </div>

            <div
              className="form-grid quotes-campo"
            >
              <div className="field">
                <label htmlFor="quotes-valida-hasta">
                  Válida hasta
                </label>

                <input id="quotes-valida-hasta"
                  type="date"
                  value={
                    validity
                  }
                  onChange={(
                    event
                  ) =>
                    setValidity(
                      event
                        .target
                        .value
                    )
                  }
                />
              </div>

              <div className="field">
                <label htmlFor="quotes-observaciones">
                  Observaciones
                </label>

                <input id="quotes-observaciones"
                  type="text"
                  placeholder="Ej. Incluye instalación"
                  value={notes}
                  onChange={(
                    event
                  ) =>
                    setNotes(
                      event
                        .target
                        .value
                    )
                  }
                />
              </div>
            </div>

            <div
              className="field"
              className="quotes-campo"
            >
              <label className="quotes-casilla">
                <input
                  type="checkbox"
                  checked={
                    includeTax
                  }
                  onChange={(
                    event
                  ) =>
                    setIncludeTax(
                      event
                        .target
                        .checked
                    )
                  }
                />

                Incluir ISV en el
                total
              </label>
            </div>

            <div className="cart-items">
              {cart.length === 0 ? (
                <EmptyState
                  Icono={FaFileAlt}
                  titulo="Todavía no hay productos"
                  descripcion="Agrega productos de la lista para generar la cotización."
                />
              ) : (
                cart.map(
                  (item) => (
                    <div
                      key={
                        item.id
                      }
                      className="cart-row"
                    >
                      <div className="name">
                        {
                          item.name
                        }

                        <small>
                          {formatMoney(
                            item.price,
                            currency
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
                            item.quantity,

                          currency
                        )}
                      </div>

                      <button
                        type="button"
                        className="icon-btn danger cart-remove-button"
                        title="Eliminar producto"
                        aria-label={`Eliminar ${item.name} de la cotización`}
                        onClick={() =>
                          removeFromCart(
                            item.id
                          )
                        }
                      >
                        <FaTrash aria-hidden="true" />
                      </button>
                    </div>
                  )
                )
              )}
            </div>

            <div className="totals">
              <div className="totals-row">
                <span>
                  Subtotal
                </span>

                <span className="v">
                  {formatMoney(
                    subtotal,
                    currency
                  )}
                </span>
              </div>

              {includeTax && (
                <div className="totals-row">
                  <span>
                    ISV (
                    {taxRate}%)
                  </span>

                  <span className="v">
                    {formatMoney(
                      tax,
                      currency
                    )}
                  </span>
                </div>
              )}

              <div className="totals-row grand">
                <span>
                  Total
                </span>

                <span className="v">
                  {formatMoney(
                    total,
                    currency
                  )}
                </span>
              </div>
            </div>

            <div className="quotes-acciones">
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={
                  cart.length === 0 || guardandoCotizacion
                }
                onClick={generateQuote}
              >
                Generar y guardar cotización
              </button>

              <button
                type="button"
                className="btn btn-ghost btn-block"
                disabled={cart.length === 0}
                onClick={clearCurrentQuote}
              >
                Vaciar
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* HISTORIAL */}
      <section className="quotes-historial" aria-labelledby="quotes-titulo-historial">
        <h2 id="quotes-titulo-historial" className="quotes-titulo-seccion">
          Historial de cotizaciones
        </h2>

        <p className="crud-descripcion">Cotizaciones guardadas.</p>

      <div className="toolbar">
        <SearchInput
          value={historySearch}
          onChange={(event) => setHistorySearch(event.target.value)}
          placeholder="Buscar por cliente o número..."
          etiqueta="Buscar cotización por cliente o número"
        />
      </div>

      {cargandoCotizaciones ? (
        <p className="crud-cargando" role="status">
          Cargando cotizaciones…
        </p>
      ) : quotes.length === 0 ? (
        <EmptyState
          Icono={FaFileAlt}
          titulo="No hay cotizaciones guardadas"
          descripcion="Las cotizaciones que generes aparecerán aquí."
        />
      ) : (
        <div
          className="card quotes-lista"
        >
          {filteredQuotes.map(
            (quote) => (
              <div
                key={
                  quote.id
                }
                className="sale-card"
              >
                <div className="left">
                  <div
                    className="sale-icon quote"
                  >
                    <FaFileAlt aria-hidden="true" />
                  </div>

                  <div className="sale-info">
                    <b>
                      {quote.clientName ||
                        "Cliente General"}
                    </b>

                    <span>
                      {
                        quote.quoteNumber
                      }

                      {" · "}

                      {
                        quote.date
                      }

                      {quote.validity &&
                        ` · Válida hasta ${new Date(
                          `${quote.validity}T00:00:00`
                        ).toLocaleDateString(
                          "es-HN"
                        )}`}
                    </span>

                    <div className="badges">
                      <QuoteStatusBadge
                        quote={quote}
                      />
                    </div>
                  </div>
                </div>

                <div className="sale-right">
                  <div className="sale-total">
                    {formatMoney(
                      quote.total,
                      quote
                        .company
                        ?.currency ||
                        currency
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    title="Pasar esta cotización al punto de venta"
                    onClick={() =>
                      convertQuoteToSale(
                        quote
                      )
                    }
                  >
                    Facturar
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      viewQuote(
                        quote
                      )
                    }
                  >
                    Ver
                  </button>

                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Eliminar cotización"
                    aria-label={`Eliminar la cotización ${quote.quoteNumber}`}
                    onClick={() =>
                      deleteQuote(
                        quote.id
                      )
                    }
                  >
                    <FaTrash aria-hidden="true" />
                  </button>
                </div>
              </div>
            )
          )}

          {filteredQuotes.length === 0 && (
            <EmptyState
              Icono={FaSearch}
              titulo="No se encontraron cotizaciones"
              descripcion="Prueba con otro cliente o número."
            />
          )}
        </div>
      )}
      </section>

      {/* NUEVO CLIENTE */}
      <ModalDeCliente
        abierto={clientModalOpen}
        prefijo="quotes"
        formulario={clientForm}
        onCambiar={setClientForm}
        onGuardar={saveNewClient}
        onCerrar={cerrarModalDeCliente}
        guardando={guardandoCliente}
      />

      {/* VISTA / PDF / IMPRESIÓN */}
      <DocumentPreviewModal
        open={
          previewOpen &&
          !!selectedQuote
        }
        title="Cotización"
        fileName={`Cotizacion-${
          selectedQuote?.quoteNumber ||
          "documento"
        }.pdf`}
        printTitle="Cotización"
        canExport
        onClose={() => {
          setPreviewOpen(
            false
          )

          setSelectedQuote(
            null
          )
        }}
      >
        <QuoteTemplate
          quote={
            selectedQuote
          }
        />
      </DocumentPreviewModal>
    </div>
  )
}

export default Quotes