import { Link } from "react-router-dom"

const CUENTA_DEMO = {
  correo: "demo@oviedoarnold.lat",
  contrasena: "Demo2026",
}

function Dato({ etiqueta, valor }) {
  return (
    <div>
      {etiqueta}: <b>{valor}</b>
    </div>
  )
}

function Demo() {
  return (
    <div id="login-screen">
      <div
        className="login-card"
        style={{ maxWidth: 460 }}
      >
        <div style={{ fontSize: 34, marginBottom: 8 }}>🧰</div>

        <h2>Demostración guiada</h2>

        <p className="sub">
          Entre con la cuenta de abajo para recorrer el sistema. Ya hay
          productos, clientes, ventas a crédito y cotizaciones cargados, así
          que no hace falta capturar nada a mano.
        </p>

        <div
          style={{
            background: "var(--cream)",
            border: "1px solid var(--line-strong)",
            borderRadius: 10,
            padding: "13px 15px",
            textAlign: "left",
            marginBottom: 16,
          }}
        >
          <b style={{ fontSize: 14.5 }}>Vendedor de mostrador</b>

          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              marginTop: 7,
              lineHeight: 1.9,
            }}
          >
            <Dato etiqueta="correo" valor={CUENTA_DEMO.correo} />
            <Dato etiqueta="contraseña" valor={CUENTA_DEMO.contrasena} />
          </div>

          <p
            style={{
              margin: "8px 0 0",
              fontSize: 13,
              color: "var(--steel)",
            }}
          >
            Sin acceso a Inventario, Proveedores ni Configuración: sirve para
            comprobar que el control de permisos funciona de verdad.
          </p>
        </div>

        <Link
          to="/login"
          className="btn btn-primary btn-lg btn-block"
        >
          Ir a iniciar sesión
        </Link>

        <p
          style={{
            fontSize: 12.5,
            color: "var(--steel)",
            marginTop: 14,
            lineHeight: 1.6,
          }}
        >
          Esta cuenta entra al sistema de una ferretería en funcionamiento.
          Lo que registre queda guardado y lo verá quien entre después, así
          que conviene no borrar nada que no haya creado usted.
        </p>
      </div>
    </div>
  )
}

export default Demo
