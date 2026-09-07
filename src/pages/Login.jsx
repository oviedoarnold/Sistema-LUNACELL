import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { useAuth } from "../hooks/useAuth"
import FormularioDeLogin from "../components/FormularioDeLogin"

function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [entrando, setEntrando] = useState(false)

  const navigate = useNavigate()
  const { login } = useAuth()

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
