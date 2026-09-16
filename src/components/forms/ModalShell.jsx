import { useEffect, useId, useRef } from "react"
import { FaTimes } from "react-icons/fa"

/*
  Armazón de una ventana modal.

  Las seis ventanas del sistema repetían el mismo esqueleto —capa, caja,
  cabecera, cuerpo, pie— pero ninguna se anunciaba como diálogo: sin
  role, sin aria-modal, sin título asociado, sin Escape y sin devolver el
  foco al cerrarse. Quien navega con teclado entraba y se quedaba dentro.

  Escape cierra. Es lo mismo que pulsar la X, que todas tenían ya y que
  descarta sin preguntar: no añade ninguna forma nueva de perder datos, y
  sin ella un teclado no tiene salida rápida.

  Pulsar fuera NO cierra salvo que la pantalla lo pida: cada una conserva
  el comportamiento que ya tenía, porque convertir un clic despistado en
  un formulario perdido sí sería nuevo.
*/
function ModalShell({
  titulo,
  onCerrar,
  cerrarAlPulsarFuera = false,
  ancho = "",
  children,
  acciones,
}) {
  const tituloId = useId()
  const caja = useRef(null)

  /*
    El foco vuelve a donde estaba. Se guarda en la primera pasada, antes
    de mover nada, para devolverlo al botón que abrió la ventana.
  */
  const origen = useRef(null)

  useEffect(() => {
    origen.current = document.activeElement

    const dentro = caja.current
    if (dentro && !dentro.contains(document.activeElement)) {
      /*
        El foco entra por el primer control del cuerpo, no por la X de la
        cabecera: quien abre un formulario quiere escribir, no cerrarlo.
        Si el cuerpo no tiene dónde escribir se cae a lo que haya.
      */
      const ENFOCABLE =
        "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"

      const cuerpo = dentro.querySelector(".modal-body")

      const enfocable =
        cuerpo?.querySelector(ENFOCABLE) || dentro.querySelector(ENFOCABLE)

      if (enfocable) enfocable.focus()
      else dentro.focus()
    }

    return () => {
      const volver = origen.current
      if (volver && typeof volver.focus === "function") volver.focus()
    }
  }, [])

  useEffect(() => {
    const alPulsarTecla = (evento) => {
      if (evento.key === "Escape") onCerrar()
    }

    document.addEventListener("keydown", alPulsarTecla)
    return () => document.removeEventListener("keydown", alPulsarTecla)
  }, [onCerrar])

  return (
    /*
      La capa es un fondo, no un control: role="presentation" lo dice.
      Pulsarla es un atajo de ratón, no la única forma de salir —la X y
      Escape lo cubren—, así que no necesita ser alcanzable por teclado
      ni anunciarse. El rol no lo heredan sus hijos: el diálogo de dentro
      conserva el suyo.
    */
    <div
      className="modal-overlay open"
      role="presentation"
      onMouseDown={(evento) => {
        if (cerrarAlPulsarFuera && evento.target === evento.currentTarget) {
          onCerrar()
        }
      }}
    >
      <div
        ref={caja}
        className={ancho ? `modal ${ancho}` : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h3 id={tituloId}>{titulo}</h3>

          <button
            type="button"
            className="icon-btn"
            aria-label="Cerrar"
            onClick={onCerrar}
          >
            <FaTimes aria-hidden="true" />
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {acciones && <div className="modal-foot">{acciones}</div>}
      </div>
    </div>
  )
}

export default ModalShell
