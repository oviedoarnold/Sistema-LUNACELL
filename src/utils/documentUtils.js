import html2canvas from "html2canvas"
import jsPDF from "jspdf"

const LETTER_WIDTH_MM = 215.9
const LETTER_HEIGHT_MM = 279.4


export async function downloadDocumentPDF(
  element,
  fileName = "documento.pdf"
) {
  if (!element) {
    throw new Error(
      "No se encontró el documento para generar el PDF."
    )
  }

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    scrollX: 0,
    scrollY: 0,
    logging: false,
  })

  const imageData = canvas.toDataURL(
    "image/png",
    1.0
  )

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "letter",
  })

  const canvasRatio =
    canvas.height / canvas.width

  let imageWidth = LETTER_WIDTH_MM
  let imageHeight =
    imageWidth * canvasRatio

  if (imageHeight > LETTER_HEIGHT_MM) {
    imageHeight = LETTER_HEIGHT_MM
    imageWidth =
      imageHeight / canvasRatio
  }

  const x =
    (LETTER_WIDTH_MM - imageWidth) / 2

  pdf.addImage(
    imageData,
    "PNG",
    x,
    0,
    imageWidth,
    imageHeight
  )

  const finalFileName =
    fileName
      .toLowerCase()
      .endsWith(".pdf")
      ? fileName
      : `${fileName}.pdf`

  pdf.save(finalFileName)
}


export async function printDocumentOnePage(
  element,
  title = "Documento"
) {
  if (!element) {
    throw new Error(
      "No se encontró el documento para imprimir."
    )
  }

  
  const printWindow = window.open(
    "",
    "_blank",
    "width=950,height=850"
  )

  if (!printWindow) {
    throw new Error(
      "El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio."
    )
  }

  
  printWindow.document.open()

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>${title}</title>

        <style>
          html,
          body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            font-family: Arial, sans-serif;
          }

          .loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #555;
            font-size: 16px;
          }
        </style>
      </head>

      <body>
        <div class="loading">
          Preparando impresión...
        </div>
      </body>
    </html>
  `)

  printWindow.document.close()

  try {
   
    const canvas = await html2canvas(
      element,
      {
        scale: 2,
        useCORS: true,
        backgroundColor:
          "#ffffff",
        scrollX: 0,
        scrollY: 0,
        logging: false,
      }
    )

    const imageData =
      canvas.toDataURL(
        "image/png",
        1.0
      )

  
    printWindow.document.open()

    printWindow.document.write(`
      <!DOCTYPE html>

      <html lang="es">

        <head>

          <meta charset="UTF-8" />

          <title>${title}</title>

          <style>

            @page {
              size: letter portrait;
              margin: 0;
            }

            * {
              box-sizing: border-box;
            }

            html,
            body {
              margin: 0 !important;
              padding: 0 !important;

              width: 100% !important;
              height: 100% !important;

              background: #ffffff !important;
            }

            body {
              display: flex;

              justify-content: center;
              align-items: flex-start;
            }

            .print-page {
              width: 8.5in;
              height: 11in;

              display: flex;

              justify-content: center;
              align-items: flex-start;

              overflow: hidden;

              background: #ffffff;
            }

            .print-page img {
              display: block;

              width: 100%;
              height: 100%;

              object-fit: contain;

              object-position:
                top center;
            }

            @media print {

              html,
              body {
                width: 8.5in !important;
                height: 11in !important;
              }

              .print-page {
                width: 8.5in !important;
                height: 11in !important;
              }

            }

          </style>

        </head>

        <body>

          <div class="print-page">

            <img
              id="document-image"
              src="${imageData}"
              alt="${title}"
            />

          </div>

        </body>

      </html>
    `)

    printWindow.document.close()

  
    const startPrinting = () => {
      window.setTimeout(() => {
        printWindow.focus()
        printWindow.print()
      }, 250)
    }

    const image =
      printWindow.document.getElementById(
        "document-image"
      )

    if (!image) {
      throw new Error(
        "No se pudo preparar la imagen para impresión."
      )
    }

    if (image.complete) {
      startPrinting()
    } else {
      image.onload =
        startPrinting
    }
  } catch (error) {
    printWindow.close()
    throw error
  }
}