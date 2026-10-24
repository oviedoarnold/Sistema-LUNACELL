import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"

import MenuDeCuenta from "../components/shell/MenuDeCuenta"
import Sidebar from "../components/shell/Sidebar"
import Topbar from "../components/shell/Topbar"

/*
  Armazón del panel: navegación lateral fija y área de trabajo con su
  propia barra superior.

  El estado del cajón vive aquí porque lo abre la barra superior y lo
  cierra la lateral, y ninguna de las dos es padre de la otra. En
  escritorio la barra lateral está siempre visible y este estado no
  interviene: solo gobierna el cajón de tableta y móvil.

  Las páginas siguen llegando como children y no por <Outlet />: el router
  monta cada una dentro de su propia ProtectedRoute, y cambiar eso sería
  tocar la autorización para ganar una línea.
*/
function MainLayout({ children }) {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const { pathname } = useLocation()
  const [rutaDelMenu, setRutaDelMenu] = useState(pathname)

  const cerrarMenu = () => setMenuAbierto(false)

  /*
    Si la ruta cambia por cualquier camino (un botón de la página, el botón
    Atrás del teléfono), el cajón se cierra: quedarse abierto tapando la
    página nueva confunde. Elegir un módulo del menú ya lo cerraba.
  */
  if (rutaDelMenu !== pathname) {
    setRutaDelMenu(pathname)
    setMenuAbierto(false)
  }

  /*
    Con el cajón abierto la página de atrás no se desplaza: en el teléfono
    el dedo movía el contenido tapado en vez de la lista del menú.
  */
  useEffect(() => {
    if (!menuAbierto) return

    document.body.classList.add("sin-desplazamiento")

    return () => document.body.classList.remove("sin-desplazamiento")
  }, [menuAbierto])

  /*
    Escape cierra el cajón. Se escucha solo mientras está abierto para no
    dejar un oyente puesto durante toda la sesión.
  */
  useEffect(() => {
    if (!menuAbierto) return

    const alPulsar = (evento) => {
      if (evento.key === "Escape") cerrarMenu()
    }

    document.addEventListener("keydown", alPulsar)

    return () => document.removeEventListener("keydown", alPulsar)
  }, [menuAbierto])

  return (
    <div className={menuAbierto ? "app-shell menu-abierto" : "app-shell"}>
      <Sidebar abierto={menuAbierto} onCerrar={cerrarMenu} />

      {/*
        Tapa el contenido mientras el cajón está abierto y lo cierra al
        pulsarla. Es un div y no un botón porque no aporta nada al
        recorrido por teclado: Escape y el botón de cerrar ya lo cubren.
      */}
      <div
        className="app-overlay"
        onClick={cerrarMenu}
        aria-hidden="true"
      />

      <div className="app-workspace">
        <Topbar
          onAbrirMenu={() => setMenuAbierto(true)}
          menuAbierto={menuAbierto}
        >
          <MenuDeCuenta />
        </Topbar>

        <main className="app-content">{children}</main>
      </div>
    </div>
  )
}

export default MainLayout
