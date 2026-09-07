import { NavLink,  useNavigate,} from "react-router-dom"

import { useContext } from "react"

import { useAuth } from "../hooks/useAuth"
import { ProductContext } from "../context/contexts"
import { PERMISSIONS } from "../context/permissions"

import {
  FaHome,
  FaCashRegister,
  FaBox,
  FaUsers,
  FaTruck,
  FaHistory,
  FaFileAlt,
  FaCog,
} from "react-icons/fa"

function Navbar() {
  const { user, logout, hasPermission, } = useAuth()

  const { company } = useContext(ProductContext)

  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate("/login")
  }

  const tabs = [
  {
    to: "/dashboard",
    label: "Dashboard",
    Icon: FaHome,
    permission: PERMISSIONS.DASHBOARD,
  },
  {
    to: "/pos",
    label: "Facturar",
    Icon: FaCashRegister,
    permission: PERMISSIONS.POS,
  },
  {
    to: "/quotes",
    label: "Cotizar",
    Icon: FaFileAlt,
    permission: PERMISSIONS.QUOTES,
  },
  {
    to: "/products",
    label: "Inventario",
    Icon: FaBox,
    permission: PERMISSIONS.PRODUCTS,
  },
  {
    to: "/clients",
    label: "Clientes",
    Icon: FaUsers,
    permission: PERMISSIONS.CLIENTS,
  },
  {
    to: "/suppliers",
    label: "Proveedores",
    Icon: FaTruck,
    permission: PERMISSIONS.SUPPLIERS,
  },
  {
    to: "/sales-history",
    label: "Historial",
    Icon: FaHistory,
    permission: PERMISSIONS.SALES_HISTORY,
  },
  {
    to: "/settings",
    label: "Configuración",
    Icon: FaCog,
    permission: PERMISSIONS.SETTINGS,
  },
]

const visibleTabs = tabs.filter((tab) =>
  hasPermission(tab.permission)
)

  const getUserInitials = () => {
    if (!user?.name) {
      return "US"
    }

    return user.name
      .split(" ")
      .map((name) => name[0])
      .slice(0, 2)
      .join("")
      .toUpperCase()
  }

  const getUserRoleLabel = () => {
    return user?.role === "admin"
      ? "Administrador"
      : "Vendedor"
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-top">
          <div className="brand">
            <div className="brand-mark">
              🔧
            </div>

            <div className="brand-text">
              <h1
                style={{
                  margin: 0,
                }}
              >
                {company?.name || "Sistema Ferretería"}
              </h1>

              <p
                className="sub"
                style={{
                  margin: 0,
                }}
              >
                Panel
              </p>
            </div>
          </div>

          <div className="topbar-user">
            <div className="user-pill">
              <div className="user-avatar">
                {getUserInitials()}
              </div>

              <div className="user-meta">
                <b>
                  {user?.name ||
                    "Usuario"}
                </b>

                <span>
                  {getUserRoleLabel()}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="btn-logout"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              ⎋
            </button>
          </div>
        </div>

        <nav className="tabs">
          {visibleTabs.map((tab) => {
            const Icon = tab.Icon

            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({
                  isActive,
                }) =>
                  isActive
                    ? "tab-link active"
                    : "tab-link"
                }
              >
                <Icon />

                {tab.label}
              </NavLink>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

export default Navbar