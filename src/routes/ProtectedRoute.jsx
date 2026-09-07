import {
  Navigate,
  useLocation,
} from "react-router-dom"

import { useAuth } from "../hooks/useAuth"
import { NAV_ROUTES } from "./navigation"

/*
  Pantalla para el usuario al que el
  administrador no le habilitó ninguna
  página. Sin esto la redirección
  entraría en bucle.
*/
function NoAccess() {
  const { user, logout } =
    useAuth()

  return (
    <div id="login-screen">
      <div className="login-card">
        <div
          style={{
            fontSize: 36,
            marginBottom: 10,
          }}
        >
          🔒
        </div>

        <h2>Sin acceso</h2>

        <p className="sub">
          {user?.name || "Tu usuario"}{" "}
          no tiene ninguna sección
          habilitada. Pídele al
          administrador que te asigne
          permisos.
        </p>

        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={logout}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

function ComprobandoSesion() {
  return (
    <div id="login-screen">
      <div
        className="login-card"
        style={{ textAlign: "center" }}
      >
        <div
          style={{
            fontSize: 32,
            marginBottom: 10,
          }}
        >
          🔧
        </div>

        <p
          style={{
            margin: 0,
            color: "var(--steel)",
            fontSize: 15,
          }}
        >
          Comprobando tu sesión…
        </p>
      </div>
    </div>
  )
}

function ProtectedRoute({
  children,
  permission = null,
}) {
  const {
    user,
    cargando,
    hasPermission,
  } = useAuth()

  const location =
    useLocation()

  /*
    Mientras se resuelve la sesión no se decide nada. Redirigir aquí
    expulsaría al usuario en cada refresco, porque la consulta a Supabase
    todavía no ha respondido.
  */
  if (cargando) {
    return <ComprobandoSesion />
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname,
        }}
      />
    )
  }

  if (
    permission &&
    !hasPermission(permission)
  ) {
    /*
      Se manda a la primera página que
      sí tenga habilitada, en vez de
      asumir que el dashboard lo está.
    */
    const fallback =
      NAV_ROUTES.find((route) =>
        hasPermission(
          route.permission
        )
      )

    if (
      !fallback ||
      fallback.path ===
        location.pathname
    ) {
      return <NoAccess />
    }

    return (
      <Navigate
        to={fallback.path}
        replace
      />
    )
  }

  return children
}

export default ProtectedRoute
