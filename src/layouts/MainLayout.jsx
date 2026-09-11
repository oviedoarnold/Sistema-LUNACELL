import { useEffect, useState } from "react"

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

  const cerrarMenu = () => setMenuAbierto(false)

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
        />

        <main className="app-content">{children}</main>
      </div>
    </div>
  )
}

export default MainLayout
