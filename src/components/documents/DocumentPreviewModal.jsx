import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

import Swal from "sweetalert2"
import { FaTimes } from "react-icons/fa"

import { useVentanaModal } from "../../hooks/useVentanaModal"
import { useEscalaDeLaHoja } from "../../hooks/useEscalaDeLaHoja"

import {
  downloadDocumentPDF,
  printDocumentOnePage,
} from "../../utils/documentUtils"

function DocumentPreviewModal({
  open,
  title = "Vista previa",
  fileName = "documento.pdf",
  printTitle = "Documento",
  children,
  onClose,
  onConfirm,
  confirmLabel = "Confirmar",
  canExport = true,
}) {
  const documentRef =
    useRef(null)

  const contenedorRef =
    useRef(null)

  const [
    generatingPdf,
    setGeneratingPdf,
  ] = useState(false)

  const [
    printing,
    setPrinting,
  ] = useState(false)

  const [
    ampliada,
    setAmpliada,
  ] = useState(false)

  const tituloId = useId()

  /*
    En el teléfono la hoja carta no cabe a lo ancho: se muestra reducida,
    entera y con sus proporciones (R-3). Si la letra queda muy pequeña,
    Ampliar la muestra a tamaño real dentro de la vista previa. Solo cambia
    la pantalla: el PDF y la impresión se capturan siempre a tamaño real
    (prepararCopiaParaCaptura en documentUtils).
  */
  const medida = useEscalaDeLaHoja(
    contenedorRef,
    documentRef,
    Boolean(open)
  )

  const puedeReducirse = medida.escala < 1

  const reducida = puedeReducirse && !ampliada

  // Cada vez que se abre, la hoja vuelve a verse entera.
  if (!open && ampliada) {
    setAmpliada(false)
  }

  // Fondo quieto y alto visible real mientras está abierta (R-2).
  useVentanaModal(Boolean(open))

  /*
    Escape cierra, como en el resto de las ventanas del sistema. Esta era
    la única que no lo hacía: se entraba con el teclado y no había forma de
    salir sin buscar la X con el ratón.

    Va antes del return temprano porque un hook no puede quedar detrás de
    una salida condicional; de ahí que mire `open` por dentro en vez de
    dejar que el componente se desmonte.
  */
  useEffect(() => {
    if (!open) return undefined

    const alPulsarTecla = (evento) => {
      if (evento.key === "Escape") onClose?.()
    }

    document.addEventListener("keydown", alPulsarTecla)

    return () => document.removeEventListener("keydown", alPulsarTecla)
  }, [open, onClose])

  if (!open) {
    return null
  }

  const handleDownload =
    async () => {
      if (!documentRef.current) {
        Swal.fire({
          icon: "warning",
          title:
            "Documento no disponible",
          text:
            "No se encontró el documento para generar el PDF.",
        })

        return
      }

      try {
        setGeneratingPdf(true)

        await downloadDocumentPDF(
          documentRef.current,
          fileName
        )
      } catch (error) {
        console.error(error)

        Swal.fire({
          icon: "warning",
          title:
            "No se pudo generar el PDF",
          text:
            "Ocurrió un problema al preparar el documento.",
        })
      } finally {
        setGeneratingPdf(false)
      }
    }

  const handlePrint =
    async () => {
      if (!documentRef.current) {
        Swal.fire({
          icon: "warning",
          title:
            "Documento no disponible",
          text:
            "No se encontró el documento para imprimir.",
        })

        return
      }

      try {
        setPrinting(true)

        await printDocumentOnePage(
          documentRef.current,
          printTitle || title
        )
      } catch (error) {
        console.error(error)

        Swal.fire({
          icon: "error",
          title:
            "No se pudo imprimir",
          text:
            error.message ||
            "Ocurrió un error al preparar la impresión.",
        })
      } finally {
        setPrinting(false)
      }
    }

  return (
    /*
      La capa es un fondo, no un control: role="presentation" lo dice. Era
      un div suelto que escuchaba el ratón, y por eso se anunciaba como si
      hubiera algo que pulsar. Pulsarla es un atajo de ratón, no la única
      forma de salir —la X y Escape lo cubren—, así que no necesita ser
      alcanzable por teclado. Es el mismo trato que ya recibía la capa de
      ModalShell.
    */
    <div
      className="modal-overlay open"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose?.()
        }
      }}
    >
      <div
        className="modal modal-document"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
      >

        <div className="modal-head">

          <h3 id={tituloId}>{title}</h3>

          {puedeReducirse && (
            <button
              type="button"
              className="btn btn-ghost btn-sm vista-hoja-ampliar"
              onClick={() =>
                setAmpliada(
                  (actual) => !actual
                )
              }
            >
              {ampliada
                ? "Ajustar a la pantalla"
                : "🔍 Ampliar"}
            </button>
          )}

          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
          >
            <FaTimes aria-hidden="true" />
          </button>

        </div>

        <div className="modal-body document-preview-body">

          <div
            className="receipt-wrap"
            ref={contenedorRef}
          >

            <div
              className="vista-hoja"
              data-reduccion-de-vista
              style={
                reducida
                  ? {
                      width:
                        medida.ancho *
                        medida.escala,
                      height:
                        medida.alto *
                        medida.escala,
                    }
                  : undefined
              }
            >
              <div
                className="vista-hoja-escala"
                data-reduccion-de-vista
                style={
                  reducida
                    ? {
                        transform: `scale(${medida.escala})`,
                      }
                    : undefined
                }
              >
                <div
                  ref={documentRef}
                  className="vista-hoja-documento"
                >
                  {children}
                </div>
              </div>
            </div>

          </div>

        </div>

        <div className="modal-foot">

          {onConfirm && (
            <button
              type="button"
              className="btn btn-success"
              onClick={onConfirm}
            >
              ✓ {confirmLabel}
            </button>
          )}

          {canExport && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={
                  handleDownload
                }
                disabled={
                  generatingPdf ||
                  printing
                }
              >
                {generatingPdf
                  ? "Generando PDF..."
                  : "⬇ Descargar PDF"}
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={
                  handlePrint
                }
                disabled={
                  printing ||
                  generatingPdf
                }
              >
                {printing
                  ? "Preparando..."
                  : "🖨 Imprimir"}
              </button>
            </>
          )}

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={printing}
          >
            Cerrar
          </button>

        </div>

      </div>
    </div>
  )
}

export default DocumentPreviewModal