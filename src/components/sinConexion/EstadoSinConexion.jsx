import StatusBadge from "../crud/StatusBadge"
import { FaCloud, FaCloudUploadAlt, FaExclamationTriangle, FaListUl, FaSync, FaWifi } from "react-icons/fa"

/*
  La barra de estado del modo sin conexión en el POS: si hay servidor, cuántas
  ventas esperan en el teléfono, si se están enviando y qué pasó la última
  vez. Todo lo que puede hacer que una venta tarde en llegar se dice aquí,
  en palabras del vendedor.
*/
const CONEXION = {
  en_linea: { texto: "En línea", clase: "is-en-linea", Icono: FaWifi },
  comprobando: { texto: "Comprobando conexión…", clase: "is-comprobando", Icono: FaCloud },
  sin_servidor: { texto: "Sin conexión con el servidor", clase: "is-sin-conexion", Icono: FaExclamationTriangle },
  sin_red: { texto: "Sin conexión", clase: "is-sin-conexion", Icono: FaExclamationTriangle },
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

function textoDePendientes(pendientes, sincronizando) {
  if (sincronizando) return "Sincronizando…"
  if (pendientes === 0) return "Sin ventas pendientes"

  return `${plural(pendientes, "venta pendiente", "ventas pendientes")} de sincronizar`
}

function EstadoSinConexion({ estado, perfilSinConexion = false, onVerVentas }) {
  const {
    conexion,
    pendientes,
    conError,
    enConciliacion,
    sincronizando,
    ultimaSincronizacion,
    errorDeSincronizacion,
    sincronizarAhora,
    antiguedad,
    ubicacionAutorizada,
    persistencia,
    actualizacionPendiente,
    ventasDeOtraUbicacion,
    motivoNoDisponible,
    errorDeCopia,
  } = estado

  const { texto, clase, Icono } = CONEXION[conexion] || CONEXION.comprobando
  const ultima = ultimaSincronizacion?.en ? new Date(ultimaSincronizacion.en).toLocaleTimeString("es-HN") : ""

  return (
    <section className="estado-sin-conexion" aria-label="Estado de la conexión y de las ventas sin conexión">
      <div className="estado-sin-conexion-fila">
        <span className={`estado-conexion ${clase}`} role="status">
          <Icono aria-hidden="true" />
          {texto}
          {perfilSinConexion && " · sesión sin confirmar"}
        </span>

        <span className={`estado-pendientes${pendientes > 0 ? " hay" : ""}`} aria-live="polite">
          <FaCloudUploadAlt aria-hidden="true" />
          {textoDePendientes(pendientes, sincronizando)}
        </span>

        {conError > 0 && <StatusBadge variante="overdue">{conError} con error</StatusBadge>}
        {enConciliacion > 0 && <StatusBadge variante="credit">{enConciliacion} en conciliación</StatusBadge>}

        <div className="estado-sin-conexion-acciones">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => sincronizarAhora()} disabled={sincronizando}>
            <FaSync aria-hidden="true" />
            Sincronizar ahora
          </button>

          {onVerVentas && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onVerVentas}>
              <FaListUl aria-hidden="true" />
              Ventas sin conexión
            </button>
          )}
        </div>
      </div>

      {ultima && !sincronizando && <p className="estado-sin-conexion-nota">Última sincronización: {ultima}</p>}

      {actualizacionPendiente && (
        <div className="alert-banner" role="alert">
          <span>Hay una versión nueva de LUNACELL abierta en otra pestaña. Recarga esta página: las ventas guardadas no se pierden.</span>
          <button type="button" className="btn btn-secondary" onClick={() => globalThis.location?.reload()}>
            Recargar
          </button>
        </div>
      )}

      {motivoNoDisponible && (
        <div className="alert-banner" role="alert">
          <span>Este navegador no puede guardar ventas sin conexión: {motivoNoDisponible}</span>
        </div>
      )}

      {errorDeSincronizacion && (
        <div className="alert-banner" role="alert">
          <span>{errorDeSincronizacion}</span>
        </div>
      )}

      {pendientes > 0 && conexion !== "en_linea" && (
        <p className="estado-sin-conexion-aviso" role="note">
          Hay ventas guardadas solo en este teléfono. No borres los datos del navegador ni desinstales la aplicación
          hasta que se sincronicen.
        </p>
      )}

      {ventasDeOtraUbicacion > 0 && (
        <p className="estado-sin-conexion-aviso" role="note">
          Tienes {plural(ventasDeOtraUbicacion, "venta sin confirmar", "ventas sin confirmar")} de otra ubicación. Se
          enviarán igual; si tu ubicación cambió, quedarán en conciliación para que un administrador las revise.
        </p>
      )}

      {ubicacionAutorizada && antiguedad?.aviso === "fuerte" && (
        <p className="estado-sin-conexion-aviso" role="note">
          La copia de productos y existencias tiene más de 24 horas. Conéctate para actualizarla.
        </p>
      )}

      {ubicacionAutorizada && antiguedad?.aviso === "leve" && (
        <p className="estado-sin-conexion-nota">La copia de productos y existencias tiene más de 12 horas.</p>
      )}

      {ubicacionAutorizada && errorDeCopia && <p className="estado-sin-conexion-nota">{errorDeCopia}</p>}

      {ubicacionAutorizada && persistencia === "denegado" && (
        <p className="estado-sin-conexion-nota">
          El navegador no garantiza conservar los datos de este teléfono: instala la aplicación y guarda un respaldo
          cifrado si vas a pasar mucho tiempo sin conexión.
        </p>
      )}
    </section>
  )
}

export default EstadoSinConexion
