import { useState } from "react"

import ModalShell from "../forms/ModalShell"
import { inicial, leerFormulario, mediosQuePuedeDevolver, resumen } from "../../utils/cancelacionDePedidos"
import { etiquetaDelMedio } from "../../utils/mediosDePago"
import { formatMoney } from "../../utils/format"

/*
  Cancelar un pedido antes de facturarlo (0049, etapa C2a), en un solo
  formulario: motivo, productos que devolvió el cliente, dinero que se le
  devuelve y un resumen de lo que va a quedar registrado.

  Los mismos campos sirven después, desde el pedido cancelado, para registrar
  productos que llegan más tarde («recibir») o dinero que se devuelve más tarde
  («reembolsar»). Nada se da por hecho: lo que no se marca queda pendiente.

  La pantalla solo ofrece lo que el servidor dice que quien mira puede hacer;
  la base lo vuelve a comprobar todo.
*/

const TITULOS = {
  cancelar: "Cancelar el pedido",
  recibir: "Registrar productos recibidos",
  reembolsar: "Registrar reembolso",
}

const BOTONES = {
  cancelar: "Confirmar cancelación",
  recibir: "Registrar recepción",
  reembolsar: "Registrar reembolso",
}

function FormularioDeCancelacion({ pedido, cancelacion, modo, enviando, onEnviar, onCerrar }) {
  const [f, setF] = useState(() => inicial(cancelacion, modo))
  const cambiar = (cambios) => setF((actual) => ({ ...actual, ...cambios }))
  const productos = cancelacion.productos.filter((p) => p.pendiente > 0)
  const medios = mediosQuePuedeDevolver(cancelacion)
  const recibido = cancelacion.dinero.reduce((n, d) => n + d.total, 0)
  const lectura = leerFormulario(cancelacion, modo, f)
  const ubicacion = cancelacion.ubicacionesParaRecibir.find((u) => u.id === f.ubicacionId)
  // El efectivo que sale de una ubicación que no es del pedido lleva la referencia de la entrega real (0050).
  const desdeOtra = Boolean(cancelacion.ubicacionesParaReembolsar.find((u) => u.id === f.desdeId)?.otra)

  const muestraProductos = modo !== "reembolsar" && productos.length > 0
  const muestraDinero = modo !== "recibir" && cancelacion.dinero.some((d) => d.pendiente > 0)

  const acciones = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>
        Volver
      </button>
      <button type="button" className="btn btn-danger" disabled={enviando || !lectura.datos} onClick={() => lectura.datos && onEnviar(lectura.datos)}>
        {enviando ? "Guardando…" : BOTONES[modo]}
      </button>
    </>
  )

  return (
    <ModalShell titulo={`${TITULOS[modo]} ${pedido.numero}`} onCerrar={enviando ? () => {} : onCerrar} acciones={acciones}>
      <div className="cancelacion">
        {modo === "cancelar" && (
          <section className="cancelacion-seccion">
            <label className="field" htmlFor="cancelacion-motivo">
              <span>Motivo de la cancelación</span>
              <textarea
                id="cancelacion-motivo"
                rows={2}
                maxLength={500}
                value={f.motivo}
                onChange={(evento) => cambiar({ motivo: evento.target.value })}
                placeholder="Por ejemplo: el cliente ya no quiere los productos"
              />
            </label>
          </section>
        )}

        {muestraProductos && (
          <section className="cancelacion-seccion" aria-label="Productos">
            <h3 className="pedidos-subtitulo">{modo === "cancelar" ? "¿El cliente devolvió los productos?" : "Productos recibidos"}</h3>

            <div className="pay-toggle cancelacion-opciones" role="group" aria-label="Productos devueltos">
              {[
                ["todos", "Todos"],
                ["algunos", "Algunos"],
                ...(modo === "cancelar" ? [["ninguno", "Ninguno"]] : []),
              ].map(([id, texto]) => (
                <button key={id} type="button" className={f.productosModo === id ? "active" : ""} aria-pressed={f.productosModo === id} onClick={() => cambiar({ productosModo: id })}>
                  {texto}
                </button>
              ))}
            </div>

            {f.productosModo !== "ninguno" && (
              <>
                <ul className="cancelacion-productos">
                  {productos.map((p) => (
                    <li key={p.id}>
                      <span className="cancelacion-producto">
                        {p.nombre}
                        <small>
                          Por recibir: {p.pendiente} de {p.entregado}
                        </small>
                      </span>
                      <span className="cancelacion-producto-campos">
                        {f.productosModo === "algunos" ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`Cantidad de ${p.nombre}`}
                            value={f.cantidades[p.id]}
                            onChange={(evento) => cambiar({ cantidades: { ...f.cantidades, [p.id]: evento.target.value } })}
                          />
                        ) : (
                          <b>{p.pendiente}</b>
                        )}
                        <select
                          aria-label={`Estado de ${p.nombre}`}
                          value={f.condiciones[p.id]}
                          onChange={(evento) => cambiar({ condiciones: { ...f.condiciones, [p.id]: evento.target.value } })}
                        >
                          <option value="buen_estado">Buen estado</option>
                          <option value="danado">Dañado</option>
                        </select>
                      </span>
                    </li>
                  ))}
                </ul>

                <label className="field" htmlFor="cancelacion-ubicacion">
                  <span>Dónde se recibieron</span>
                  <select id="cancelacion-ubicacion" value={f.ubicacionId} onChange={(evento) => cambiar({ ubicacionId: evento.target.value })}>
                    {cancelacion.ubicacionesParaRecibir.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre}
                        {u.otra ? " (otra ubicación)" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                {ubicacion?.otra && (
                  <label className="field" htmlFor="cancelacion-nota">
                    <span>Nota que respalda la recepción</span>
                    <textarea id="cancelacion-nota" rows={2} maxLength={500} value={f.nota} onChange={(evento) => cambiar({ nota: evento.target.value })} />
                  </label>
                )}

                <p className="crud-nota">Lo dañado queda registrado pero no vuelve a la existencia.</p>
              </>
            )}
          </section>
        )}

        {muestraDinero && (
          <section className="cancelacion-seccion" aria-label="Dinero">
            <h3 className="pedidos-subtitulo">Dinero del cliente</h3>

            <ul className="cancelacion-dinero">
              {cancelacion.dinero.map((d) => (
                <li key={d.medio}>
                  <span>
                    {etiquetaDelMedio(d.medio)}
                    <small>
                      Recibido {formatMoney(d.total)}
                      {d.cargo > 0 ? ` (incluye cargo ${formatMoney(d.cargo)})` : ""}
                      {d.devuelto > 0 ? ` · devuelto ${formatMoney(d.devuelto)}` : ""}
                    </small>
                  </span>
                  <span className="pos-importe">Por devolver {formatMoney(d.pendiente)}</span>
                </li>
              ))}
            </ul>

            {modo === "cancelar" && (
              <div className="pay-toggle cancelacion-opciones" role="group" aria-label="Reembolso">
                <button type="button" className={!f.reembolsar ? "active" : ""} aria-pressed={!f.reembolsar} onClick={() => cambiar({ reembolsar: false })}>
                  Queda pendiente
                </button>
                <button type="button" className={f.reembolsar ? "active" : ""} aria-pressed={f.reembolsar} disabled={medios.length === 0} onClick={() => cambiar({ reembolsar: true })}>
                  Reembolsar ahora
                </button>
              </div>
            )}

            {cancelacion.bloqueoDeReembolsos && cancelacion.dinero.some((d) => d.medio === "efectivo" && d.pendiente > 0) && (
              <p className="alert-banner" role="alert">
                El efectivo de este pedido está en {cancelacion.bloqueoDeReembolsos}. Mientras no se confirme o se rechace en Liquidaciones, no se
                registran devoluciones en efectivo.
              </p>
            )}

            {medios.length === 0 && !cancelacion.bloqueoDeReembolsos && (
              <p className="crud-nota">
                {cancelacion.dinero.some((d) => d.medio !== "efectivo" && d.pendiente > 0)
                  ? "Las devoluciones por transferencia, tarjeta o enlace las registra el administrador."
                  : "No puedes registrar devoluciones de este pedido."}
              </p>
            )}

            {(f.reembolsar || modo === "reembolsar") && medios.length > 0 && (
              <div className="cancelacion-reembolsos">
                {medios.map((d) => (
                  <div className="cancelacion-reembolso" key={d.medio}>
                    <label className="field" htmlFor={`cancelacion-importe-${d.medio}`}>
                      <span>Se devuelve con {etiquetaDelMedio(d.medio)}</span>
                      <input
                        id={`cancelacion-importe-${d.medio}`}
                        type="text"
                        inputMode="decimal"
                        value={f.importes[d.medio]}
                        onChange={(evento) => cambiar({ importes: { ...f.importes, [d.medio]: evento.target.value } })}
                      />
                    </label>

                    {d.medio === "efectivo" ? (
                      <>
                        {cancelacion.ubicacionesParaReembolsar.length > 1 && (
                          <label className="field" htmlFor="cancelacion-desde">
                            <span>Sale de la caja de</span>
                            <select id="cancelacion-desde" value={f.desdeId} onChange={(evento) => cambiar({ desdeId: evento.target.value })}>
                              {cancelacion.ubicacionesParaReembolsar.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.nombre}
                                  {u.otra ? " (otra ubicación)" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {desdeOtra && (
                          <label className="field" htmlFor="cancelacion-referencia-efectivo">
                            <span>Referencia de la entrega</span>
                            <input
                              id="cancelacion-referencia-efectivo"
                              type="text"
                              maxLength={120}
                              placeholder="Recibo o quién entregó el efectivo"
                              value={f.referencias.efectivo || ""}
                              onChange={(evento) => cambiar({ referencias: { ...f.referencias, efectivo: evento.target.value } })}
                            />
                          </label>
                        )}
                      </>
                    ) : (
                      <label className="field" htmlFor={`cancelacion-referencia-${d.medio}`}>
                        <span>Referencia de la devolución</span>
                        <input
                          id={`cancelacion-referencia-${d.medio}`}
                          type="text"
                          maxLength={120}
                          value={f.referencias[d.medio] || ""}
                          onChange={(evento) => cambiar({ referencias: { ...f.referencias, [d.medio]: evento.target.value } })}
                        />
                      </label>
                    )}
                  </div>
                ))}
                <p className="crud-nota">Regístralo solo cuando el dinero ya se entregó al cliente.</p>
              </div>
            )}
          </section>
        )}

        {modo === "cancelar" && recibido === 0 && <p className="crud-nota">El cliente no pagó nada: no hay dinero que devolver.</p>}

        <section className="cancelacion-seccion cancelacion-resumen" aria-label="Resumen">
          <h3 className="pedidos-subtitulo">Resumen</h3>
          {lectura.datos ? (
            <ul>
              {resumen(cancelacion, modo, lectura.datos).map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          ) : (
            <p className="alert-banner" role="alert">
              {lectura.problema}
            </p>
          )}
        </section>
      </div>
    </ModalShell>
  )
}

export default FormularioDeCancelacion
