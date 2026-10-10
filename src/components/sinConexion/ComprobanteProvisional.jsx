import { formatMoney } from "../../utils/format"
import { totalesDe } from "../../lib/sinConexion/venta"

/*
  El comprobante de una venta hecha sin conexión.

  NO es una factura ni un documento interno: el servidor todavía no la
  registró. Lleva el número provisional del teléfono (PROV-XXXX-000001),
  que no es fiscal y no gasta ningún correlativo, y nunca un CAI. El número
  definitivo lo asigna el servidor al sincronizar; si la venta va a
  conciliación, lo decide un administrador.

  Usa la misma estructura que la factura para imprimirse igual, con el
  aviso bien visible.
*/
const ETIQUETAS = {
  pendiente: "Pendiente de sincronizar",
  sincronizando: "Enviándose al servidor",
  registrada: "Registrada en el servidor",
  en_conciliacion: "En conciliación",
  error: "No aceptada por el servidor",
}

function ComprobanteProvisional({ venta, empresa = {}, vistaPrevia = false }) {
  if (!venta) return null

  const moneda = empresa.moneda || "L"
  const { subtotal, isv, total } = totalesDe(venta.renglones || [], venta.tasaIsv)
  const numero = vistaPrevia ? "VISTA PREVIA" : venta.numeroProvisional
  const fecha = venta.registradaEn ? new Date(venta.registradaEn).toLocaleString("es-HN") : ""

  return (
    <div className="receipt document-letter comprobante-provisional">
      <div className="inv-header">
        <div className="inv-header-left">
          <div className="inv-logo">📱</div>

          <div>
            <div className="inv-company-name">{empresa.nombre || ""}</div>

            <div className="inv-company-addr">
              {empresa.direccion || ""}
              {empresa.telefono && (
                <>
                  <br />
                  Tel: {empresa.telefono}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="inv-doc-type">
          <div className="inv-doc-label">COMPROBANTE PROVISIONAL</div>
          <div className="inv-doc-num">{numero}</div>
        </div>
      </div>

      <div className="inv-stripe" />

      <p className="comprobante-aviso" role="note">
        <b>No es una factura.</b> Venta guardada en este teléfono sin conexión. El número de factura lo asigna el
        servidor al sincronizar.
      </p>

      <div className="inv-meta">
        <div className="inv-meta-block">
          <div className="inv-meta-label">Detalle de la venta</div>

          <div className="inv-meta-row">
            <span>Fecha</span>
            <b>{fecha}</b>
          </div>

          <div className="inv-meta-row">
            <span>Forma de pago</span>
            <b>{venta.formaPago === "credito" ? "Crédito" : "Contado"}</b>
          </div>

          {venta.fechaVencimiento && (
            <div className="inv-meta-row">
              <span>Vencimiento</span>
              <b>{venta.fechaVencimiento}</b>
            </div>
          )}

          {!vistaPrevia && (
            <div className="inv-meta-row">
              <span>Estado</span>
              <b>{ETIQUETAS[venta.estado] || ETIQUETAS.pendiente}</b>
            </div>
          )}

          {venta.numeroFactura && (
            <div className="inv-meta-row">
              <span>Factura</span>
              <b>{venta.numeroFactura}</b>
            </div>
          )}
        </div>

        <div className="inv-meta-block">
          <div className="inv-meta-label">Cliente</div>
          <div className="inv-client-name">{venta.nombreCliente || "Consumidor Final"}</div>

          {venta.rtnComprador && (
            <div className="inv-meta-row">
              <span>RTN</span>
              <b>{venta.rtnComprador}</b>
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
            {(venta.renglones || []).map((r, indice) => (
              <tr key={`${r.producto_id}-${indice}`}>
                <td>
                  <span className="prod-name">{r.nombre}</span>
                  {r.codigo && <span className="prod-code">{r.codigo}</span>}
                </td>
                <td className="r">{r.cantidad}</td>
                <td className="r">{formatMoney(r.precio_unitario, moneda)}</td>
                <td className="r">{formatMoney(r.precio_unitario * r.cantidad, moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="inv-totals">
        <div className="inv-totals-row">
          <span>Subtotal</span>
          <b>{formatMoney(subtotal, moneda)}</b>
        </div>

        <div className="inv-totals-row">
          <span>ISV ({venta.tasaIsv}%)</span>
          <b>{formatMoney(isv, moneda)}</b>
        </div>

        <div className="inv-grand">
          <span>TOTAL COBRADO</span>
          <b>{formatMoney(total, moneda)}</b>
        </div>
      </div>

      <div className="inv-footer">
        <div className="inv-footer-msg">
          <b>Comprobante provisional sin valor fiscal.</b>
          Pida su factura cuando la venta se sincronice.
        </div>

        <span className="inv-footer-badge">{numero}</span>
      </div>
    </div>
  )
}

export default ComprobanteProvisional
