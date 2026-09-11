import { NavLink, useNavigate } from "react-router-dom"
import { FaSignOutAlt, FaTimes } from "react-icons/fa"

import { useAuth } from "../../hooks/useAuth"
import LogoLunacell from "../LogoLunacell"
import { GRUPOS_DEL_MENU } from "./menuDelPanel"

/*
  Navegación lateral del panel.

  Sustituye a la fila de pestañas que vivía en la cabecera. Con nueve
  módulos, esa fila envolvía en dos líneas y se comía altura de trabajo
  justo en las pantallas donde más falta hace: el punto de venta y las
  tablas.

  Los permisos no se deciden aquí. Cada módulo declara el suyo en
  menuDelPanel y este componente pregunta a hasPermission, la misma
  función que usaba la navegación anterior. Un grupo cuyos módulos estén
  todos ocultos desaparece con su encabezado: un título suelto sin nada
  debajo hace pensar que algo no cargó.

  Sobre la marca: se usa el símbolo y no el logo completo porque el
  teléfono y el subtítulo del logo son gris oscuro y sobre el carbón
  quedan en 1.3:1. El nombre va en texto al lado, que además permite
  elegir su color. El logo oficial no se recolorea.
*/
function Sidebar({ abierto = false, onCerrar = () => {} }) {
  const { user, logout, hasPermission } = useAuth()
  const navigate = useNavigate()

  const gruposVisibles = GRUPOS_DEL_MENU.map((grupo) => ({
    ...grupo,
    modulos: grupo.modulos.filter((modulo) => hasPermission(modulo.permiso)),
  })).filter((grupo) => grupo.modulos.length > 0)

  const cerrarSesion = async () => {
    await logout()
    navigate("/login")
  }

  const iniciales = () => {
    if (!user?.name) return "US"

    return user.name
      .split(" ")
      .map((parte) => parte[0])
      .slice(0, 2)
      .join("")
      .toUpperCase()
  }

  const rol = user?.role === "admin" ? "Administrador" : "Vendedor"

  return (
    <aside
      id="panel-sidebar"
      className={abierto ? "sidebar is-abierto" : "sidebar"}
      aria-label="Navegación principal"
    >
      <div className="sidebar-marca">
        <LogoLunacell variante="simbolo" className="sidebar-simbolo" />

        <span className="sidebar-marca-texto">
          <b>LUNACELL</b>
          <span>&amp; ASOCS.</span>
        </span>

        <button
          type="button"
          className="sidebar-cerrar"
          onClick={onCerrar}
          aria-label="Cerrar menú"
        >
          <FaTimes />
        </button>
      </div>

      <nav className="sidebar-nav">
        {gruposVisibles.map((grupo) => (
          <div className="sidebar-grupo" key={grupo.titulo}>
            <p className="sidebar-grupo-titulo">{grupo.titulo}</p>

            {grupo.modulos.map(({ to, label, Icono }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onCerrar}
                className={({ isActive }) =>
                  isActive ? "sidebar-enlace is-activo" : "sidebar-enlace"
                }
              >
                <Icono aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-pie">
        <div className="sidebar-usuario">
          <span className="sidebar-avatar" aria-hidden="true">
            {iniciales()}
          </span>

          <span className="sidebar-usuario-datos">
            <b>{user?.name || "Usuario"}</b>
            <span>{rol}</span>
          </span>
        </div>

        <button
          type="button"
          className="sidebar-salir"
          onClick={cerrarSesion}
        >
          <FaSignOutAlt aria-hidden="true" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
