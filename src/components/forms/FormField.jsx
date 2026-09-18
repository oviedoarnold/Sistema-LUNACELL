import { cloneElement, useId } from "react"

/*
  Un campo de formulario: etiqueta, control, ayuda y error.

  No dibuja el control. Cada pantalla escribe su propio input, select o
  textarea con sus atributos —name, type, min, step— porque son suyos y
  cambiarlos rompería tanto el envío como las pruebas. Lo que hace este
  componente es lo que faltaba en todos los formularios: colocar la
  etiqueta bien asociada y enlazar la ayuda y el error al control con
  aria-describedby, para que un lector de pantalla los lea al llegar al
  campo y no queden como texto suelto al lado.

  Si el control ya trae su propio id se respeta; si no, se le pone uno.
*/
function FormField({ etiqueta, ayuda, error, ancho, children }) {
  const generado = useId()
  const control = children
  const id = control?.props?.id || generado

  const idAyuda = ayuda ? `${id}-ayuda` : null
  const idError = error ? `${id}-error` : null

  const describedBy = [idAyuda, idError].filter(Boolean).join(" ") || undefined

  return (
    <div className={ancho === "full" ? "field full" : "field"}>
      <label htmlFor={id}>{etiqueta}</label>

      {cloneElement(control, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? "true" : undefined,
        className: error
          ? `${control.props.className || ""} error`.trim()
          : control.props.className,
      })}

      {ayuda && (
        <span className="hint" id={idAyuda}>
          {ayuda}
        </span>
      )}

      {error && (
        <span className="error-msg show" id={idError} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export default FormField
