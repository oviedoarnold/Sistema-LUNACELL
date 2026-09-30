import {
  useContext,
  useMemo,
  useState,
} from "react"


import { SalesContext } from "../context/contexts"

import {
  getSaleBalance,
  getSalePaid,
  isCreditSale,
} from "../utils/salesUtils"

import { ProductContext } from "../context/contexts"

import InvoiceTemplate from "../components/InvoiceTemplate"
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import SearchInput from "../components/crud/SearchInput"
import StatusBadge from "../components/crud/StatusBadge"

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
  /*
    Aquí ya no se cobra.

    El historial mostraba un botón «Abonar» en cada factura a crédito, y ese
    camino aplicaba el dinero a esa factura concreta, validando el saldo
    contra lo que hubiera en pantalla y en dos viajes separados. Cobrar es
    ahora una operación del cliente: vive en Cuentas por Cobrar y reparte el
    pago entre sus facturas dentro de una sola transacción.

    Esta pantalla se queda con lo que siempre fue: consultar lo emitido. Los
    abonos se siguen viendo dentro de cada factura, porque son parte de su
    historia; lo que ya no existe es la forma de crear uno desde aquí.
  */
  const { sales = [] } = useContext(SalesContext)

  const {
    company = {},
  } = useContext(ProductContext)

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