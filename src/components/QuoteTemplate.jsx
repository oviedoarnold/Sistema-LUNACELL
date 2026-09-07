
import { formatMoney } from "../utils/format"
/*
  Sin datos de la ferretería el encabezado sale vacío, y así debe ser: el
  sistema se vende a varias, y un documento con el nombre y la dirección de
  otra es peor que un documento incompleto.
*/
const DEFAULT_COMPANY = {
  name: "",
  address: "",
  phone: "",
  currency: "L",
  taxRate: 15,
}


function formatDate(date) {
  if (!date) return ""

  /*
   * Si recibimos YYYY-MM-DD,
   * agregamos la hora para evitar
   * problemas de zona horaria.
   */
  if (
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return new Date(
      `${date}T00:00:00`
    ).toLocaleDateString("es-HN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  return date
}

function QuoteTemplate({ quote }) {
  if (!quote) return null

  const company = {
    ...DEFAULT_COMPANY,
    ...(quote.company || {}),
  }

  const items = quote.items || []

  const clientName =
    quote.clientName ||
    quote.customerName ||
    quote.customer ||
    "Cliente General"

  const includeTax =
    quote.includeTax !== false

  const taxRate = Number(
    quote.taxRate ??
      company.taxRate ??
      15
  )

  return (
    <div className="receipt document-letter">
      {/* ENCABEZADO */}
      <div className="inv-header">
        <div className="inv-header-left">
          <div className="inv-logo">
            🔧
          </div>

          <div>
            <div className="inv-company-name">
              {company.name}
            </div>

            <div className="inv-company-addr">
              {company.address}

              <br />

              Tel: {company.phone}
            </div>
          </div>
        </div>

        <div className="inv-doc-type">
          <div
            className="inv-doc-label"
            style={{
              color: "#D8B4FF",
            }}
          >
            COTIZACIÓN
          </div>

          <div
            className="inv-doc-num"
            style={{
              color: "#C4A0FF",
            }}
          >
            {quote.quoteNumber ||
              "VISTA PREVIA"}
          </div>
        </div>
      </div>

      {/* FRANJA MORADA */}
      <div
        className="inv-stripe"
        style={{
          background:
            "linear-gradient(90deg, var(--purple) 0%, #9B59B6 100%)",
        }}
      />

      {/* DATOS */}
      <div className="inv-meta">
        <div className="inv-meta-block">
          <div className="inv-meta-label">
            Detalle de cotización
          </div>

          <div className="inv-meta-row">
            <span>Fecha</span>

            <b>
              {quote.date ||
                new Date().toLocaleDateString(
                  "es-HN"
                )}
            </b>
          </div>

          {quote.validity && (
            <div className="inv-meta-row">
              <span>
                Válida hasta
              </span>

              <b>
                {formatDate(
                  quote.validity
                )}
              </b>
            </div>
          )}

          <div className="inv-meta-row">
            <span>
              ISV incluido
            </span>

            <b>
              {includeTax
                ? "Sí"
                : "No"}
            </b>
          </div>
        </div>

        <div className="inv-meta-block">
          <div className="inv-meta-label">
            Cliente
          </div>

          <div className="inv-client-name">
            {clientName}
          </div>

          {(quote.clientPhone ||
            quote.clientAddress) && (
            <div className="inv-client-detail">
              {quote.clientPhone ||
                ""}

              {quote.clientPhone &&
                quote.clientAddress && (
                  <br />
                )}

              {quote.clientAddress ||
                ""}
            </div>
          )}

          {quote.rtn && (
            <div
              className="inv-meta-row"
              style={{
                marginTop: 6,
              }}
            >
              <span>RTN</span>

              <b>{quote.rtn}</b>
            </div>
          )}

          {quote.notes && (
            <div
              className="inv-client-detail"
              style={{
                marginTop: 6,
              }}
            >
              <b
                style={{
                  fontSize:
                    "10.5px",
                  color:
                    "var(--steel)",
                }}
              >
                Observaciones:
              </b>

              <br />

              {quote.notes}
            </div>
          )}
        </div>
      </div>

      {/* PRODUCTOS */}
      <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th>
                Producto
              </th>

              <th className="r">
                Cant.
              </th>

              <th className="r">
                Precio unit.
              </th>

              <th className="r">
                Subtotal
              </th>
            </tr>
          </thead>

          <tbody>
            {items.map(
              (item, index) => {
                const quantity =
                  Number(
                    item.qty ??
                      item.quantity ??
                      1
                  )

                const price =
                  Number(
                    item.price || 0
                  )

                const lineSubtotal =
                  Number(
                    item.subtotal ??
                      quantity *
                        price
                  )

                return (
                  <tr
                    key={
                      item.productId ??
                      item.id ??
                      `${item.name}-${index}`
                    }
                  >
                    <td>
                      <span className="prod-name">
                        {item.name}
                      </span>

                      {item.code && (
                        <span className="prod-code">
                          {item.code}
                        </span>
                      )}
                    </td>

                    <td className="r">
                      {quantity}
                    </td>

                    <td className="r">
                      {formatMoney(
                        price,
                        company.currency
                      )}
                    </td>

                    <td className="r">
                      {formatMoney(
                        lineSubtotal,
                        company.currency
                      )}
                    </td>
                  </tr>
                )
              }
            )}
          </tbody>
        </table>
      </div>

      {/* TOTALES */}
      <div className="inv-totals">
        <div className="inv-totals-row">
          <span>
            Subtotal
          </span>

          <b>
            {formatMoney(
              quote.subtotal,
              company.currency
            )}
          </b>
        </div>

        {includeTax && (
          <div className="inv-totals-row">
            <span>
              ISV ({taxRate}%)
            </span>

            <b>
              {formatMoney(
                quote.tax,
                company.currency
              )}
            </b>
          </div>
        )}

        <div
          className="inv-grand"
          style={{
            borderTopColor:
              "var(--purple)",
          }}
        >
          <span>TOTAL</span>

          <b
            style={{
              color:
                "var(--purple)",
            }}
          >
            {formatMoney(
              quote.total,
              company.currency
            )}
          </b>
        </div>
      </div>

      {/* PIE */}
      <div className="inv-footer">
        <div className="inv-footer-msg">
          <b>
            Esta es una cotización,
            no una factura
          </b>

          No genera cargo ni
          descuenta inventario.
        </div>

        <span
          className="inv-footer-badge"
          style={{
            background:
              "var(--purple-light)",
            color:
              "var(--purple)",
          }}
        >
          {quote.quoteNumber ||
            "VISTA PREVIA"}
        </span>
      </div>
    </div>
  )
}

export default QuoteTemplate