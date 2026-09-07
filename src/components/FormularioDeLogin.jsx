/*
  Solo el marcado del formulario, sin nada de sesión.

  Está separado de la página para poder generarlo también en el momento de
  compilar: así /login llega al navegador con el formulario ya escrito en el
  HTML y no como una pantalla en blanco que se llena cuando termina de
  cargar el JavaScript. Quien mire el código fuente de la página encuentra
  un formulario de verdad, y quien tenga una conexión lenta ve algo antes.
*/
function FormularioDeLogin({
  email = "",
  password = "",
  error = "",
  showPassword = false,
  entrando = false,
  onEmailChange = () => {},
  onPasswordChange = () => {},
  onTogglePassword = () => {},
  onSubmit = (evento) => evento.preventDefault(),
}) {
  return (
    <div id="login-screen">
      <div className="login-card">
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔧</div>
        <h2>Iniciar sesión</h2>
        <p className="sub">Accede al sistema de tu ferretería</p>
        <div className={`login-error ${error ? "show" : ""}`}>{error}</div>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="login-correo">Correo</label>
            <input
              id="login-correo"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Contraseña</label>
            <div className="pw-wrap">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={onTogglePassword}
                aria-label="Mostrar u ocultar contraseña"
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg btn-block"
            style={{ marginTop: 4 }}
            type="submit"
            disabled={entrando}
          >
            {entrando ? "Entrando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  )
}

export default FormularioDeLogin
