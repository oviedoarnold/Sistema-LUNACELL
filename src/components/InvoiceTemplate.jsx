import {
  getSalePaid,
  getSaleBalance,
} from "../utils/salesUtils"

import { formatDocumentNumber } from "../utils/fiscal"

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


function InvoiceTemplate({
  sale,
}) {
  if (!sale) return null

  const company = {
    ...DEFAULT_COMPANY,
    ...(sale.company || {}),
  }

  const items =
    sale.items ||
    sale.products ||
    []

  const clientName =
    sale.clientName ||
    sale.customerName ||
    sale.customer ||
    sale.client ||
    "Consumidor Final"

  const taxRate = Number(
    sale.taxRate ??
      company.taxRate ??
      15
  )

  const paymentType =
    sale.paymentType ||
    sale.type ||
    "contado"

  const status =
    sale.status ||
    (paymentType === "credito"
      ? "pendiente"
      : "pagada")

  const paid =
    getSalePaid(sale)

  const balance =
    getSaleBalance(sale)

  return (
    <div className="receipt document-letter">
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

              Tel:{" "}
              {company.phone}
            </div>
          </div>
        </div>

        <div className="inv-doc-type">
          <div className="inv-doc-label">
            FACTURA
          </div>

          <div className="inv-doc-num">
            {sale.invoiceNumber ||
              "VISTA PREVIA"}
          </div>
        </div>
      </div>

      <div className="inv-stripe" />

      <div className="inv-meta">
        <div className="inv-meta-block">
          <div className="inv-meta-label">
            Detalle de factura
          </div>

          <div className="inv-meta-row">
            <span>Fecha</span>

            <b>
              {sale.date ||
                new Date().toLocaleDateString(
                  "es-HN"
                )}
            </b>
          </div>

          <div className="inv-meta-row">
            <span>
              Forma de pago
            </span>

            <b>
              {paymentType ===
              "credito"
                ? "Crédito"
                : "Contado"}
            </b>
          </div>

          {sale.dueDate && (
            <div className="inv-meta-row">
              <span>
                Vencimiento
              </span>

              <b>
                {sale.dueDate}
              </b>
            </div>
          )}

          <div className="inv-meta-row">
            <span>Estado</span>

            <b
              style={{
                color:
                  status ===
                  "pagada"
                    ? "var(--teal)"
                    : "var(--red)",
              }}
            >
              {status ===
              "pagada"
                ? "Pagada"
                : "Pendiente"}
            </b>
          </div>

          {sale.soldBy && (
            <div className="inv-meta-row">
              <span>
                Vendedor
              </span>

              <b>
                {sale.soldBy}
              </b>
            </div>
          )}
        </div>

        <div className="inv-meta-block">
          <div className="inv-meta-label">
            Cliente
          </div>

          <div className="inv-client-name">
            {clientName}
          </div>

          {(sale.clientPhone ||
            sale.clientAddress) && (
            <div className="inv-client-detail">
              {sale.clientPhone ||
                ""}

              {sale.clientPhone &&
                sale.clientAddress && (
                  <br />
                )}

              {sale.clientAddress ||
                ""}
            </div>
          )}

          {sale.rtn && (
            <div
              className="inv-meta-row"
              style={{
                marginTop: 6,
              }}
            >
              <span>RTN</span>

              <b>{sale.rtn}</b>
            </div>
          )}
        </div>
      </div>

      <div className="inv-table-wrap">
        <table className="inv-table">
        <thead>
  <tr>
    <th>Producto</th>
    <th className="r">Cant.</th>
    <th className="r">Precio unit.</th>
    <th className="r">Subtotal</th>
  </tr>
</thead>

<tbody>
  {items.map((item, index) => {
    const quantity = Number(
      item.qty ??
        item.quantity ??
        1
    )

    const price = Number(
      item.price || 0
    )

    const lineSubtotal = Number(
      item.subtotal ??
        quantity * price
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
  })}
</tbody>
        </table>
      </div>

      <div className="inv-totals">
        <div className="inv-totals-row">
          <span>
            Subtotal
          </span>

          <b>
            {formatMoney(
              sale.subtotal,
              company.currency
            )}
          </b>
        </div>

        <div className="inv-totals-row">
          <span>
            ISV ({taxRate}%)
          </span>

          <b>
            {formatMoney(
              sale.tax,
              company.currency
            )}
          </b>
        </div>

        <div className="inv-grand">
          <span>
            TOTAL A PAGAR
          </span>

          <b>
            {formatMoney(
              sale.total,
              company.currency
            )}
          </b>
        </div>

        {paid > 0 && (
          <>
            <div className="inv-totals-row">
              <span>
                Abonado
              </span>

              <b>
                {formatMoney(
                  paid,
                  company.currency
                )}
              </b>
            </div>

            <div className="inv-totals-row">
              <span>
                Saldo pendiente
              </span>

              <b>
                {formatMoney(
                  balance,
                  company.currency
                )}
              </b>
            </div>
          </>
        )}
      </div>

      {status ===
        "pendiente" && (
        <div className="inv-pending">
          PENDIENTE DE PAGO
        </div>
      )}

      {sale.fiscal && (
        <div className="inv-fiscal">
          <div className="inv-fiscal-row">
            <span>CAI</span>
            <b>{sale.fiscal.cai}</b>
          </div>

          {sale.fiscal.rtn && (
            <div className="inv-fiscal-row">
              <span>
                RTN del emisor
              </span>
              <b>
                {sale.fiscal.rtn}
              </b>
            </div>
          )}

          <div className="inv-fiscal-row">
            <span>
              Rango autorizado
            </span>
            <b>
              {formatDocumentNumber(
                sale.fiscal
                  .rangoDesde,
                sale.fiscal
              )}
              {" al "}
              {formatDocumentNumber(
                sale.fiscal
                  .rangoHasta,
                sale.fiscal
              )}
            </b>
          </div>

          <div className="inv-fiscal-row">
            <span>
              Fecha límite de emisión
            </span>
            <b>
              {
                sale.fiscal
                  .fechaLimiteEmision
              }
            </b>
          </div>
        </div>
      )}

      <div className="inv-footer">
        <div className="inv-footer-msg">
          <b>
            ¡Gracias por su
            compra!
          </b>

          Conserve esta factura
          como comprobante de
          pago.
        </div>

        <span className="inv-footer-badge">
          {sale.invoiceNumber ||
            "VISTA PREVIA"}
        </span>
      </div>
    </div>
  )
}

export default InvoiceTemplate