import { useState } from "react"
import { FaCheckCircle, FaClock, FaExclamationCircle, FaSync, FaBalanceScale } from "react-icons/fa"

import ModalShell from "../forms/ModalShell"
import StatusBadge from "../crud/StatusBadge"
import { formatMoney } from "../../utils/format"
import ModalDeRespaldo from "./ModalDeRespaldo"

/*
  Las ventas que este teléfono guardó sin conexión, con su estado real:

  - pendiente / sincronizando: solo están en el teléfono;
  - registrada: el servidor la registró, con su número de factura;
  - en conciliación: el servidor la guardó para que un administrador la
    revise (está a salvo, no hay que volver a hacerla);
  - error: el servidor no la aceptó tal como está; se reintenta con
    «Sincronizar ahora» o se entrega en un respaldo.

  Una venta pendiente nunca se muestra como registrada.
*/
const ESTADO_DE_VENTA = {
  pendiente: { texto: "Pendiente", variante: "low", Icono: FaClock },
  sincronizando: { texto: "Sincronizando", variante: "neutral", Icono: FaSync },
  registrada: { texto: "Registrada", variante: "ok", Icono: FaCheckCircle },
  en_conciliacion: { texto: "En conciliación", variante: "credit", Icono: FaBalanceScale },
  error: { texto: "Error", variante: "overdue", Icono: FaExclamationCircle },
}

const MOTIVOS = {
  "existencia-insuficiente": "No había existencia suficiente en el servidor.",
  "precio-distinto": "El precio o el impuesto cambiaron desde la venta.",
  "reloj-desfasado": "La hora del teléfono no coincidía con la del servidor.",
  "ubicacion-cambiada": "Tu ubicación cambió después de la venta.",
  "ubicacion-no-habilitada": "La ubicación ya no está habilitada para vender sin conexión.",
  "fecha-fuera-de-rango": "La venta es demasiado antigua o tiene una fecha imposible.",
  "usuario-inactivo": "Tu usuario estaba desactivado o con la contraseña por cambiar.",
  "sin-permiso": "Tu usuario ya no tiene permiso para facturar.",
  "cliente-invalido": "El cliente ya no existe.",
  "producto-invalido": "Uno de los productos ya no existe o está inactivo.",
  rescate: "Subida por un administrador desde un respaldo.",
}

function detalleDe(venta) {
  if (venta.estado === "registrada") {
    return venta.numeroFactura ? `Factura ${venta.numeroFactura}` : "Registrada"
  }

  if (venta.estado === "en_conciliacion") {
    return MOTIVOS[venta.motivo] || "Un administrador la revisará."
  }

  if (venta.estado === "error") {
    return venta.ultimoError?.mensaje || "El servidor no la aceptó."
  }

  if (venta.ultimoError?.mensaje) return `Último intento: ${venta.ultimoError.mensaje}`

  return venta.exportadaEn ? "Incluida en un respaldo cifrado." : "Solo en este teléfono."
}

function PanelDeVentasLocales({ estado, onCerrar, onVerComprobante }) {
  const [respaldoAbierto, setRespaldoAbierto] = useState(false)
  const { ventas, sinConfirmar, sincronizarAhora, sincronizando, exportarRespaldo } = estado
  const ordenadas = [...ventas].reverse()

  if (respaldoAbierto) {
    return <ModalDeRespaldo exportarRespaldo={exportarRespaldo} onCerrar={() => setRespaldoAbierto(false)} />
  }

  const acciones = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>
        Cerrar
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setRespaldoAbierto(true)} disabled={sinConfirmar === 0}>
        Respaldo cifrado
      </button>
      <button type="button" className="btn btn-primary" onClick={() => sincronizarAhora()} disabled={sincronizando}>
        {sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
      </button>
    </>
  )

  return (
    <ModalShell titulo="Ventas sin conexión de este teléfono" onCerrar={onCerrar} ancho="modal-lg" acciones={acciones}>
      {ordenadas.length === 0 ? (
        <p>No hay ventas sin conexión en este teléfono.</p>
      ) : (
        <div className="table-wrap">
          <table className="tabla-ventas-locales">
            <thead>
              <tr>
                <th scope="col">Comprobante</th>
                <th scope="col">Fecha</th>
                <th scope="col">Cliente</th>
                <th scope="col" className="r">
                  Total
                </th>
                <th scope="col">Estado</th>
                <th scope="col">Detalle</th>
                <th scope="col">
                  <span className="solo-lector">Acciones</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {ordenadas.map((venta) => {
                const { texto, variante, Icono } = ESTADO_DE_VENTA[venta.estado] || ESTADO_DE_VENTA.pendiente

                return (
                  <tr key={venta.clave}>
                    <td>{venta.numeroProvisional}</td>
                    <td>{new Date(venta.registradaEn).toLocaleString("es-HN")}</td>
                    <td>{venta.nombreCliente}</td>
                    <td className="r">{formatMoney(venta.totalCobrado)}</td>
                    <td>
                      <StatusBadge variante={variante} Icono={Icono}>
                        {texto}
                      </StatusBadge>
                    </td>
                    <td>{detalleDe(venta)}</td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onVerComprobante(venta)}>
                        Ver comprobante
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  )
}

export default PanelDeVentasLocales
