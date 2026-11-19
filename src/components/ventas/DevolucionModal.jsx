import { useCallback, useEffect, useState } from "react"

import ModalShell from "../forms/ModalShell"
import { registrarDevolucion, registrarReembolsoDeVenta, traerDevolucion } from "../../lib/api/ventas"
import {
  CONDICIONES,
  aDevolucionDeApp,
  formularioInicial,
  leerDevolucion,
  leerReembolso,
  mediosParaReembolsar,
  resumenDeDevolucion,
} from "../../utils/devoluciones"
import { etiquetaDelMedio } from "../../utils/mediosDePago"
import { fechaYHora, formatMoney } from "../../utils/format"

/*
  Devoluciones de una factura ya emitida (0052, etapas C4 y C5).

  Se elige qué productos vuelven, cuántos, en qué estado y dónde se
  recibieron, y antes de confirmar se ve cuánto baja la venta, el nuevo saldo
  del crédito y lo que queda a favor del cliente. Lo que queda a favor se
  reembolsa aparte, cuando el dinero de verdad se entrega.

  Todo lo que se ofrece sale de devolucion_de_venta(): qué puede hacer quien
  mira, lo que aún se puede devolver y el dinero de la venta. La base vuelve a
  comprobarlo todo al registrar. La clave de cada intento se conserva hasta
  que sale bien: un reintento tras una caída de red no registra dos veces.
*/

const nuevaClave = () => crypto.randomUUID()

function Cifra({ etiqueta, valor, moneda }) {
  return (
    <>
      <dt>{etiqueta}</dt>
      <dd>{formatMoney(valor, moneda)}</dd>
    </>
  )
}

