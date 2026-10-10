import { NavLink, useNavigate } from "react-router-dom"
import Swal from "sweetalert2"
import { FaSignOutAlt, FaTimes } from "react-icons/fa"

import { useAuth } from "../../hooks/useAuth"
import { useSinConexion } from "../../hooks/useSinConexion"
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
  const { user, logout, hasPermission, isAdmin } = useAuth()
  const sinConexion = useSinConexion()
  const navigate = useNavigate()

  const gruposVisibles = GRUPOS_DEL_MENU.map((grupo) => ({
    ...grupo,
    modulos: grupo.modulos.filter((modulo) => hasPermission(modulo.permiso) && (!modulo.soloAdmin || isAdmin)),
  })).filter((grupo) => grupo.modulos.length > 0)

  /*
    Con ventas guardadas solo en el teléfono, cerrar sesión no las borra,
    pero se avisa: se envían cuando ese usuario vuelva a entrar con
    conexión, y sin conexión no podrá volver a entrar hasta que vuelva.
  */
  const confirmarSalida = async () => {
    const sinConfirmar = sinConexion?.sinConfirmar || 0

    if (sinConfirmar === 0) return true

    const sinServidor = sinConexion.conexion !== "en_linea"
    const respuesta = await Swal.fire({
      icon: "warning",
      title: "Hay ventas sin sincronizar",
      text: `Tienes ${sinConfirmar} ${sinConfirmar === 1 ? "venta guardada" : "ventas guardadas"} solo en este teléfono. No se borran: se enviarán cuando vuelvas a entrar con tu usuario y haya conexión.${sinServidor ? " Sin conexión no podrás volver a entrar hasta que vuelva." : ""} Si vas a entregar el teléfono, guarda antes un respaldo cifrado.`,
      showCancelButton: true,
      confirmButtonText: "Cerrar sesión igual",
      cancelButtonText: "Volver",
    })

    return respuesta.isConfirmed
  }

  const cerrarSesion = async () => {
    if (!(await confirmarSalida())) return

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
      {/*
        El emblema ya trae el nombre y el lema dentro, asi que no se
        repiten en texto al lado: seria decir dos veces lo mismo.
      */}
      <div className="sidebar-marca">
        <LogoLunacell variante="emblema" className="sidebar-emblema" />

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
