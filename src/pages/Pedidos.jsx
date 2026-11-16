import { useContext, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import Swal from "sweetalert2"
import { FaInbox } from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import InvoiceTemplate from "../components/InvoiceTemplate"
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal"
import DetalleDePedido from "../components/pedidos/DetalleDePedido"
import { SalesContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"
import { avisarCambioDePedidos } from "../hooks/useAvisosDePedidos"
import { useSinConexion } from "../hooks/useSinConexion"
import { ESTADOS_DE_PEDIDO, facturarPedido, marcarPedidoLeido, traerBandeja, traerDetalleDePedido } from "../lib/api/pedidos"
import { fechaYHora, formatMoney } from "../utils/format"
import "../styles/pedidos.css"

/*
  Pedidos interubicación: los que llegan a la ubicación del usuario para
  facturar, y los que salieron de ella.

  Abrir un pedido marca su aviso como leído; eso no lo factura ni cambia su
  estado. Facturar lo decide y lo hace el servidor, una sola vez. Todo necesita
  conexión.
*/

const VISTAS = [
  { id: "recibidos", etiqueta: "Recibidos" },
  { id: "enviados", etiqueta: "Enviados" },
]

const FILTROS = [
  { id: "pendiente", etiqueta: "Pendientes" },
  { id: "facturado", etiqueta: "Facturados" },
  { id: "por_resolver", etiqueta: "Rechazados" },
  { id: "todos", etiqueta: "Todos" },
]

const CLASE_DEL_ESTADO = {
  pendiente: "badge badge-low",
  facturado: "badge badge-paid",
  por_resolver: "badge badge-out",
  cancelado: "badge badge-neutral",
}

function Pedidos() {
  const { user, soloLectura } = useAuth()
  const { refrescarVentas, getSaleById } = useContext(SalesContext)
  const sinConexionCtx = useSinConexion()
  const sinConexion =
    Boolean(user?.sinConexion) || sinConexionCtx?.conexion === "sin_red" || sinConexionCtx?.conexion === "sin_servidor"

  const [parametros, setParametros] = useSearchParams()
  const [vista, setVista] = useState("recibidos")
  const [estado, setEstado] = useState("pendiente")
  const [facturando, setFacturando] = useState(false)
  const [facturaId, setFacturaId] = useState(null)

  /*
    La lista. La respuesta se guarda con la consulta que la pidió: una que
    llegue tarde, con otro filtro ya elegido, no pisa la nueva.
  */
  const [versionLista, setVersionLista] = useState(0)
  const claveLista = `${vista}|${estado}|${versionLista}`
  const [lista, setLista] = useState({ clave: null, pedidos: [], error: "" })

  useEffect(() => {
    let vigente = true

    traerBandeja({ vista, estado }).then(
      (pedidos) => vigente && setLista({ clave: claveLista, pedidos, error: "" }),
      (problema) => vigente && setLista({ clave: claveLista, pedidos: [], error: problema.message })
    )

    return () => {
      vigente = false
    }
  }, [claveLista, vista, estado])

  const cargando = lista.clave !== claveLista
  const pedidos = lista.pedidos
  const error = cargando ? "" : lista.error

  /*
    El pedido abierto. Abrirlo marca su aviso como leído: eso no lo factura ni
    cambia su estado. El contador solo consulta, así que no marca nada.
  */
  const [abiertoId, setAbiertoId] = useState(null)
  const [versionDetalle, setVersionDetalle] = useState(0)
  const claveDetalle = abiertoId ? `${abiertoId}|${versionDetalle}` : null
  const [cargado, setCargado] = useState({ clave: null, pedido: null, error: "" })

  useEffect(() => {
    if (!claveDetalle) return undefined

    let vigente = true

    traerDetalleDePedido(abiertoId).then(
      (pedido) => {
        if (!vigente) return

        setCargado({ clave: claveDetalle, pedido, error: "" })

        if (!pedido.leido && !soloLectura) {
          marcarPedidoLeido(pedido.id).then(() => {
            avisarCambioDePedidos()
            setLista((actual) => ({ ...actual, pedidos: actual.pedidos.map((p) => (p.id === pedido.id ? { ...p, leido: true } : p)) }))
          }, () => {})
        }
      },
      (problema) => vigente && setCargado({ clave: claveDetalle, pedido: null, error: problema.message })
    )

    return () => {
      vigente = false
    }
  }, [claveDetalle, abiertoId, soloLectura])

  const detalleVigente = claveDetalle !== null && cargado.clave === claveDetalle
  const detalle = detalleVigente ? cargado.pedido : null
  const cargandoDetalle = claveDetalle !== null && !detalleVigente
  const errorDetalle = detalleVigente ? cargado.error : ""

  // Desde la campanita: /pedidos?pedido=… abre ese pedido.
  const pedidoDelEnlace = parametros.get("pedido")

  if (pedidoDelEnlace && pedidoDelEnlace !== abiertoId) {
    setAbiertoId(pedidoDelEnlace)
  }

  useEffect(() => {
    if (pedidoDelEnlace) setParametros({}, { replace: true })
  }, [pedidoDelEnlace, setParametros])

  const abrir = (id) => setAbiertoId(id)
  const cerrar = () => setAbiertoId(null)

  const facturar = async () => {
    if (!detalle || facturando) return

    const confirmacion = await Swal.fire({
      icon: "question",
      title: `¿Facturar el pedido ${detalle.numero}?`,
      text: `Se emitirá una factura de ${detalle.destino} por ${formatMoney(detalle.total)} a nombre de ${detalle.cliente}. El inventario ya salió de ${detalle.origen}.`,
      showCancelButton: true,
      confirmButtonText: "Facturar",
      cancelButtonText: "Cancelar",
    })

    if (!confirmacion.isConfirmed) return

    setFacturando(true)

    try {
      let resultado

      for (;;) {
        try {
          resultado = await facturarPedido(detalle.id)
          break
        } catch (problema) {
          if (problema.motivo !== "sin-respuesta") throw problema

          const otraVez = await Swal.fire({
            icon: "warning",
            title: "No hubo respuesta del servidor",
            text: "La factura pudo haberse emitido o no. Reintentar es seguro: este pedido nunca se factura dos veces.",
            showCancelButton: true,
            confirmButtonText: "Reintentar",
            cancelButtonText: "Cancelar",
          })

          if (!otraVez.isConfirmed) return
        }
      }

      avisarCambioDePedidos()
      await refrescarVentas?.().catch(() => {})
      cerrar()
      setVersionLista((v) => v + 1)
      setFacturaId(resultado.ventaId)

      Swal.fire({
        icon: resultado.yaFacturado ? "info" : "success",
        title: resultado.yaFacturado ? `El pedido ya estaba facturado` : `Factura ${resultado.numeroFactura}`,
        text: resultado.yaFacturado
          ? `Otro dispositivo lo facturó antes: ${resultado.numeroFactura}. No se emitió otra factura.`
          : `Pedido ${resultado.numero} facturado en ${resultado.destino}. No se descontó inventario ni se cobró de nuevo.`,
      })
    } catch (problema) {
      Swal.fire({ icon: "error", title: "No se pudo facturar", text: problema.message })
      setVersionDetalle((v) => v + 1)
    } finally {
      setFacturando(false)
    }
  }

  const factura = facturaId ? getSaleById?.(facturaId) : null

  return (
    <div className="view active crud pedidos">
      <PageHeader descripcion="Pedidos que otra ubicación entregó para que esta los facture, y los que salieron de aquí." />

      {sinConexion && (
        <p className="alert-banner" role="alert">
          Sin conexión con el servidor. Los pedidos se revisan y se facturan con conexión.
        </p>
      )}

      <div className="pedidos-controles">
        <div className="pay-toggle pedidos-vistas" role="group" aria-label="Qué pedidos ver">
          {VISTAS.map((v) => (
            <button key={v.id} type="button" className={vista === v.id ? "active" : ""} aria-pressed={vista === v.id} onClick={() => setVista(v.id)}>
              {v.etiqueta}
            </button>
          ))}
        </div>

        <label className="pedidos-filtro">
          <span>Estado</span>
          <select className="filter-select" value={estado} onChange={(evento) => setEstado(evento.target.value)}>
            {FILTROS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>

      {cargando && <p className="crud-cargando" role="status">Cargando pedidos…</p>}
      {error && <p className="alert-banner" role="alert">{error}</p>}

      {!cargando && !error && pedidos.length === 0 && (
        <EmptyState
          Icono={FaInbox}
          titulo="No hay pedidos con este filtro"
          descripcion={vista === "recibidos" ? "Los pedidos que otra ubicación entregue para facturar aquí aparecerán en esta lista." : "Los pedidos que entregues para otra ubicación aparecerán aquí."}
        />
      )}

      {pedidos.length > 0 && (
        <ul className="pedidos-lista">
          {pedidos.map((pedido) => (
            <li key={pedido.id}>
              <button
                type="button"
                className={!pedido.leido && vista === "recibidos" && pedido.estado === "pendiente" ? "pedidos-tarjeta is-nuevo" : "pedidos-tarjeta"}
                onClick={() => abrir(pedido.id)}
                aria-label={`Abrir el pedido ${pedido.numero} de ${pedido.cliente}`}
              >
                <span className="pedidos-tarjeta-fila">
                  <b>{pedido.numero}</b>
                  <span className="pedidos-insignias">
                    {!pedido.leido && vista === "recibidos" && pedido.estado === "pendiente" && <span className="badge badge-credit">Nuevo</span>}
                    <span className={CLASE_DEL_ESTADO[pedido.estado] || "badge"}>{ESTADOS_DE_PEDIDO[pedido.estado] || pedido.estado}</span>
                  </span>
                </span>
                <span className="pedidos-tarjeta-fila">
                  <span className="pedidos-cliente">{pedido.cliente}</span>
                  <span className="pos-importe">{formatMoney(pedido.total)}</span>
                </span>
                <span className="pedidos-tarjeta-fila pedidos-tarjeta-suave">
                  <span>
                    {pedido.origen} → {pedido.destino} · {pedido.formaPago === "credito" ? "Crédito" : "Contado"}
                    {pedido.numeroFactura ? ` · ${pedido.numeroFactura}` : ""}
                  </span>
                  <span>{fechaYHora(pedido.entregadoEn)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {abiertoId && (
        <DetalleDePedido
          pedido={detalle}
          cargando={cargandoDetalle}
          error={errorDetalle}
          facturando={facturando}
          sinConexion={sinConexion}
          onFacturar={facturar}
          onCerrar={cerrar}
        />
      )}

      <DocumentPreviewModal
        open={Boolean(factura)}
        title="Factura"
        fileName={`Factura-${factura?.invoiceNumber || "pedido"}.pdf`}
        printTitle="Factura"
        canExport
        onClose={() => setFacturaId(null)}
      >
        <InvoiceTemplate sale={factura} />
      </DocumentPreviewModal>
    </div>
  )
}

export default Pedidos
