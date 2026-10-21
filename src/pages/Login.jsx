import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"

import { useAuth } from "../hooks/useAuth"
import { PERMISSIONS } from "../context/permissions"
import FormularioDeLogin from "../components/FormularioDeLogin"

/*
  Adónde va quien abre /login con un usuario ya vigente en este teléfono.

  Quién es vigente lo decide AuthContext: una sesión confirmada por el
  servidor o, sin red, el perfil sin conexión del MISMO usuario que no cerró
  sesión y que no venció (OFF-1.3). Aquí no se relaja nada de eso; solo se
  evita pedir la contraseña a quien ya entró, que sin red no se podría
  comprobar. Sin conexión solo se factura: si no puede facturar, se queda en
  el formulario.
*/
function destinoDeUnUsuarioVigente(user, cargando, hasPermission) {
  if (cargando || !user) return null

  if (user.sinConexion) return hasPermission(PERMISSIONS.POS) ? "/pos" : null

  return "/dashboard"
}

function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [entrando, setEntrando] = useState(false)

  const navigate = useNavigate()
  const { login, user, cargando, hasPermission } = useAuth()

  const handleLogin = async (e) => {
    e.preventDefault()
    setError("")
    setEntrando(true)

    const resultado = await login(email, password)

    setEntrando(false)

    if (resultado.ok) {
      navigate("/dashboard")
      return
    }

    setError(resultado.mensaje)
  }

  const destino = destinoDeUnUsuarioVigente(user, cargando, hasPermission)

  if (destino) {
    return <Navigate to={destino} replace />
  }

  return (
    <FormularioDeLogin
      email={email}
      password={password}
      error={error}
      showPassword={showPassword}
      entrando={entrando}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onTogglePassword={() => setShowPassword((v) => !v)}
      onSubmit={handleLogin}
    />
  )
}

export default Login
