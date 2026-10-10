import { useState } from "react"

import { useAuth } from "../hooks/useAuth"

/*
  Lo único que puede hacer quien entra con una contraseña temporal (USR-1).

  La base ya no le deja ver ni operar nada hasta cambiarla (0026): esta
  pantalla no es la protección, es lo que se le muestra en lugar de
  pantallas vacías. La comprobación de la contraseña actual y el cambio
  ocurren en el servidor; aquí solo se evitan viajes inútiles.
*/

const MINIMO = 10

function motivoLocal(nueva, confirmacion, actual) {
  if (nueva !== confirmacion) return "Las contraseñas nuevas no coinciden."
  if (nueva.length < MINIMO) return `La contraseña nueva debe tener al menos ${MINIMO} caracteres.`
  if (!/[A-Za-z]/.test(nueva) || !/[0-9]/.test(nueva)) return "La contraseña nueva debe tener letras y números."
  if (nueva === actual) return "La contraseña nueva debe ser distinta de la temporal."

  return null
}

function CambiarContrasena() {
  const { user, changePassword, logout } = useAuth()
  const [actual, setActual] = useState("")
  const [nueva, setNueva] = useState("")
  const [confirmacion, setConfirmacion] = useState("")
  const [error, setError] = useState("")
  const [guardando, setGuardando] = useState(false)

  const enviar = async (evento) => {
    evento.preventDefault()

    const motivo = motivoLocal(nueva, confirmacion, actual)

    if (motivo) {
      setError(motivo)
      return
    }

    setError("")
    setGuardando(true)

    try {
      await changePassword(actual, nueva)
    } catch (problema) {
      setError(problema.message)
      setGuardando(false)
    }
  }

  return (
    <div id="login-screen">
      <div className="login-card">
        <h2>Cambia tu contraseña</h2>

        <p className="sub">
          {user?.name ? `${user.name}, entraste` : "Entraste"} con una contraseña temporal. Elige una
          nueva para empezar a usar LUNACELL.
        </p>

        <div className={`login-error ${error ? "show" : ""}`} role="alert">
          {error}
        </div>

        <form onSubmit={enviar}>
          <div className="field">
            <label htmlFor="cambio-actual">Contraseña temporal</label>
            <input
              id="cambio-actual"
              type="password"
              autoComplete="current-password"
              required
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="cambio-nueva">Contraseña nueva</label>
            <input
              id="cambio-nueva"
              type="password"
              autoComplete="new-password"
              aria-describedby="cambio-ayuda"
              required
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
            />
            <p id="cambio-ayuda" className="sub">
              Al menos {MINIMO} caracteres, con letras y números.
            </p>
          </div>

          <div className="field">
            <label htmlFor="cambio-confirmar">Confirma la contraseña nueva</label>
            <input
              id="cambio-confirmar"
              type="password"
              autoComplete="new-password"
              required
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={guardando}>
            {guardando ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </form>

        <button type="button" className="btn btn-secondary btn-block" onClick={logout}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

export default CambiarContrasena