function DevolucionModal({ venta, moneda = "L", onCerrar, onCambio }) {
  const [info, setInfo] = useState(null)
  const [carga, setCarga] = useState("")
  const [modo, setModo] = useState("devolver")
  const [f, setF] = useState(null)
  const [r, setR] = useState({ medio: "efectivo", importe: "", referencia: "" })
  const [claves, setClaves] = useState(() => ({ devolver: nuevaClave(), reembolsar: nuevaClave() }))
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState("")
  const [hecho, setHecho] = useState("")

  // Lo que llega de la base, con el formulario en blanco y abierto en lo que se puede hacer.
  const aplicar = useCallback((respuesta) => {
    const datos = aDevolucionDeApp(respuesta)
    const quedan = datos.productos.some((p) => p.disponible > 0)

    setInfo(datos)
    setF(formularioInicial(datos))
    setModo(datos.puedeRegistrar && quedan ? "devolver" : "reembolsar")
    setR((actual) => ({ ...actual, medio: mediosParaReembolsar(datos)[0]?.medio || "efectivo", importe: "" }))
  }, [])

  useEffect(() => {
    let vigente = true

    traerDevolucion(venta.id).then(
      (respuesta) => vigente && aplicar(respuesta),
      (problema) => vigente && setCarga(problema.message || "No se pudieron cargar las devoluciones.")
    )

    return () => {
      vigente = false
    }
  }, [venta.id, aplicar])

  const cerrar = enviando ? () => {} : onCerrar

  if (!info || !f) {
    return (
      <ModalShell titulo={`Devoluciones de ${venta.invoiceNumber}`} onCerrar={cerrar}>
        {carga ? (
          <p className="alert-banner" role="alert">
            {carga}
          </p>
        ) : (
          <p className="crud-nota" role="status">
            Cargando…
          </p>
        )}
      </ModalShell>
    )
  }

  const d = info.dinero
  const credito = d.formaPago === "credito"
  const productos = info.productos.filter((p) => p.disponible > 0)
  const medios = mediosParaReembolsar(info)
  const puedeDevolver = info.puedeRegistrar && productos.length > 0
  const puedeReembolsar = info.puedeRegistrar && medios.length > 0
  const lectura = modo === "devolver" ? leerDevolucion(info, venta, f) : leerReembolso(info, r)
  const medioElegido = medios.find((m) => m.medio === r.medio)

  const enviar = async () => {
    if (!lectura.datos || enviando) return

    setEnviando(true)
    setError("")
    setHecho("")

    try {
      if (modo === "devolver") {
        const respuesta = await registrarDevolucion(venta.id, { ...lectura.datos, clave: claves.devolver })
        setHecho(
          Number(respuesta?.a_favor) > 0
            ? `Devolución registrada. Quedan ${formatMoney(respuesta.a_favor, moneda)} a favor del cliente por reembolsar.`
            : "Devolución registrada."
        )
      } else {
        await registrarReembolsoDeVenta(venta.id, { ...lectura.datos, clave: claves.reembolsar })
        setHecho(`Reembolso de ${formatMoney(lectura.datos.importe, moneda)} registrado.`)
      }

      setClaves((actual) => ({ ...actual, [modo]: nuevaClave() }))
      aplicar(await traerDevolucion(venta.id))
      await onCambio?.()
    } catch (problema) {
      setError(problema.message || "No se pudo registrar.")
    } finally {
      setEnviando(false)
    }
  }

  const acciones = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>
        Cerrar
      </button>
      {(modo === "devolver" ? puedeDevolver : puedeReembolsar) && (
        <button type="button" className="btn btn-primary" disabled={enviando || !lectura.datos} onClick={enviar}>
          {enviando ? "Guardando…" : modo === "devolver" ? "Confirmar devolución" : "Registrar reembolso"}
        </button>
      )}
    </>
  )

  return (
    <ModalShell titulo={`Devoluciones de ${venta.invoiceNumber}`} onCerrar={cerrar} acciones={acciones}>
      <div className="cancelacion">
        <dl className="anular-resumen" aria-label="Dinero de la venta">
          <dt>Cliente</dt>
          <dd>{venta.clientName || "Consumidor Final"}</dd>
          <Cifra etiqueta="Total facturado" valor={d.total} moneda={moneda} />
          {d.devuelto > 0 && <Cifra etiqueta="Devuelto" valor={d.devuelto + d.cargoDevuelto} moneda={moneda} />}
          <Cifra etiqueta="Importe actual" valor={d.neto} moneda={moneda} />
          {credito && <Cifra etiqueta="Saldo del crédito" valor={d.saldo} moneda={moneda} />}
          {d.aFavor > 0 && <Cifra etiqueta="A favor del cliente, por reembolsar" valor={d.pendiente} moneda={moneda} />}
        </dl>

        {info.bloqueo && (
          <p className="alert-banner" role="alert">
            {info.bloqueo}
          </p>
        )}

        {!info.bloqueo && !info.puedeRegistrar && (
          <p className="crud-nota">Puedes consultar las devoluciones, pero registrarlas necesita «Registrar devoluciones» en la ubicación que facturó.</p>
        )}

        {puedeDevolver && puedeReembolsar && (
          <div className="pay-toggle cancelacion-opciones" role="group" aria-label="Qué registrar">
            {[
              ["devolver", "Devolver productos"],
              ["reembolsar", "Reembolsar dinero"],
            ].map(([id, texto]) => (
              <button key={id} type="button" className={modo === id ? "active" : ""} aria-pressed={modo === id} onClick={() => setModo(id)} disabled={enviando}>
                {texto}
              </button>
            ))}
          </div>
        )}

        {modo === "devolver" && puedeDevolver && (
          <section className="cancelacion-seccion" aria-label="Productos devueltos">
            <label className="field" htmlFor="devolucion-motivo">
              <span>Motivo de la devolución</span>
              <textarea
                id="devolucion-motivo"
                rows={2}
                maxLength={500}
                value={f.motivo}
                disabled={enviando}
                onChange={(evento) => setF({ ...f, motivo: evento.target.value })}
              />
            </label>

            <ul className="cancelacion-productos">
              {productos.map((p) => (
                <li key={p.id}>
                  <span className="cancelacion-producto">
                    {p.nombre}
                    <small>
                      Se puede devolver {p.disponible} de {p.vendido} · {formatMoney(p.valorUnitario, moneda)} c/u con ISV
                    </small>
                  </span>
                  <span className="cancelacion-producto-campos">
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label={`Cantidad devuelta de ${p.nombre}`}
                      placeholder="0"
                      value={f.cantidades[p.id]}
                      disabled={enviando}
                      onChange={(evento) => setF({ ...f, cantidades: { ...f.cantidades, [p.id]: evento.target.value } })}
                    />
                    <select
                      aria-label={`Estado de ${p.nombre}`}
                      value={f.condiciones[p.id]}
                      disabled={enviando}
                      onChange={(evento) => setF({ ...f, condiciones: { ...f.condiciones, [p.id]: evento.target.value } })}
                    >
                      {CONDICIONES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.etiqueta}
                        </option>
                      ))}
                    </select>
                  </span>
                </li>
              ))}
            </ul>

            <label className="field" htmlFor="devolucion-ubicacion">
              <span>Dónde se recibieron</span>
              <select id="devolucion-ubicacion" value={f.ubicacionId} disabled={enviando} onChange={(evento) => setF({ ...f, ubicacionId: evento.target.value })}>
                {info.ubicaciones.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        {modo === "reembolsar" && puedeReembolsar && (
          <section className="cancelacion-seccion" aria-label="Reembolso">
            <label className="field" htmlFor="reembolso-medio">
              <span>Se devuelve con</span>
              <select id="reembolso-medio" value={r.medio} disabled={enviando} onChange={(evento) => setR({ ...r, medio: evento.target.value })}>
                {medios.map((m) => (
                  <option key={m.medio} value={m.medio}>
                    {etiquetaDelMedio(m.medio)} (hasta {formatMoney(m.tope, moneda)})
                  </option>
                ))}
              </select>
            </label>

            <label className="field" htmlFor="reembolso-importe">
              <span>Importe</span>
              <input
                id="reembolso-importe"
                type="text"
                inputMode="decimal"
                placeholder={medioElegido ? String(medioElegido.tope) : ""}
                value={r.importe}
                disabled={enviando}
                onChange={(evento) => setR({ ...r, importe: evento.target.value })}
              />
            </label>

            {r.medio !== "efectivo" && (
              <label className="field" htmlFor="reembolso-referencia">
                <span>Referencia de la devolución</span>
                <input
                  id="reembolso-referencia"
                  type="text"
                  maxLength={120}
                  value={r.referencia}
                  disabled={enviando}
                  onChange={(evento) => setR({ ...r, referencia: evento.target.value })}
                />
              </label>
            )}

            <p className="crud-nota">
              {r.medio === "efectivo" ? "El efectivo sale de la caja de la ubicación que facturó. " : ""}
              Regístralo solo cuando el dinero ya se entregó al cliente.
            </p>
          </section>
        )}

        {info.puedeRegistrar && d.pendiente > 0 && medios.length === 0 && (
          <p className="crud-nota">Las devoluciones de dinero por transferencia, tarjeta o enlace las registra el administrador.</p>
        )}

        {(modo === "devolver" ? puedeDevolver : puedeReembolsar) && (
          <section className="cancelacion-seccion cancelacion-resumen" aria-label="Resumen">
            <h3 className="pedidos-subtitulo">Antes de confirmar</h3>
            {lectura.datos ? (
              <ul>
                {(modo === "devolver"
                  ? resumenDeDevolucion(info, lectura, moneda)
                  : [`Se registra la entrega de ${formatMoney(lectura.datos.importe, moneda)} al cliente con ${etiquetaDelMedio(lectura.datos.medio)}.`]
                ).map((linea) => (
                  <li key={linea}>{linea}</li>
                ))}
              </ul>
            ) : (
              <p className="crud-nota">{lectura.problema}</p>
            )}
          </section>
        )}

        {hecho && (
          <p className="crud-nota" role="status">
            {hecho}
          </p>
        )}

        {error && (
          <p className="alert-banner" role="alert">
            {error}
          </p>
        )}

        {(info.devoluciones.length > 0 || info.reembolsos.length > 0) && (
          <section className="cancelacion-seccion" aria-label="Registrado">
            <h3 className="pedidos-subtitulo">Registrado</h3>
            <ul className="cancelacion-dinero">
              {info.devoluciones.map((x) => (
                <li key={`d-${x.fecha}`}>
                  <span>
                    Devolución · {fechaYHora(x.fecha)} · {x.usuario}
                    <small>
                      {(x.productos || []).map((p) => `${p.nombre} × ${p.cantidad}${p.condicion === "danado" ? " (dañado)" : ""}`).join(", ")} · recibido en{" "}
                      {x.ubicacion} · {x.motivo}
                    </small>
                  </span>
                  <span className="pos-importe">{formatMoney(Number(x.valor) + Number(x.cargo), moneda)}</span>
                </li>
              ))}
              {info.reembolsos.map((x) => (
                <li key={`r-${x.fecha}`}>
                  <span>
                    Reembolso con {etiquetaDelMedio(x.medio)} · {fechaYHora(x.fecha)} · {x.usuario}
                    {x.referencia ? <small>Referencia {x.referencia}</small> : null}
                  </span>
                  <span className="pos-importe">{formatMoney(x.importe, moneda)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ModalShell>
  )
}

export default DevolucionModal
