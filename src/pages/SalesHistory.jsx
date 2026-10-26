import {
  useContext,
  useMemo,
  useState,
} from "react"


import Swal from "sweetalert2"

import { LocationsContext, SalesContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"

import {
  esVentaAnulada,
  getSaleBalance,
  getSalePaid,
  isCreditSale,
} from "../utils/salesUtils"

import { puedeVerAnular, razonParaNoAnular, textoDelTratamiento } from "../utils/anulacion"
import AnularVentaModal from "../components/ventas/AnularVentaModal"

import { ProductContext } from "../context/contexts"

import InvoiceTemplate from "../components/InvoiceTemplate"
import { nombreDelDocumento } from "../lib/nombreDelDocumento"
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
  const { sales = [], refrescarVentas } = useContext(SalesContext)

  /*
    Anular: el administrador en cualquier ubicación; el vendedor con
    «Historial» y «Anular ventas», en la suya. Es solo lo que se muestra:
    anular_venta() vuelve a decidirlo en la base.
  */
  const { user, isAdmin, hasPermission, permissions } = useAuth()
  const { obtenerUbicacionPorId } = useContext(LocationsContext) || {}

  const quienAnula = {
    esAdmin: Boolean(isAdmin),
    puedeAnular: hasPermission(permissions.SALES_HISTORY) && hasPermission(permissions.SALES_VOID),
    ubicacionId: user?.locationId || null,
  }

  const [porAnular, setPorAnular] = useState(null)

  const nombreDeUbicacion = (id) => obtenerUbicacionPorId?.(id)?.name || ""

  const alAnular = async (respuesta) => {
    setPorAnular(null)
    await refrescarVentas?.().catch(() => {})

    Swal.fire({
      icon: "success",
      title: respuesta?.estado === "ya_anulada" ? "La venta ya estaba anulada" : "Venta anulada",
      text: `${respuesta?.numero_factura || ""} conserva su número. Las existencias regresaron a su ubicación.`,
    })
  }

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

          if (filter === "anuladas") {
            return esVentaAnulada(sale)
          }

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

  /*
    Las anuladas se siguen viendo en la lista, pero no suman: ni a lo
    vendido, ni a los conteos de contado, crédito o pendientes.
  */
  const vigentes = sales.filter((sale) => !esVentaAnulada(sale))

  const totalSales =
    vigentes.reduce(
      (sum, sale) =>
        sum +
        Number(
          sale.total || 0
        ),
      0
    )

  const cashSales =
    vigentes.filter(
      (sale) =>
        getPaymentType(
          sale
        ) === "contado"
    ).length

  const creditSales =
    vigentes.filter(
      (sale) =>
        getPaymentType(
          sale
        ) === "credito"
    ).length

  const pendingSales =
    vigentes.filter(
      (sale) =>
        sale.status ===
        "pendiente"
    ).length

  const totalReceivable =
    vigentes.reduce(
      (sum, sale) =>
        sum +
        getSaleBalance(sale),
      0
    )

  const getStatusBadge = (sale) => {
    if (esVentaAnulada(sale)) {
      return <StatusBadge variante="neutral">Anulada</StatusBadge>
    }

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

          <option value="anuladas">
            Anuladas
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

                      {sale.anulacion && (
                        <span className="sale-anulacion">
                          Anulada el {sale.anulacion.fecha} por {sale.anulacion.usuarioNombre}
                          {sale.anulacion.usuarioRol === "admin" ? " (administrador)" : " (vendedor)"}
                          {" · "}
                          {sale.anulacion.motivo}
                          {!isCreditSale(sale) && ` · ${textoDelTratamiento(sale.anulacion.tratamientoDinero)}`}
                        </span>
                      )}

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

                    {puedeVerAnular(sale, quienAnula) && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        aria-label={`Anular ${sale.invoiceNumber}`}
                        onClick={() => setPorAnular(sale)}
                      >
                        Anular
                      </button>
                    )}

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

      {/*
        FACTURA O DOCUMENTO INTERNO

        El título de la ventana, el del trabajo de impresión y el nombre del
        PDF siguen la misma regla que la cabecera del documento: un archivo
        llamado «Factura-VTA-000009.pdf» afirma por sí solo algo que no es
        cierto, y el nombre del archivo sobrevive a la pantalla.
      */}
      <DocumentPreviewModal
        open={
          !!selectedSale
        }
        title={
          selectedSale
            ? `${nombreDelDocumento(selectedSale)} ${selectedSale.invoiceNumber}`
            : "Documento"
        }
        fileName={`${
          selectedSale
            ? nombreDelDocumento(selectedSale)
            : "Documento"
        }-${selectedSale?.invoiceNumber || "documento"}.pdf`}
        printTitle={
          selectedSale
            ? `${nombreDelDocumento(selectedSale)} ${selectedSale.invoiceNumber}`
            : "Documento"
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

      {porAnular && (
        <AnularVentaModal
          venta={porAnular}
          ubicacion={nombreDeUbicacion(porAnular.locationId)}
          moneda={currency}
          razon={razonParaNoAnular(porAnular, quienAnula)}
          onCerrar={() => setPorAnular(null)}
          onAnulada={alAnular}
        />
      )}

    </div>
  )
}

export default SalesHistory