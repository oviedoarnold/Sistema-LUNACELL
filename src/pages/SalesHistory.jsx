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

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import StatusBadge from "../components/crud/StatusBadge"
import FormField from "../components/forms/FormField"
import ModalShell from "../components/forms/ModalShell"

import { FaFileInvoiceDollar, FaSearch } from "react-icons/fa"

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

  const getStatusBadge = (sale) => {
    if (sale.status === "pagada") {
      return (
        <StatusBadge variante="paid">
          {isCreditSale(sale) ? "Cancelada" : "Pagada"}
        </StatusBadge>
      )
    }

    if (isOverdue(sale)) {
      return <StatusBadge variante="overdue">Vencida</StatusBadge>
    }

    return <StatusBadge variante="credit">Pendiente</StatusBadge>
  }

  return (
    <div className="view active crud">

      {/* ENCABEZADO */}
      <PageHeader descripcion="Consulta las ventas registradas en el sistema." />

      {/* RESUMEN */}
      <div className="dash-grid">

        <div className="stat-card">
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

        <div className="stat-card ok">
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

        <div className="stat-card blue">
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

        <div className="stat-card warn">
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
      <div className="historial-totales">
        <div className="historial-total">
          <span className="historial-total-label">
            Total facturado
          </span>

          <strong className="historial-total-valor">
            {formatMoney(totalSales, currency)}
          </strong>
        </div>

        {/*
          El saldo se pinta en ámbar solo cuando de verdad queda algo por
          cobrar; en cero no hay nada que advertir.
        */}
        <div className="historial-total alineado-derecha">
          <span className="historial-total-label">
            Saldo por cobrar
          </span>

          <strong
            className={
              totalReceivable > 0
                ? "historial-total-valor pendiente"
                : "historial-total-valor saldado"
            }
          >
            {formatMoney(totalReceivable, currency)}
          </strong>
        </div>
      </div>

      {/* FILTROS */}
      <div className="toolbar">

        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por cliente o número de factura..."
          etiqueta="Buscar por cliente o número de factura"
        />

        <select
          className="filter-select"
          aria-label="Filtrar por tipo de pago"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
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
        <EmptyState
          Icono={FaFileInvoiceDollar}
          titulo="No hay facturas registradas"
          descripcion="Las ventas que generes desde Facturar aparecerán aquí."
        />
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

                        {paymentType === "credito" ? (
                          <StatusBadge variante="credit">Crédito</StatusBadge>
                        ) : (
                          <StatusBadge variante="paid">Contado</StatusBadge>
                        )}

                        {getStatusBadge(sale)}

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
            <EmptyState
              Icono={FaSearch}
              titulo="No se encontraron facturas"
              descripcion="Cambia la búsqueda o el filtro."
            />
          )}

        </div>
      )}

      {/* ABONOS */}
      {payingSale && (
        <ModalShell
          titulo={`Abonar a ${payingSale.invoiceNumber}`}
          onCerrar={closePaymentModal}
          cerrarAlPulsarFuera
          acciones={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closePaymentModal}
              >
                Cancelar
              </button>

              {/*
                El botón vive en el pie de la ventana y el formulario en el
                cuerpo: form="..." los enlaza sin sacar el submit de su sitio.
              */}
              <button
                type="submit"
                form="form-abono"
                className="btn btn-primary"
                disabled={abonando}
              >
                {abonando ? "Registrando…" : "Registrar abono"}
              </button>
            </>
          }
        >
          <form id="form-abono" onSubmit={submitPayment}>
            <div className="modal-resumen">
              <div>
                <span className="modal-resumen-label">Total</span>
                <strong className="modal-resumen-valor">
                  {formatMoney(payingSale.total, currency)}
                </strong>
              </div>

              <div>
                <span className="modal-resumen-label">Abonado</span>
                <strong className="modal-resumen-valor abonado">
                  {formatMoney(getSalePaid(payingSale), currency)}
                </strong>
              </div>

              <div>
                <span className="modal-resumen-label">Saldo</span>
                <strong className="modal-resumen-valor saldo">
                  {formatMoney(payingBalance, currency)}
                </strong>
              </div>
            </div>

            <FormField
              etiqueta="Monto del abono"
              ayuda={`Máximo ${formatMoney(payingBalance, currency)}`}
              error={paymentError || null}
            >
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={payingBalance}
                autoFocus
                placeholder="0.00"
                value={paymentAmount}
                onChange={(event) => {
                  setPaymentAmount(event.target.value)
                  setPaymentError("")
                }}
              />
            </FormField>

            <button
              type="button"
              className="btn btn-secondary btn-sm abono-atajo"
              onClick={() => {
                setPaymentAmount(String(payingBalance))
                setPaymentError("")
              }}
            >
              Pagar el saldo completo
            </button>

            <FormField etiqueta="Nota (opcional)">
              <input
                type="text"
                placeholder="Efectivo, transferencia, recibo #..."
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
              />
            </FormField>

            {getSalePayments(payingSale).length > 0 && (
              <div className="abonos-registrados">
                <h4 className="abonos-titulo">Abonos registrados</h4>

                {getSalePayments(payingSale).map((payment) => (
                  <div className="abono-fila" key={payment.id}>
                    <div>
                      <b>{formatMoney(payment.amount, currency)}</b>

                      <span className="abono-detalle">
                        {payment.date}
                        {payment.note ? ` · ${payment.note}` : ""}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => removePayment(payingSale, payment)}
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </form>
        </ModalShell>
      )}

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