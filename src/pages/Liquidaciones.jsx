import { useState } from "react"
import Swal from "sweetalert2"
import { FaMoneyBillWave } from "react-icons/fa"

import EmptyState from "../components/crud/EmptyState"
import PageHeader from "../components/crud/PageHeader"
import RegistrarEntrega from "../components/liquidaciones/RegistrarEntrega"
import { useAuth } from "../hooks/useAuth"
import { useBloqueoDeActualizacion } from "../hooks/useBloqueoDeActualizacion"
import { useControlDeLiquidaciones } from "../hooks/useControlDeLiquidaciones"
import { useSinConexion } from "../hooks/useSinConexion"
import {
  ESTADO_DE_LIQUIDACION,
  ESTADO_DEL_PEDIDO,
  METODOS,
  confirmarLiquidacion,
  rechazarLiquidacion,
} from "../lib/api/liquidaciones"
import { fechaYHora, formatDateForDisplay, formatMoney } from "../utils/format"
import { etiquetaDelMedio } from "../utils/mediosDePago"
import "../styles/liquidaciones.css"

/*
  Control de las liquidaciones entre ubicaciones (0046).

  En un pedido, la ubicación que entrega cobra y otra factura. Lo cobrado en
  efectivo para la otra queda por liquidar desde el cobro; lo electrónico y su
  cargo llegan a la cuenta de la empresa y no se liquidan. La entrega va en dos
  pasos: quien debe la registra y quien recibe confirma haberla recibido.

  Desde la 0050 (C2b), en un pedido cancelado la deuda puede ir en cualquier
  sentido: la ubicación que conserva el efectivo le debe a la que se lo
  devolvió al cliente. Se paga igual, con una contraliquidación, y la
  liquidación original no cambia. No es una venta ni un cobro.

  Qué ve y qué puede hacer cada uno lo decide la base; esta pantalla solo
  dibuja los botones que la base dice que valen.
*/

const VISTAS = [
  { id: "saldos", etiqueta: "Saldos" },
  { id: "pedidos", etiqueta: "Pedidos" },
  { id: "historial", etiqueta: "Historial" },
]

/*
  Colores de estado: esperar una confirmación es normal (ámbar), confirmada o
  liquidada es bueno (verde) y solo un rechazo va en rojo.
*/
const CLASE_DEL_PEDIDO = {
  pendiente: "badge badge-low",
  parcial: "badge badge-credit",
  por_confirmar: "badge badge-low",
  liquidado: "badge badge-paid",
  sin_efectivo: "badge badge-neutral",
}

const CLASE_DE_LIQUIDACION = {
  por_confirmar: "badge badge-low",
  confirmada: "badge badge-paid",
  rechazada: "badge badge-out",
}

const TODAS = ""

const fechaCorta = (dia) => (dia ? formatDateForDisplay(new Date(`${dia}T12:00:00`)) : "")

// Las ubicaciones que aparecen como origen o destino, sin repetir.
function ubicacionesDe(lista, campoId, campoNombre) {
  const vistas = new Map()

  for (const fila of lista) vistas.set(fila[campoId], fila[campoNombre])

  return [...vistas].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
}

// Por qué una ubicación le debe a otra por ese pedido.
function textoDelMotivo(pedido) {
  if (pedido.motivo === "cancelacion") {
    return `Pedido cancelado: ${pedido.destino} devolvió al cliente efectivo que conserva ${pedido.origen}.`
  }

  return `${pedido.origen} cobró en efectivo un pedido que factura ${pedido.destino}.`
}

/*
  Una liquidación que otro ya resolvió —desde otro dispositivo, o un instante
  antes que este— se informa como lo que es: algo que ya pasó. Nunca como una
  confirmación nueva de quien está mirando, porque no movió dinero.
*/
function avisarYaResuelta(liquidacion) {
  const confirmada = liquidacion.estado === "confirmada"
  const quien = liquidacion.resueltaPor
    ? ` La ${confirmada ? "confirmó" : "rechazó"} ${liquidacion.resueltaPor}${liquidacion.resueltaEn ? ` el ${fechaYHora(liquidacion.resueltaEn)}` : ""}.`
    : ""

  return Swal.fire({
    icon: "info",
    title: `Esta liquidación ya fue ${confirmada ? "confirmada" : "rechazada"}`,
    text: `${liquidacion.numero}.${quien} No se registró ningún movimiento nuevo.`,
  })
}

