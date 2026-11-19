import { useContext, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import Swal from "sweetalert2"
import { FaInbox } from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import InvoiceTemplate from "../components/InvoiceTemplate"
import DocumentPreviewModal from "../components/documents/DocumentPreviewModal"
import DetalleDePedido from "../components/pedidos/DetalleDePedido"
import FormularioDeCancelacion from "../components/pedidos/FormularioDeCancelacion"
import { SalesContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"
import { avisarCambioDePedidos } from "../hooks/useAvisosDePedidos"
import { useBloqueoDeActualizacion } from "../hooks/useBloqueoDeActualizacion"
import { useSinConexion } from "../hooks/useSinConexion"
import {
  ESTADOS_DE_PEDIDO,
  cancelarPedido,
  facturarPedido,
  marcarPedidoLeido,
  recibirProductosDelPedido,
  reembolsarAlCliente,
  rechazarPedido,
  resolverPedido,
  traerBandeja,
  traerCancelacion,
  traerDetalleDePedido,
} from "../lib/api/pedidos"
import { fechaYHora, formatMoney } from "../utils/format"
import { claveDeIdempotencia } from "../utils/ids"
import { CERRAR_SIN_REINTENTAR, textoSinRespuesta } from "../utils/sinRespuesta"
import "../styles/pedidos.css"

/*
  Pedidos interubicación: los que llegan a la ubicación del usuario para
  facturar, y los que salieron de ella.

  Abrir un pedido marca su aviso como leído; eso no lo factura ni cambia su
  estado. Facturar, rechazar y resolver los decide y los hace el servidor, una
  sola vez. Todo necesita conexión.
*/

const VISTAS = [
  { id: "recibidos", etiqueta: "Recibidos" },
  { id: "enviados", etiqueta: "Enviados" },
]

const FILTROS = [
  { id: "pendiente", etiqueta: "Pendientes" },
  { id: "facturado", etiqueta: "Facturados" },
  { id: "por_resolver", etiqueta: "Por resolver" },
  { id: "cancelado", etiqueta: "Cancelados" },
  { id: "todos", etiqueta: "Todos" },
]

const CLASE_DEL_ESTADO = {
  pendiente: "badge badge-low",
  facturado: "badge badge-paid",
  por_resolver: "badge badge-out",
  cancelado: "badge badge-neutral",
}

/*
  Lo que se dice antes de facturar. Con un pago parcial, el resumen completo:
  la factura es por el total y ese pago ya está aplicado, no se cobra otra vez.
  Sin anticipo, la confirmación breve de siempre.
*/
function textoDeLaConfirmacion(pedido, dondeFactura = pedido.destino) {
  const factura = `Se emitirá una factura de ${dondeFactura} por ${formatMoney(pedido.total)} a nombre de ${pedido.cliente}. El inventario ya salió de ${pedido.origen}.`

  if (pedido.formaPago !== "credito" || !(pedido.cobrado > 0)) return factura

  return `Total del pedido: ${formatMoney(pedido.total)}. Pago recibido en ${pedido.origen}: ${formatMoney(pedido.cobrado)}. Saldo pendiente del cliente: ${formatMoney(pedido.saldo)}. ${factura} El pago ya recibido no se cobra otra vez.`
}

// Facturar en origen: lo mismo, y que no queda nada por liquidar con quien lo rechazó.
const textoDeFacturarEnOrigen = (pedido) =>
  `${textoDeLaConfirmacion(pedido, pedido.origen)} ${pedido.origen} cobró y factura: no queda nada que liquidar con ${pedido.destino}.`

/*
  Sin respuesta del servidor, la operación pudo hacerse o no. Se ofrece
  reintentar con la misma clave, que nunca la repite. null si se desiste.
*/
async function conReintento(llamada, queSePudoHacer) {
  for (;;) {
    try {
      return await llamada()
    } catch (problema) {
      if (problema.motivo !== "sin-respuesta") throw problema

      const otraVez = await Swal.fire({
        icon: "warning",
        title: "No hubo respuesta del servidor",
        text: textoSinRespuesta(`${queSePudoHacer} Reintentar es seguro: el servidor no lo hace dos veces.`),
        showCancelButton: true,
        confirmButtonText: "Reintentar",
        cancelButtonText: CERRAR_SIN_REINTENTAR,
      })

      if (!otraVez.isConfirmed) return null
    }
  }
}

function etiquetaDeLaRuta(pedido) {
  if (pedido.origenId === pedido.destinoId) return `Facturado en ${pedido.origen}`
  if (pedido.estado === "por_resolver") return `${pedido.origen} → rechazado por ${pedido.destino}`

  return `${pedido.origen} → ${pedido.destino}`
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

  // La operación en curso: facturar, rechazar, reenviar, facturar_en_origen o las de cancelación.
  const [operando, setOperando] = useState(null)

  // El formulario de cancelación abierto: {modo, clave}. La clave es la del intento: se reusa al reintentar.
  const [formulario, setFormulario] = useState(null)

  // Ni una operación ni un formulario a medio llenar se interrumpen por actualizar.
  useBloqueoDeActualizacion(Boolean(operando || formulario), "operacion-de-pedido")
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
  const [cargado, setCargado] = useState({ clave: null, pedido: null, cancelacion: null, error: "" })

  useEffect(() => {
    if (!claveDetalle) return undefined

    let vigente = true

    // La cancelación es aparte: si no se puede leer, el pedido se ve igual, sin sus acciones.
    Promise.all([traerDetalleDePedido(abiertoId), traerCancelacion(abiertoId).catch(() => null)]).then(
      ([pedido, cancelacion]) => {
        if (!vigente) return

        setCargado({ clave: claveDetalle, pedido, cancelacion, error: "" })

        if (!pedido.leido && !soloLectura) {
          marcarPedidoLeido(pedido.id).then(() => {
            avisarCambioDePedidos()
            setLista((actual) => ({ ...actual, pedidos: actual.pedidos.map((p) => (p.id === pedido.id ? { ...p, leido: true } : p)) }))
          }, () => {})
        }
      },
      (problema) => vigente && setCargado({ clave: claveDetalle, pedido: null, cancelacion: null, error: problema.message })
    )

    return () => {
      vigente = false
    }
  }, [claveDetalle, abiertoId, soloLectura])

  const detalleVigente = claveDetalle !== null && cargado.clave === claveDetalle
  const detalle = detalleVigente ? cargado.pedido : null
  const cancelacion = detalleVigente ? cargado.cancelacion : null
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
  const cerrar = () => {
    setAbiertoId(null)
    setFormulario(null)
  }

  /*
    Todas las operaciones siguen el mismo camino: una a la vez, con reintento
    seguro, avisando a la campanita y cerrando el pedido al terminar. Si el
    servidor la rechaza, se dice por qué y se vuelve a cargar el pedido.
  */
  const operar = async (tipo, { llamada, sinRespuesta, tituloDelError, alTerminar, cerrarAlTerminar = true }) => {
    setOperando(tipo)

    try {
      const resultado = await conReintento(llamada, sinRespuesta)

      if (!resultado) return

      avisarCambioDePedidos()
      setVersionLista((v) => v + 1)

      // Al cancelar, recibir o reembolsar, el pedido sigue abierto con lo que queda pendiente.
      if (cerrarAlTerminar) cerrar()
      else setVersionDetalle((v) => v + 1)

      await alTerminar(resultado)
    } catch (problema) {
      Swal.fire({ icon: "error", title: tituloDelError, text: problema.message })
      setVersionDetalle((v) => v + 1)
    } finally {
      setOperando(null)
    }
  }

  // La factura emitida: se refrescan las ventas y se muestra para imprimir.
  const mostrarFactura = async (resultado, yaEstaba) => {
    await refrescarVentas?.().catch(() => {})
    setFacturaId(resultado.ventaId)

    Swal.fire({
      icon: yaEstaba ? "info" : "success",
      title: yaEstaba ? "El pedido ya estaba facturado" : `Factura ${resultado.numeroFactura}`,
      text: yaEstaba
        ? `Otro dispositivo lo facturó antes: ${resultado.numeroFactura}. No se emitió otra factura.`
        : `Pedido ${resultado.numero} facturado en ${resultado.destino}. No se descontó inventario ni se cobró de nuevo.`,
    })
  }

  const facturar = async () => {
    if (!detalle || operando) return

    const confirmacion = await Swal.fire({
      icon: "question",
      title: `¿Facturar el pedido ${detalle.numero}?`,
      text: textoDeLaConfirmacion(detalle),
      showCancelButton: true,
      confirmButtonText: "Facturar",
      cancelButtonText: "Volver",
    })

    if (!confirmacion.isConfirmed) return

    await operar("facturar", {
      llamada: () => facturarPedido(detalle.id),
      sinRespuesta: "La factura pudo haberse emitido o no.",
      tituloDelError: "No se pudo facturar",
      alTerminar: (resultado) => mostrarFactura(resultado, resultado.yaFacturado),
    })
  }

  const rechazar = async () => {
    if (!detalle || operando) return

    const respuesta = await Swal.fire({
      icon: "warning",
      title: `¿Rechazar el pedido ${detalle.numero}?`,
      text: `Volverá a ${detalle.origen} para que decida quién lo factura. No se devuelve inventario ni dinero y no se emite factura.`,
      input: "textarea",
      inputLabel: "Motivo del rechazo",
      inputPlaceholder: `Por ejemplo: este cliente se factura en ${detalle.origen}`,
      inputAttributes: { maxlength: "500", "aria-label": "Motivo del rechazo" },
      inputValidator: (valor) => ((valor || "").trim().length < 5 ? "Escribe el motivo (al menos 5 caracteres)." : undefined),
      showCancelButton: true,
      confirmButtonText: "Rechazar pedido",
      cancelButtonText: "Volver",
    })

    if (!respuesta.isConfirmed) return

    const motivo = respuesta.value.trim()
    const clave = claveDeIdempotencia()

    await operar("rechazar", {
      llamada: () => rechazarPedido(detalle.id, motivo, clave),
      sinRespuesta: "El rechazo pudo haberse registrado o no.",
      tituloDelError: "No se pudo rechazar",
      alTerminar: (resultado) =>
        Swal.fire({
          icon: "success",
          title: `Pedido ${resultado.numero} rechazado`,
          text: `${resultado.origen} recibió el aviso para resolverlo. No se movió inventario ni dinero.`,
        }),
    })
  }

  const reenviar = async () => {
    if (!detalle || operando) return

    const respuesta = await Swal.fire({
      icon: "question",
      title: `¿A qué ubicación se envía el pedido ${detalle.numero}?`,
      text: `El mismo pedido queda pendiente de facturar en la ubicación que elijas. No se descuenta inventario ni se cobra otra vez. El efectivo cobrado en ${detalle.origen} se le deberá a esa ubicación.`,
      input: "select",
      inputOptions: Object.fromEntries(detalle.destinosParaReenviar.map((d) => [d.id, d.nombre])),
      inputPlaceholder: "Elige la ubicación",
      inputAttributes: { "aria-label": "Ubicación que facturará el pedido" },
      inputValidator: (valor) => (valor ? undefined : "Elige la ubicación que facturará el pedido."),
      showCancelButton: true,
      confirmButtonText: "Enviar pedido",
      cancelButtonText: "Volver",
    })

    if (!respuesta.isConfirmed) return

    const destinoId = respuesta.value
    const clave = claveDeIdempotencia()

    await operar("reenviar", {
      llamada: () => resolverPedido(detalle.id, { decision: "reenviar", destinoId }, clave),
      sinRespuesta: "El envío pudo haberse registrado o no.",
      tituloDelError: "No se pudo enviar el pedido",
      alTerminar: (resultado) =>
        Swal.fire({
          icon: "success",
          title: `Pedido enviado a ${resultado.destino}`,
          text: `${resultado.numero} quedó pendiente de facturar en ${resultado.destino}, que recibió el aviso. No se descontó inventario ni se cobró de nuevo.`,
        }),
    })
  }

  const facturarEnOrigen = async () => {
    if (!detalle || operando) return

    const confirmacion = await Swal.fire({
      icon: "question",
      title: `¿Facturar el pedido ${detalle.numero} en ${detalle.origen}?`,
      text: textoDeFacturarEnOrigen(detalle),
      showCancelButton: true,
      confirmButtonText: `Facturar en ${detalle.origen}`,
      cancelButtonText: "Volver",
    })

    if (!confirmacion.isConfirmed) return

    const clave = claveDeIdempotencia()

    await operar("facturar_en_origen", {
      llamada: () => resolverPedido(detalle.id, { decision: "facturar_en_origen" }, clave),
      sinRespuesta: "La factura pudo haberse emitido o no.",
      tituloDelError: "No se pudo facturar",
      alTerminar: (resultado) => mostrarFactura(resultado, resultado.repetido),
    })
  }

  /*
    Cancelar, recibir o reembolsar (0049). El formulario reúne todo y aquí se
    envía con la clave de ese formulario: un reintento sin respuesta la repite
    y el servidor no hace nada dos veces. Varios medios devueltos a la vez van
    uno por uno, cada uno con su propia clave derivada.
  */
  const abrirFormulario = (modo) => setFormulario({ modo, clave: claveDeIdempotencia() })

  const enviarFormulario = async (datos) => {
    if (!detalle || !formulario || operando) return

    const { modo, clave } = formulario
    const numero = detalle.numero
    const acciones = {
      cancelar: {
        llamada: () => cancelarPedido(detalle.id, datos, clave),
        sinRespuesta: "La cancelación pudo haberse registrado o no.",
        tituloDelError: "No se pudo cancelar",
        exito: `Pedido ${numero} cancelado`,
      },
      recibir: {
        llamada: () => recibirProductosDelPedido(detalle.id, datos.recepcion, clave),
        sinRespuesta: "La recepción pudo haberse registrado o no.",
        tituloDelError: "No se pudo registrar la recepción",
        exito: "Productos recibidos registrados",
      },
      reembolsar: {
        llamada: async () => {
          for (const [i, reembolso] of datos.reembolsos.entries()) await reembolsarAlCliente(detalle.id, reembolso, `${clave}-${i}`)

          return { repetido: false }
        },
        sinRespuesta: "El reembolso pudo haberse registrado o no.",
        tituloDelError: "No se pudo registrar el reembolso",
        exito: "Reembolso registrado",
      },
    }[modo]

    await operar(modo, {
      llamada: acciones.llamada,
      sinRespuesta: acciones.sinRespuesta,
      tituloDelError: acciones.tituloDelError,
      cerrarAlTerminar: false,
      alTerminar: () => {
        setFormulario(null)
        Swal.fire({ icon: "success", title: acciones.exito, text: "Lo que quede pendiente se puede completar desde este mismo pedido." })
      },
    })
  }

  const factura = facturaId ? getSaleById?.(facturaId) : null

  return (
    <div className="view active crud pedidos">
      <PageHeader descripcion="Pedidos que otra ubicación entregó para que esta los facture, y los que salieron de aquí." />

      {sinConexion && (
        <p className="alert-banner" role="alert">
          Sin conexión con el servidor. Los pedidos se revisan, se facturan, se rechazan, se resuelven y se cancelan con conexión, y también
          así se registran los productos devueltos y los reembolsos.
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
          {pedidos.map((pedido) => {
            // Nuevo: el pendiente que llegó aquí, o el rechazado que volvió aquí.
            const nuevo =
              !pedido.leido &&
              ((vista === "recibidos" && pedido.estado === "pendiente") || (vista === "enviados" && pedido.estado === "por_resolver"))

            return (
              <li key={pedido.id}>
                <button
                  type="button"
                  className={nuevo ? "pedidos-tarjeta is-nuevo" : "pedidos-tarjeta"}
                  onClick={() => abrir(pedido.id)}
                  aria-label={`Abrir el pedido ${pedido.numero} de ${pedido.cliente}`}
                >
                  <span className="pedidos-tarjeta-fila">
                    <b>{pedido.numero}</b>
                    <span className="pedidos-insignias">
                      {nuevo && <span className="badge badge-credit">Nuevo</span>}
                      <span className={CLASE_DEL_ESTADO[pedido.estado] || "badge"}>{ESTADOS_DE_PEDIDO[pedido.estado] || pedido.estado}</span>
                    </span>
                  </span>
                  <span className="pedidos-tarjeta-fila">
                    <span className="pedidos-cliente">{pedido.cliente}</span>
                    <span className="pos-importe">{formatMoney(pedido.total)}</span>
                  </span>
                  {pedido.estado === "cancelado" && (
                    // Cancelado: lo pagado es historia y ya no se le cobra nada al cliente.
                    <span className="pedidos-tarjeta-fila pedidos-tarjeta-suave">
                      <span>{pedido.cobrado > 0 ? `Pagado antes de cancelar ${formatMoney(pedido.cobrado)} en ${pedido.origen}` : "Sin pagos recibidos"}</span>
                      <span>Sin saldo por cobrar</span>
                    </span>
                  )}
                  {pedido.estado !== "facturado" && pedido.estado !== "cancelado" && (
                    <span className="pedidos-tarjeta-fila pedidos-tarjeta-suave">
                      <span>
                        Pagado {formatMoney(pedido.cobrado)}
                        {pedido.cobrado > 0 ? ` en ${pedido.origen}` : ""}
                      </span>
                      <span>Pendiente {formatMoney(pedido.saldo)}</span>
                    </span>
                  )}
                  <span className="pedidos-tarjeta-fila pedidos-tarjeta-suave">
                    <span>
                      {etiquetaDeLaRuta(pedido)} · {pedido.formaPago === "credito" ? "Crédito" : "Contado"}
                      {pedido.numeroFactura ? ` · ${pedido.numeroFactura}` : ""}
                    </span>
                    <span>{fechaYHora(pedido.entregadoEn)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {abiertoId && formulario && detalle && cancelacion && (
        <FormularioDeCancelacion
          pedido={detalle}
          cancelacion={cancelacion}
          modo={formulario.modo}
          enviando={Boolean(operando)}
          onEnviar={enviarFormulario}
          onCerrar={() => setFormulario(null)}
        />
      )}

      {abiertoId && !(formulario && detalle && cancelacion) && (
        <DetalleDePedido
          pedido={detalle}
          cancelacion={cancelacion}
          onFormulario={abrirFormulario}
          cargando={cargandoDetalle}
          error={errorDetalle}
          operando={operando}
          sinConexion={sinConexion}
          onFacturar={facturar}
          onRechazar={rechazar}
          onReenviar={reenviar}
          onFacturarEnOrigen={facturarEnOrigen}
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
