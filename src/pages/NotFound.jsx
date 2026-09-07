import { Link } from "react-router-dom"

import { useAuth } from "../hooks/useAuth"

function NotFound() {
  const { user } = useAuth()

  return (
    <div id="login-screen">
      <div className="login-card">
        <div
          style={{
            fontFamily:
              "var(--font-display)",
            fontSize: 64,
            fontWeight: 600,
            lineHeight: 1,
            color: "var(--orange)",
          }}
        >
          404
        </div>

        <h2
          style={{
            marginTop: 12,
          }}
        >
          Esta página no existe
        </h2>

        <p className="sub">
          Puede que el enlace esté mal
          escrito o que la página se
          haya movido.
        </p>

        <Link
          to={user ? "/dashboard" : "/"}
          className="btn btn-primary btn-lg btn-block"
        >
          {user
            ? "Volver al panel"
            : "Ir al inicio"}
        </Link>
      </div>
    </div>
  )
}

export default NotFound
