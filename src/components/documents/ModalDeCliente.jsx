/*
  Formulario de cliente nuevo, compartido por el punto de venta y las
  cotizaciones.

  Las dos pantallas lo tenían escrito entero, y lo único que las
  diferenciaba era el prefijo de los identificadores del formulario. Ese
  prefijo sigue haciendo falta: las dos pantallas montan otros campos con
  los mismos nombres —el RTN del comprador en el punto de venta, por
  ejemplo— y un `id` repetido rompe la relación entre la etiqueta y su
  campo.
*/

const CAMPOS = [
  { clave: "name", etiqueta: "Nombre", id: "nombre" },
  { clave: "rtn", etiqueta: "RTN (opcional)", id: "rtn-opcional" },
  { clave: "phone", etiqueta: "Teléfono", id: "telefono" },
  { clave: "email", etiqueta: "Correo", id: "correo" },
  { clave: "address", etiqueta: "Dirección", id: "direccion", ancho: "full" },
]

function ModalDeCliente({
  abierto,
  prefijo,
  formulario,
  onCambiar,
  onGuardar,
  onCerrar,
}) {
  if (!abierto) {
    return null
  }

  const escribir = (clave) => (evento) =>
    onCambiar((actual) => ({ ...actual, [clave]: evento.target.value }))

  return (
    <div className="modal-overlay open">
      <div className="modal">
        <div className="modal-head">
          <h3>Nuevo cliente</h3>

          <button
            type="button"
            className="icon-btn"
            aria-label="Cerrar"
            onClick={onCerrar}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            {CAMPOS.map((campo) => (
              <div
                className={campo.ancho ? `field ${campo.ancho}` : "field"}
                key={campo.clave}
              >
                <label htmlFor={`${prefijo}-${campo.id}`}>
                  {campo.etiqueta}
                </label>

                <input
                  id={`${prefijo}-${campo.id}`}
                  value={formulario[campo.clave]}
                  onChange={escribir(campo.clave)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-primary" onClick={onGuardar}>
            Guardar cliente
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCerrar}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalDeCliente
