import { useLocation } from "react-router-dom"
import { FaBars } from "react-icons/fa"

import { tituloDeLaRuta } from "./menuDelPanel"

/*
  Barra superior del panel.

  Lo único que muestra hoy es dónde está el usuario. El nombre de la
  empresa, el rol y el cierre de sesión viven al pie de la barra lateral,
  y repetirlos aquí solo ocuparía espacio.

  El título sale del mismo menú que dibuja la navegación, así que un
  módulo se llama igual en los dos sitios.

  Lo que deliberadamente no lleva: ni campana de notificaciones ni
  selector de ubicación. No existe ninguna de las dos cosas, y un control
  que no hace nada es peor que no tenerlo. El hueco de la ubicación activa
  se abrirá aquí cuando el inventario pase a contarse por ubicación.
*/
function Topbar({ onAbrirMenu = () => {}, menuAbierto = false }) {
  const { pathname } = useLocation()
  const titulo = tituloDeLaRuta(pathname)

  return (
    <header className="topbar-panel">
      <button
        type="button"
        className="topbar-menu"
        onClick={onAbrirMenu}
        aria-label="Abrir menú"
        aria-expanded={menuAbierto}
        aria-controls="panel-sidebar"
      >
        <FaBars aria-hidden="true" />
      </button>

      <h1 className="topbar-titulo">{titulo}</h1>
    </header>
  )
}

export default Topbar