function Cifra({ etiqueta, valor, destacada = false }) {
  return (
    <div className={destacada ? "liquidaciones-cifra is-destacada" : "liquidaciones-cifra"}>
      <span>{etiqueta}</span>
      <b className="pos-importe">{formatMoney(valor)}</b>
    </div>
  )
}

function Liquidaciones() {
  const { soloLectura } = useAuth()
  const sinConexionCtx = useSinConexion()
  const sinConexion = sinConexionCtx?.conexion === "sin_red" || sinConexionCtx?.conexion === "sin_servidor"

  const [vista, setVista] = useState("saldos")
  const [origen, setOrigen] = useState(TODAS)
  const [destino, setDestino] = useState(TODAS)
  const [registrando, setRegistrando] = useState(null)
  const [resolviendo, setResolviendo] = useState(null)

  // Confirmar o rechazar no se interrumpe por actualizar.
  useBloqueoDeActualizacion(Boolean(resolviendo), "liquidacion")

  /*
    Al día con lo que hacen otros dispositivos. Mientras se registra o se
    resuelve una entrega, la recarga automática espera: no cambia los datos
    debajo de una operación en curso. La pestaña y los filtros son estado de
    esta pantalla y una recarga no los toca.
  */
  const datos = useControlDeLiquidaciones({
    conConexion: !sinConexion,
    pausado: Boolean(registrando) || Boolean(resolviendo),
  })

  // Solo la primera vez: al recargar se siguen viendo los datos anteriores.
  const cargando = !datos.cargado
  const recargar = () => datos.recargar().catch(() => {})

  const delFiltro = (fila) => (!origen || fila.origenId === origen) && (!destino || fila.destinoId === destino)
  const pares = datos.pares.filter(delFiltro)
  const pedidos = datos.pedidos.filter(delFiltro)
  const liquidaciones = datos.liquidaciones.filter(delFiltro)
  const origenes = ubicacionesDe([...datos.pares, ...datos.liquidaciones], "origenId", "origen")
  const destinos = ubicacionesDe([...datos.pares, ...datos.liquidaciones], "destinoId", "destino")

  const total = (campo) => pares.reduce((suma, p) => suma + p[campo], 0)
  const porConfirmarAqui = datos.liquidaciones.filter((l) => l.puedeResolver).length
  const puedeOperar = !soloLectura && !sinConexion

  const alRegistrar = (liquidacion) => {
    setRegistrando(null)
    recargar()

    Swal.fire({
      icon: liquidacion.repetida ? "info" : "success",
      title: liquidacion.repetida ? "Esa entrega ya estaba registrada" : `Entrega ${liquidacion.numero} registrada`,
      text: `${formatMoney(liquidacion.monto)} quedan pendientes de confirmación por la ubicación que los recibe.`,
    })
  }

  /*
    El estado de la liquidación según la base, ahora: la pantalla pudo quedar
    abierta mientras otro dispositivo la resolvía. Sin respuesta se sigue con
    lo que se tenía, y decide la base, que resuelve una sola vez de forma
    atómica (`repetida` o LQ004).
  */
  const estadoActual = async (liquidacion) => {
    try {
      const control = await datos.recargar()

      return control.liquidaciones.find((l) => l.id === liquidacion.id) ?? liquidacion
    } catch {
      return liquidacion
    }
  }

  // Lo que decide quien resuelve: null si se arrepiente, o el motivo del rechazo.
  const pedirDecision = async (liquidacion, confirmar) => {
    if (confirmar) {
      const respuesta = await Swal.fire({
        icon: "question",
        title: `¿Confirmar ${liquidacion.numero}?`,
        text: `Confirmas que ${liquidacion.destino} recibió ${formatMoney(liquidacion.monto)} de ${liquidacion.origen}.`,
        showCancelButton: true,
        confirmButtonText: "Confirmar recepción",
        cancelButtonText: "Volver",
      })

      return respuesta?.isConfirmed ? { motivo: null } : null
    }

    const respuesta = await Swal.fire({
      icon: "warning",
      title: `¿Rechazar ${liquidacion.numero}?`,
      text: "El monto vuelve a quedar pendiente por liquidar. Escribe por qué se rechaza.",
      input: "textarea",
      inputPlaceholder: "Por ejemplo: el sobre traía 20 lempiras menos",
      inputValidator: (valor) => (valor?.trim().length >= 5 ? undefined : "Escribe el motivo (al menos 5 caracteres)."),
      showCancelButton: true,
      confirmButtonText: "Rechazar entrega",
      cancelButtonText: "Volver",
    })

    return respuesta?.isConfirmed ? { motivo: respuesta.value.trim() } : null
  }

  const resolver = async (liquidacion, confirmar) => {
    if (resolviendo) return

    // Desde aquí los botones quedan quietos y la recarga automática espera.
    setResolviendo(liquidacion.id)

    let envio = false

    try {
      const actual = await estadoActual(liquidacion)

      if (actual.estado !== "por_confirmar") {
        avisarYaResuelta(actual)

        return
      }

      const decision = await pedirDecision(actual, confirmar)

      if (!decision) return

      envio = true

      const resultado = confirmar ? await confirmarLiquidacion(actual.id) : await rechazarLiquidacion(actual.id, decision.motivo)

      if (resultado.repetida) {
        avisarYaResuelta(resultado)

        return
      }

      Swal.fire({
        icon: "success",
        title: resultado.estado === "confirmada" ? `${resultado.numero} confirmada` : `${resultado.numero} rechazada`,
        text: resultado.estado === "confirmada" ? "El monto pasa a liquidado." : "El monto vuelve a quedar pendiente por liquidar.",
      })
    } catch (problema) {
      // LQ004: se resolvió en el otro sentido. Se dice tal cual y se recarga.
      Swal.fire({ icon: "error", title: "No se pudo completar", text: problema.message })
    } finally {
      setResolviendo(null)

      if (envio) recargar()
    }
  }

  return (
    <div className="view active crud liquidaciones">
      <PageHeader descripcion="Lo que una ubicación le debe a otra por pedidos: el efectivo cobrado para quien factura y, en pedidos cancelados, el que otra ubicación devolvió al cliente. Lo electrónico llega a la cuenta de la empresa y no se liquida." />

      {sinConexion && (
        <p className="alert-banner" role="alert">
          Sin conexión con el servidor. Las liquidaciones se registran y se confirman con conexión.
        </p>
      )}

      {porConfirmarAqui > 0 && !soloLectura && (
        <p className="liquidaciones-aviso" role="status">
          Tienes {porConfirmarAqui === 1 ? "una entrega" : `${porConfirmarAqui} entregas`} por confirmar en el historial.
        </p>
      )}

      <div className="liquidaciones-controles">
        <div className="pay-toggle liquidaciones-vistas" role="group" aria-label="Qué ver">
          {VISTAS.map((v) => (
            <button key={v.id} type="button" className={vista === v.id ? "active" : ""} aria-pressed={vista === v.id} onClick={() => setVista(v.id)}>
              {v.etiqueta}
            </button>
          ))}
        </div>

        <div className="liquidaciones-filtros">
          <label>
            <span>Debe</span>
            <select className="filter-select" value={origen} onChange={(evento) => setOrigen(evento.target.value)} aria-label="Ubicación que debe y entrega">
              <option value={TODAS}>Todas</option>
              {origenes.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Recibe</span>
            <select className="filter-select" value={destino} onChange={(evento) => setDestino(evento.target.value)} aria-label="Ubicación que recibe">
              <option value={TODAS}>Todas</option>
              {destinos.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {cargando && <p className="crud-cargando" role="status">Cargando liquidaciones…</p>}
      {datos.error && <p className="alert-banner" role="alert">{datos.error}</p>}

      {!cargando && !datos.error && (
        <section className="liquidaciones-resumen" aria-label="Resumen">
          <Cifra etiqueta="Pendiente por liquidar" valor={total("pendiente")} destacada />
          <Cifra etiqueta="Pendiente de confirmación" valor={total("porConfirmar")} />
          <Cifra etiqueta="Liquidado" valor={total("liquidado")} />
          <Cifra etiqueta="En cuenta de la empresa" valor={total("electronico") + total("cargo")} />
        </section>
      )}

      {vista === "saldos" && !cargando && !datos.error && (
        pares.length === 0 ? (
          <EmptyState Icono={FaMoneyBillWave} titulo="No hay saldos entre ubicaciones" descripcion="Cuando una ubicación cobre un pedido que factura otra, el saldo aparecerá aquí." />
        ) : (
          <ul className="liquidaciones-lista">
            {pares.map((par) => (
              <li key={par.clave} className="liquidaciones-tarjeta">
                <div className="liquidaciones-tarjeta-fila">
                  <b>
                    {par.origen} → {par.destino}
                  </b>
                  {par.pendiente === 0 && par.porConfirmar === 0 && par.efectivo > 0 && <span className="badge badge-paid">Liquidado</span>}
                </div>
                <p className="liquidaciones-suave">
                  {par.origen} le debe a {par.destino}
                  {par.porCancelaciones ? " · incluye pedidos cancelados" : ""}
                </p>

                <div className="liquidaciones-cifras">
                  <Cifra etiqueta="Total a entregar" valor={par.efectivo} />
                  <Cifra etiqueta="Pendiente" valor={par.pendiente} destacada />
                  <Cifra etiqueta="Por confirmar" valor={par.porConfirmar} />
                  <Cifra etiqueta="Liquidado" valor={par.liquidado} />
                  <Cifra etiqueta="En cuenta de la empresa" valor={par.electronico + par.cargo} />
                </div>

                {par.puedeRegistrar && par.pendiente > 0 && puedeOperar && (
                  <button type="button" className="btn btn-primary liquidaciones-accion" onClick={() => setRegistrando(par)}>
                    Registrar entrega
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      {vista === "pedidos" && !cargando && !datos.error && (
        pedidos.length === 0 ? (
          <EmptyState Icono={FaMoneyBillWave} titulo="No hay pedidos cobrados con este filtro" descripcion="Aquí aparecen los pedidos cobrados por una ubicación y facturados por otra." />
        ) : (
          <ul className="liquidaciones-lista">
            {pedidos.map((pedido) => (
              <li key={pedido.clave} className="liquidaciones-tarjeta">
                <div className="liquidaciones-tarjeta-fila">
                  <b>{pedido.numero}</b>
                  <span className={CLASE_DEL_PEDIDO[pedido.estadoLiquidacion] || "badge"}>{ESTADO_DEL_PEDIDO[pedido.estadoLiquidacion] || pedido.estadoLiquidacion}</span>
                </div>
                <div className="liquidaciones-tarjeta-fila liquidaciones-suave">
                  <span>
                    {pedido.cliente} · {pedido.pedidoOrigen} → {pedido.pedidoDestino}
                    {pedido.estado === "cancelado" ? " · Cancelado" : pedido.numeroFactura ? ` · ${pedido.numeroFactura}` : " · Sin facturar"}
                  </span>
                  <span>{fechaYHora(pedido.entregadoEn)}</span>
                </div>
                <p className="liquidaciones-suave">
                  <b>
                    {pedido.origen} → {pedido.destino}
                  </b>{" "}
                  · {textoDelMotivo(pedido)}
                </p>
                <div className="liquidaciones-tarjeta-fila liquidaciones-suave">
                  <span>
                    {pedido.medios.map((m) => `${etiquetaDelMedio(m.medio)} ${formatMoney(m.monto)}${m.cargo > 0 ? ` + ${formatMoney(m.cargo)}` : ""}`).join(" · ")}
                  </span>
                </div>
                <div className="liquidaciones-cifras">
                  {/* Un pedido cancelado (0050) solo debe lo que otra ubicación devolvió al cliente con efectivo que conserva esta. */}
                  <Cifra etiqueta={pedido.motivo === "cancelacion" ? "Por la cancelación" : "Efectivo"} valor={pedido.efectivo} />
                  <Cifra etiqueta="Pendiente" valor={pedido.pendiente} destacada />
                  <Cifra etiqueta="Por confirmar" valor={pedido.porConfirmar} />
                  <Cifra etiqueta="Liquidado" valor={pedido.liquidado} />
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {vista === "historial" && !cargando && !datos.error && (
        liquidaciones.length === 0 ? (
          <EmptyState Icono={FaMoneyBillWave} titulo="Todavía no hay liquidaciones" descripcion="Las entregas registradas, confirmadas y rechazadas aparecerán aquí." />
        ) : (
          <ul className="liquidaciones-lista">
            {liquidaciones.map((l) => (
              <li key={l.id} className={l.puedeResolver ? "liquidaciones-tarjeta is-por-confirmar" : "liquidaciones-tarjeta"}>
                <div className="liquidaciones-tarjeta-fila">
                  <b>{l.numero}</b>
                  <span className="liquidaciones-insignias">
                    {l.contraliquidacion && <span className="badge badge-neutral">Contraliquidación</span>}
                    <span className={CLASE_DE_LIQUIDACION[l.estado] || "badge"}>{ESTADO_DE_LIQUIDACION[l.estado] || l.estado}</span>
                  </span>
                </div>
                <div className="liquidaciones-tarjeta-fila">
                  <span>
                    {l.origen} → {l.destino}
                  </span>
                  <b className="pos-importe">{formatMoney(l.monto)}</b>
                </div>
                <div className="liquidaciones-tarjeta-fila liquidaciones-suave">
                  <span>
                    {METODOS[l.metodo] || l.metodo} · {fechaCorta(l.fechaEfectiva)}
                    {l.referencia ? ` · Ref. ${l.referencia}` : ""}
                  </span>
                </div>
                <p className="liquidaciones-suave">
                  Registró {l.registradaPor} el {fechaYHora(l.registradaEn)}
                  {l.resueltaPor ? ` · ${l.estado === "rechazada" ? "Rechazó" : "Confirmó"} ${l.resueltaPor} el ${fechaYHora(l.resueltaEn)}` : ""}
                </p>
                {l.pedidos.length > 0 && (
                  <p className="liquidaciones-suave">
                    Pedidos: {l.pedidos.map((p) => `${p.numero} (${formatMoney(p.monto)}${p.motivo === "cancelacion" ? ", por cancelación" : ""})`).join(", ")}
                  </p>
                )}
                {l.observacion && <p className="liquidaciones-suave">Observación: {l.observacion}</p>}
                {l.motivoRechazo && <p className="liquidaciones-rechazo">Motivo del rechazo: {l.motivoRechazo}</p>}

                {l.puedeResolver && puedeOperar && (
                  <div className="liquidaciones-botones">
                    <button type="button" className="btn btn-secondary" disabled={Boolean(resolviendo)} onClick={() => resolver(l, false)}>
                      Rechazar
                    </button>
                    <button type="button" className="btn btn-primary" disabled={Boolean(resolviendo)} onClick={() => resolver(l, true)}>
                      {resolviendo === l.id ? "Guardando…" : "Confirmar recepción"}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      {registrando && (
        <RegistrarEntrega
          par={registrando}
          pedidos={datos.pedidos.filter((p) => p.origenId === registrando.origenId && p.destinoId === registrando.destinoId && p.pendiente > 0)}
          onCerrar={() => setRegistrando(null)}
          onRegistrada={alRegistrar}
        />
      )}
    </div>
  )
}

export default Liquidaciones
