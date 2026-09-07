import {
  useContext,
  useMemo,
  useState,
} from "react"

import Swal from "sweetalert2"
import { claveDeIdempotencia } from "../utils/ids"

import { SalesContext } from "../context/contexts"

import {
  getSaleBalance,
  getSalePaid,
  getSalePayments,
  isCreditSale,
} from "../utils/salesUtils"

import { ProductContext } from "../context/contexts"

import InvoiceTemplate from "../components/InvoiceTemplate"
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal"

import { formatMoney } from "../utils/format"


function isOverdue(sale) {
  if (
    sale.status !== "pendiente" ||
    !sale.dueDate
  ) {
    return false
  }

  const today =
    new Date()

  today.setHours(
    0,
    0,
    0,
    0
  )

  const due =
    new Date(
      `${sale.dueDate}T00:00:00`
    )

  return due < today
}

function getPaymentType(sale) {
  return (
    sale.paymentType ||
    sale.type ||
    "contado"
  ).toLowerCase()
}

function getClientName(sale) {
  return (
    sale.clientName ||
    sale.customerName ||
    sale.customer ||
    "Consumidor Final"
  )
}

function SalesHistory() {
  const {
    sales = [],
    addPayment,
    deletePayment,
  } = useContext(SalesContext)

  const {
    company = {},
  } = useContext(ProductContext)

  const [
    payingSaleId,
    setPayingSaleId,
  ] = useState(null)

  const [abonando, setAbonando] = useState(false)

  /*
    Identifica al intento de abono, no al clic. Si la red tarda y el
    cajero vuelve a pulsar, viaja la misma clave y la base devuelve el
    abono que ya registro en vez de cobrarle dos veces al cliente. Se
    renueva al abrir el formulario para otra factura.
  */
  const [claveDelAbono, setClaveDelAbono] = useState(claveDeIdempotencia)

  const [
    paymentAmount,
    setPaymentAmount,
  ] = useState("")

  const [
    paymentNote,
    setPaymentNote,
  ] = useState("")

  const [
    paymentError,
    setPaymentError,
  ] = useState("")

  const [search, setSearch] =
    useState("")

  const [filter, setFilter] =
    useState("todas")

  const [
    selectedSale,
    setSelectedSale,
  ] = useState(null)

  const currency =
    company?.currency ||
    "L"

  const filteredSales =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase()

      return sales.filter(
        (sale) => {
          const clientName =
            getClientName(
              sale
            ).toLowerCase()

          const invoiceNumber =
            String(
              sale.invoiceNumber ||
                ""
            ).toLowerCase()

          const matchesSearch =
            clientName.includes(
              query
            ) ||
            invoiceNumber.includes(
              query
            )

          if (
            !matchesSearch
          ) {
            return false
          }

          const paymentType =
            getPaymentType(
              sale
            )

          if (
            filter ===
            "contado"
          ) {
            return (
              paymentType ===
              "contado"
            )
          }

          if (
            filter ===
            "credito"
          ) {
            return (
              paymentType ===
              "credito"
            )
          }

          return true
        }
      )
    }, [
      sales,
      search,
      filter,
    ])

  const totalSales =
    sales.reduce(
      (sum, sale) =>
        sum +
        Number(
          sale.total || 0
        ),
      0
    )

  const cashSales =
    sales.filter(
      (sale) =>
        getPaymentType(
          sale
        ) === "contado"
    ).length

  const creditSales =
    sales.filter(
      (sale) =>
        getPaymentType(
          sale
        ) === "credito"
    ).length

  const pendingSales =
    sales.filter(
      (sale) =>
        sale.status ===
        "pendiente"
    ).length

  const totalReceivable =
    sales.reduce(
      (sum, sale) =>
        sum +
        getSaleBalance(sale),
      0
    )

  /*
    Se busca por id en cada render en
    vez de guardar la venta: así el
    modal refleja el saldo nuevo
    apenas se registra un abono.
  */
  const payingSale =
    payingSaleId
      ? sales.find(
          (sale) =>
            String(sale.id) ===
            String(payingSaleId)
        )
      : null

  const payingBalance =
    payingSale
      ? getSaleBalance(
          payingSale
        )
      : 0

  const closePaymentModal = () => {
    setPayingSaleId(null)
    setPaymentAmount("")
    setPaymentNote("")
    setPaymentError("")
  }

  const openPaymentModal = (
    sale
  ) => {
    setClaveDelAbono(claveDeIdempotencia())
    setPayingSaleId(sale.id)
    setPaymentAmount("")
    setPaymentNote("")
    setPaymentError("")
  }

  const submitPayment = async (
    event
  ) => {
    event.preventDefault()

    if (!payingSale || abonando) {
      return
    }

    const wasLastPayment =
      Number(paymentAmount) >=
      payingBalance

    setAbonando(true)

    try {
      await addPayment(
        payingSale.id,
        {
          amount:
            paymentAmount,
          note: paymentNote,
        },
        claveDelAbono
      )
    } catch (error) {
      setPaymentError(
        error.message
      )

      return
    } finally {
      setAbonando(false)
    }

    closePaymentModal()

    Swal.fire({
      icon: "success",

      title: wasLastPayment
        ? "Factura cancelada"
        : "Abono registrado",

      text: wasLastPayment
        ? "El saldo quedó en cero."
        : "El saldo pendiente se actualizó.",
    })
  }

  const removePayment = async (
    sale,
    payment
  ) => {
    const result =
      await Swal.fire({
        icon: "warning",

        title: "¿Eliminar abono?",

        text: `Se quitará el abono de ${formatMoney(
          payment.amount,
          currency
        )} y el saldo volverá a subir.`,

        showCancelButton: true,

        confirmButtonText:
          "Sí, eliminar",

        cancelButtonText:
          "Cancelar",
      })

    if (!result.isConfirmed) {
      return
    }

    try {
      await deletePayment(
        sale.id,
        payment.id
      )
    } catch (error) {
      Swal.fire({
        icon: "error",

        title:
          "No se pudo eliminar el abono",

        text: error.message,
      })
    }
  }

  const getStatusBadge = (
    sale
  ) => {
    if (
      sale.status ===
      "pagada"
    ) {
      return (
        <span className="badge badge-paid">
          <span className="badge-dot" />
          {isCreditSale(sale)
            ? "Cancelada"
            : "Pagada"}
        </span>
      )
    }

    if (
      isOverdue(sale)
    ) {
      return (
        <span className="badge badge-overdue">
          <span className="badge-dot" />
          Vencida
        </span>
      )
    }

    return (
      <span className="badge badge-credit">
        <span className="badge-dot" />
        Pendiente
      </span>
    )
  }

  return (
    <div className="view active">

      {/* ENCABEZADO */}
      <div className="view-header">
        <div>
          <h2>
            Historial de facturas
          </h2>

          <p className="sub">
            Consulta las ventas
            registradas en el
            sistema
          </p>
        </div>
      </div>

      {/* RESUMEN */}
      <div className="dash-grid">

        <div className="stat-card blue">
          <div className="label">
            Facturas
          </div>

          <div className="value">
            {sales.length}
          </div>

          <div className="sub-val">
            Total registradas
          </div>
        </div>

        <div className="stat-card teal">
          <div className="label">
            Ventas contado
          </div>

          <div className="value">
            {cashSales}
          </div>

          <div className="sub-val">
            Facturas pagadas
          </div>
        </div>

        <div className="stat-card purple">
          <div className="label">
            Ventas crédito
          </div>

          <div className="value">
            {creditSales}
          </div>

          <div className="sub-val">
            Facturas a crédito
          </div>
        </div>

        <div className="stat-card amber">
          <div className="label">
            Pendientes
          </div>

          <div className="value">
            {pendingSales}
          </div>

          <div className="sub-val">
            Por pagar
          </div>
        </div>

      </div>

      {/* TOTAL VENDIDO */}
      <div
        className="card card-pad"
        style={{
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "space-between",
            gap: 16,
          }}
        >
          <div>
            <span
              style={{
                display:
                  "block",
                fontSize: 12,
                color:
                  "var(--steel)",
              }}
            >
              Total facturado
            </span>

            <strong
              style={{
                fontSize: 24,
              }}
            >
              {formatMoney(
                totalSales,
                currency
              )}
            </strong>
          </div>

          <div
            style={{
              textAlign:
                "right",
            }}
          >
            <span
              style={{
                display:
                  "block",
                fontSize: 12,
                color:
                  "var(--steel)",
              }}
            >
              Saldo por cobrar
            </span>

            <strong
              style={{
                fontSize: 24,
                color:
                  totalReceivable >
                  0
                    ? "var(--amber)"
                    : "var(--teal)",
              }}
            >
              {formatMoney(
                totalReceivable,
                currency
              )}
            </strong>
          </div>
        </div>
      </div>

      {/* FILTROS */}
      <div className="toolbar">

        <div className="search-box">

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
            placeholder="Buscar por cliente o número de factura..."
            value={search}
            onChange={(
              event
            ) =>
              setSearch(
                event
                  .target
                  .value
              )
            }
          />

        </div>

        <select
          className="filter-select"
          value={filter}
          onChange={(
            event
          ) =>
            setFilter(
              event
                .target
                .value
            )
          }
        >
          <option value="todas">
            Todas
          </option>

          <option value="contado">
            Contado
          </option>

          <option value="credito">
            Crédito
          </option>
        </select>

      </div>

      {/* LISTA */}
      {sales.length === 0 ? (
        <div className="empty-state">

          <strong>
            No hay facturas
            registradas
          </strong>

          Las ventas que generes
          desde Facturar aparecerán
          aquí.

        </div>
      ) : (
        <div
          className="card"
          style={{
            display:
              "flex",
            flexDirection:
              "column",
          }}
        >

          {filteredSales.map(
            (
              sale,
              index
            ) => {
              const paymentType =
                getPaymentType(
                  sale
                )

              return (
                <div
                  className="sale-card"
                  key={sale.id}
                  style={{
                    borderTop:
                      index > 0
                        ? "1px solid var(--line)"
                        : "none",
                  }}
                >

                  <div className="left">

                    <div className="sale-icon">
                      🧾
                    </div>

                    <div className="sale-info">

                      <b>
                        {getClientName(
                          sale
                        )}
                      </b>

                      <span>
                        {sale.invoiceNumber}

                        {" · "}

                        {sale.date}
                      </span>

                      <div className="badges">

                        {paymentType ===
                        "credito" ? (
                          <span className="badge badge-credit">
                            <span className="badge-dot" />
                            Crédito
                          </span>
                        ) : (
                          <span className="badge badge-paid">
                            <span className="badge-dot" />
                            Contado
                          </span>
                        )}

                        {getStatusBadge(
                          sale
                        )}

                      </div>

                    </div>

                  </div>

                  <div className="sale-right">

                    <div
                      style={{
                        textAlign:
                          "right",
                      }}
                    >
                      <div className="sale-total">
                        {formatMoney(
                          sale.total,
                          sale
                            .company
                            ?.currency ||
                            currency
                        )}
                      </div>

                      {isCreditSale(
                        sale
                      ) &&
                        getSalePaid(
                          sale
                        ) > 0 && (
                          <span
                            style={{
                              display:
                                "block",
                              fontSize: 12,
                              color:
                                "var(--steel)",
                            }}
                          >
                            Abonado{" "}
                            {formatMoney(
                              getSalePaid(
                                sale
                              ),
                              currency
                            )}
                          </span>
                        )}

                      {isCreditSale(
                        sale
                      ) &&
                        getSaleBalance(
                          sale
                        ) > 0 && (
                          <span
                            style={{
                              display:
                                "block",
                              fontSize: 12.5,
                              fontWeight: 700,
                              color:
                                "var(--amber)",
                            }}
                          >
                            Resta{" "}
                            {formatMoney(
                              getSaleBalance(
                                sale
                              ),
                              currency
                            )}
                          </span>
                        )}
                    </div>

                    {isCreditSale(
                      sale
                    ) &&
                      getSaleBalance(
                        sale
                      ) > 0 && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() =>
                            openPaymentModal(
                              sale
                            )
                          }
                        >
                          Abonar
                        </button>
                      )}

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        setSelectedSale(
                          sale
                        )
                      }
                    >
                      Ver factura
                    </button>

                  </div>

                </div>
              )
            }
          )}

          {filteredSales.length ===
            0 && (
            <div className="empty-state">
              <strong>
                No se encontraron
                facturas
              </strong>

              Cambia la búsqueda
              o el filtro.
            </div>
          )}

        </div>
      )}

      {/* ABONOS */}
      <div
        className={`modal-overlay ${
          payingSale ? "open" : ""
        }`}
        onClick={
          closePaymentModal
        }
      >
        {payingSale && (
          <div
            className="modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="modal-head">
              <h3>
                Abonar a{" "}
                {
                  payingSale.invoiceNumber
                }
              </h3>

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={
                  closePaymentModal
                }
              >
                Cerrar
              </button>
            </div>

            <form
              onSubmit={
                submitPayment
              }
            >
              <div className="modal-body">

                <div
                  className="card card-pad"
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "repeat(3, 1fr)",
                    gap: 12,
                    marginBottom: 18,
                  }}
                >
                  <div>
                    <span
                      style={{
                        display:
                          "block",
                        fontSize: 11.5,
                        color:
                          "var(--steel)",
                      }}
                    >
                      Total
                    </span>

                    <strong>
                      {formatMoney(
                        payingSale.total,
                        currency
                      )}
                    </strong>
                  </div>

                  <div>
                    <span
                      style={{
                        display:
                          "block",
                        fontSize: 11.5,
                        color:
                          "var(--steel)",
                      }}
                    >
                      Abonado
                    </span>

                    <strong
                      style={{
                        color:
                          "var(--teal)",
                      }}
                    >
                      {formatMoney(
                        getSalePaid(
                          payingSale
                        ),
                        currency
                      )}
                    </strong>
                  </div>

                  <div>
                    <span
                      style={{
                        display:
                          "block",
                        fontSize: 11.5,
                        color:
                          "var(--steel)",
                      }}
                    >
                      Saldo
                    </span>

                    <strong
                      style={{
                        color:
                          "var(--amber)",
                      }}
                    >
                      {formatMoney(
                        payingBalance,
                        currency
                      )}
                    </strong>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="saleshistory-monto-del-abono">
                    Monto del abono
                  </label>

                  <input id="saleshistory-monto-del-abono"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={
                      payingBalance
                    }
                    autoFocus
                    placeholder="0.00"
                    value={
                      paymentAmount
                    }
                    onChange={(
                      event
                    ) => {
                      setPaymentAmount(
                        event
                          .target
                          .value
                      )

                      setPaymentError(
                        ""
                      )
                    }}
                  />

                  <span className="hint">
                    Máximo{" "}
                    {formatMoney(
                      payingBalance,
                      currency
                    )}
                  </span>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{
                    marginTop: 8,
                  }}
                  onClick={() => {
                    setPaymentAmount(
                      String(
                        payingBalance
                      )
                    )

                    setPaymentError(
                      ""
                    )
                  }}
                >
                  Pagar el saldo completo
                </button>

                <div
                  className="field"
                  style={{
                    marginTop: 16,
                  }}
                >
                  <label htmlFor="saleshistory-nota-opcional">
                    Nota (opcional)
                  </label>

                  <input id="saleshistory-nota-opcional"
                    type="text"
                    placeholder="Efectivo, transferencia, recibo #..."
                    value={
                      paymentNote
                    }
                    onChange={(
                      event
                    ) =>
                      setPaymentNote(
                        event
                          .target
                          .value
                      )
                    }
                  />
                </div>

                {paymentError && (
                  <div
                    className="login-error show"
                    style={{
                      marginTop: 14,
                    }}
                  >
                    {paymentError}
                  </div>
                )}

                {getSalePayments(
                  payingSale
                ).length > 0 && (
                  <div
                    style={{
                      marginTop: 22,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontFamily:
                          "var(--font-mono)",
                        textTransform:
                          "uppercase",
                        letterSpacing:
                          ".5px",
                        color:
                          "var(--steel)",
                        marginBottom: 9,
                      }}
                    >
                      Abonos registrados
                    </div>

                    {getSalePayments(
                      payingSale
                    ).map(
                      (payment) => (
                        <div
                          key={
                            payment.id
                          }
                          style={{
                            display:
                              "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "space-between",
                            gap: 10,
                            padding:
                              "9px 0",
                            borderTop:
                              "1px solid var(--line)",
                          }}
                        >
                          <div>
                            <b>
                              {formatMoney(
                                payment.amount,
                                currency
                              )}
                            </b>

                            <span
                              style={{
                                display:
                                  "block",
                                fontSize: 12,
                                color:
                                  "var(--steel)",
                              }}
                            >
                              {
                                payment.date
                              }

                              {payment.note
                                ? ` · ${payment.note}`
                                : ""}
                            </span>
                          </div>

                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() =>
                              removePayment(
                                payingSale,
                                payment
                              )
                            }
                          >
                            Eliminar
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}

              </div>

              <div className="modal-foot">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={
                    closePaymentModal
                  }
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={abonando}
                >
                  {abonando
                    ? "Registrando…"
                    : "Registrar abono"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* FACTURA */}
      <DocumentPreviewModal
        open={
          !!selectedSale
        }
        title={
          selectedSale
            ? `Factura ${selectedSale.invoiceNumber}`
            : "Factura"
        }
        fileName={`Factura-${
          selectedSale?.invoiceNumber ||
          "documento"
        }.pdf`}
        printTitle={
          selectedSale
            ? `Factura ${selectedSale.invoiceNumber}`
            : "Factura"
        }
        canExport
        onClose={() =>
          setSelectedSale(
            null
          )
        }
      >
        <InvoiceTemplate
          sale={
            selectedSale
          }
        />
      </DocumentPreviewModal>

    </div>
  )
}

export default SalesHistory