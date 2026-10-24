import { useEffect, useId, useRef, useState } from "react"
import { FaSignOutAlt } from "react-icons/fa"

import { useAuth } from "../../hooks/useAuth"
import { datosDeLaCuenta, useCerrarSesion } from "./useCerrarSesion"

/*
  La cuenta en la barra superior, solo en tableta y teléfono.

  En escritorio el nombre, el rol y «Cerrar sesión» viven al pie de la
  barra lateral, que siempre está a la vista. En el teléfono esa barra es
  un cajón y su pie quedaba detrás de la barra del navegador: había que
  abrir el menú y adivinar que debajo había algo. Aquí está siempre a un
  toque, y cierra la sesión con la misma función (y el mismo aviso si hay
  ventas sin sincronizar) que la barra lateral.
*/
function MenuDeCuenta() {
  const { user } = useAuth()
  const cerrarSesion = useCerrarSesion()
  const cuenta = datosDeLaCuenta(user)
  const [abierto, setAbierto] = useState(false)
  const caja = useRef(null)
  const boton = useRef(null)
  const idMenu = useId()

  useEffect(() => {
    if (!abierto) return

    const alPulsarTecla = (evento) => {
      if (evento.key === "Escape") {
        setAbierto(false)
        boton.current?.focus()
      }
    }
    const alTocarFuera = (evento) => {
      if (!caja.current?.contains(evento.target)) setAbierto(false)
    }

    document.addEventListener("keydown", alPulsarTecla)
    document.addEventListener("pointerdown", alTocarFuera)

    return () => {
      document.removeEventListener("keydown", alPulsarTecla)
      document.removeEventListener("pointerdown", alTocarFuera)
    }
  }, [abierto])

  const salir = async () => {
    setAbierto(false)
    await cerrarSesion()
  }

  return (
    <div className="topbar-cuenta" ref={caja}>
      <button
        ref={boton}
        type="button"
        className="topbar-cuenta-boton"
        aria-label={`Cuenta de ${cuenta.nombre}`}
        aria-expanded={abierto}
        aria-controls={idMenu}
        onClick={() => setAbierto((valor) => !valor)}
      >
        <span className="sidebar-avatar" aria-hidden="true">
          {cuenta.iniciales}
        </span>
      </button>

      {abierto && (
        <div className="topbar-cuenta-menu" id={idMenu}>
          <span className="topbar-cuenta-datos">
            <b>{cuenta.nombre}</b>
            <span>{cuenta.rol}</span>
          </span>

          <button type="button" className="topbar-cuenta-salir" onClick={salir}>
            <FaSignOutAlt aria-hidden="true" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default MenuDeCuenta
