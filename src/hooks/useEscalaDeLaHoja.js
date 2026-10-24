import { useLayoutEffect, useState } from "react"

/*
  Cuánto hay que reducir la hoja para que quepa entera a lo ancho. Nunca la
  agranda: si cabe, se queda a tamaño real. Se redondea hacia abajo a
  milésimas para que la hoja reducida no pase del ancho disponible por un
  decimal y aparezca un desplazamiento lateral de un píxel.
*/
export function escalaParaAncho(disponible, anchoDeLaHoja) {
  if (!(disponible > 0) || !(anchoDeLaHoja > 0)) return 1

  return Math.min(1, Math.floor((disponible / anchoDeLaHoja) * 1000) / 1000)
}

/*
  La vista previa de facturas y cotizaciones (R-3). La hoja carta mide
  816 px y en un teléfono no cabe: se mide el ancho que deja la ventana y
  el tamaño real de la hoja, y se calcula la reducción. Se vuelve a medir
  al girar el teléfono, al cambiar el tamaño de la ventana y cuando la hoja
  cambia de alto porque terminó de cargar su contenido.

  offsetWidth y offsetHeight dan el tamaño sin la reducción aplicada, así
  que medir no depende de lo que ya se redujo.
*/
export function useEscalaDeLaHoja(contenedorRef, hojaRef, activa) {
  const [medida, setMedida] = useState({ escala: 1, ancho: 0, alto: 0 })

  useLayoutEffect(() => {
    const contenedor = contenedorRef.current
    const hoja = hojaRef.current
    if (!activa || !contenedor || !hoja) return undefined

    const medir = () => {
      const ancho = hoja.offsetWidth
      const alto = hoja.offsetHeight
      const escala = escalaParaAncho(contenedor.clientWidth, ancho)

      setMedida((anterior) =>
        anterior.escala === escala && anterior.ancho === ancho && anterior.alto === alto
          ? anterior
          : { escala, ancho, alto }
      )
    }

    medir()
    globalThis.addEventListener("resize", medir)
    globalThis.addEventListener("orientationchange", medir)

    const observador = typeof ResizeObserver === "function" ? new ResizeObserver(medir) : null
    observador?.observe(contenedor)
    observador?.observe(hoja)

    return () => {
      globalThis.removeEventListener("resize", medir)
      globalThis.removeEventListener("orientationchange", medir)
      observador?.disconnect()
    }
  }, [activa, contenedorRef, hojaRef])

  return medida
}
