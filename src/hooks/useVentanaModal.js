import { useEffect } from "react"

import { bloquearDesplazamiento } from "../lib/bloqueoDeDesplazamiento"

/*
  Lo que toda ventana modal necesita mientras está abierta en un teléfono.

  1. El fondo no se desplaza: el dedo movía la página tapada en vez del
     contenido de la ventana.
  2. El alto que de verdad queda visible. Con el teclado del teléfono
     abierto, 100dvh sigue midiendo la pantalla entera y la ventana quedaba
     detrás del teclado. visualViewport sí mide lo visible: se publica como
     --vista-alto y --vista-arriba, y modals.css ajusta la capa a eso.
     Sin visualViewport el CSS se queda con 100dvh.

  Se cuentan las ventanas abiertas para que cerrar una no deje sin ajustar
  a otra que siga encima.
*/
let ventanasAbiertas = 0
let dejarDeSeguir = null

function seguirLaVistaVisible() {
  const vista = globalThis.visualViewport
  if (!vista) return null

  const raiz = document.documentElement.style
  const publicar = () => {
    raiz.setProperty("--vista-alto", `${Math.round(vista.height)}px`)
    raiz.setProperty("--vista-arriba", `${Math.round(vista.offsetTop)}px`)
  }

  publicar()
  vista.addEventListener("resize", publicar)
  vista.addEventListener("scroll", publicar)

  return () => {
    vista.removeEventListener("resize", publicar)
    vista.removeEventListener("scroll", publicar)
    raiz.removeProperty("--vista-alto")
    raiz.removeProperty("--vista-arriba")
  }
}

export function useVentanaModal(abierta = true) {
  useEffect(() => {
    if (!abierta) return

    const liberarFondo = bloquearDesplazamiento()
    ventanasAbiertas += 1
    if (ventanasAbiertas === 1) dejarDeSeguir = seguirLaVistaVisible()

    return () => {
      liberarFondo()
      ventanasAbiertas = Math.max(0, ventanasAbiertas - 1)
      if (ventanasAbiertas === 0) {
        dejarDeSeguir?.()
        dejarDeSeguir = null
      }
    }
  }, [abierta])
}
