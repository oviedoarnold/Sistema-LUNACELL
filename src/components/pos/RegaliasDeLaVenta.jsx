import { useState } from "react"
import { FaGift, FaMinus, FaPlus, FaTrash } from "react-icons/fa"

import BuscadorDeRegalias from "./BuscadorDeRegalias"
import { CAMPO_DE_CANTIDAD } from "../../utils/camposNumericos"
import { MOTIVOS_DE_REGALIA } from "../../utils/regalias"

/*
  La sección «Regalías» del POS (0054), debajo de los artículos facturados.

  Lo que se agrega aquí sale sin cargo: no entra en el subtotal, el ISV, el
  total ni los medios de pago. Solo se ve con el permiso «Autorizar
  regalías»; si la venta todavía no puede llevarlas —sin conexión, sin cliente
  registrado, factura fiscal— el botón queda desactivado y se dice por qué.
*/
function RegaliasDeLaVenta({ regalias, productos, disponibleDe, bloqueo }) {
  const [buscando, setBuscando] = useState(false)
  const nombreDe = (id) => productos.find((p) => String(p.id) === String(id))?.name || "Producto"

  return (
    <section className="pos-regalias" aria-labelledby="pos-titulo-regalias">
      <div className="pos-articulos-cabecera">
        <h3 id="pos-titulo-regalias" className="pos-titulo">
          <FaGift aria-hidden="true" /> Regalías
        </h3>

        <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(bloqueo)} onClick={() => setBuscando(true)}>
          <FaPlus aria-hidden="true" />
          Agregar regalía
        </button>
      </div>

      {bloqueo && (
        <p className="pos-regalias-aviso" role={regalias.renglones.length ? "alert" : "status"}>
          {bloqueo}
        </p>
      )}

      {regalias.renglones.length > 0 && (
        <>
          <ul className="pos-regalias-lista" aria-label="Regalías de la venta">
            {regalias.renglones.map((r) => {
              const nombre = nombreDe(r.productId)
              const cantidad = Number(r.cantidad) || 0

              return (
                <li key={r.productId}>
                  <span className="pos-regalias-producto">
                    <strong>{nombre}</strong>
                    <span className="pos-regalias-etiqueta">Regalía</span>
                  </span>

                  <span className="pos-regalias-cantidad">
                    <button type="button" aria-label={`Una unidad menos de regalía de ${nombre}`} disabled={cantidad <= 1} onClick={() => regalias.sumar(r.productId, -1)}>
                      <FaMinus aria-hidden="true" />
                    </button>
                    <input
                      type="number"
                      {...CAMPO_DE_CANTIDAD}
                      min="1"
                      step="1"
                      aria-label={`Cantidad de regalía de ${nombre}`}
                      value={r.cantidad}
                      onChange={(e) => regalias.escribir(r.productId, e.target.value)}
                    />
                    <button type="button" aria-label={`Una unidad más de regalía de ${nombre}`} disabled={cantidad >= disponibleDe(r.productId)} onClick={() => regalias.sumar(r.productId, 1)}>
                      <FaPlus aria-hidden="true" />
                    </button>
                  </span>

                  <span className="pos-regalias-importe">Sin cargo</span>

                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={`Eliminar la regalía de ${nombre}`}
                    title="Eliminar regalía"
                    onClick={() => regalias.quitar(r.productId)}
                  >
                    <FaTrash aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="pos-regalias-motivo">
            <div className="field">
              <label htmlFor="pos-motivo-regalia">Motivo de la regalía</label>
              <select id="pos-motivo-regalia" value={regalias.motivo} onChange={(e) => regalias.setMotivo(e.target.value)}>
                <option value="">Elige el motivo…</option>
                {MOTIVOS_DE_REGALIA.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.etiqueta}
                  </option>
                ))}
              </select>
            </div>

            {regalias.motivo === "otro" && (
              <div className="field">
                <label htmlFor="pos-detalle-regalia">Describe el motivo</label>
                <input
                  id="pos-detalle-regalia"
                  type="text"
                  maxLength="300"
                  value={regalias.detalle}
                  onChange={(e) => regalias.setDetalle(e.target.value)}
                />
              </div>
            )}
          </div>
        </>
      )}

      {buscando && (
        <BuscadorDeRegalias
          productos={productos}
          disponibleDe={disponibleDe}
          cantidadDe={regalias.cantidadDe}
          onAgregar={regalias.agregar}
          onCerrar={() => setBuscando(false)}
        />
      )}
    </section>
  )
}

export default RegaliasDeLaVenta
