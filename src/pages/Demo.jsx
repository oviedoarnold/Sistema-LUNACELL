import { Link } from "react-router-dom"

import "../styles/landing.css"

/*
  Recorrido público de los módulos de LUNACELL.

  Antes esta pantalla publicaba un usuario y una contraseña para que
  cualquiera entrara a mirar. Eso desapareció: la cuenta era de otro sistema
  y ya no existe, y publicar credenciales en una página abierta no es algo
  que convenga reponer. Quien tenga acceso entra por /login.

  Lo que queda es el mapa del sistema. La distinción entre lo que ya
  funciona y lo que está planificado es el punto de la pantalla: presentar
  como terminado un módulo que no existe es la forma más rápida de que
  alguien cuente con él para trabajar.
*/

const DISPONIBLE = "disponible"
const PLANIFICADO = "planificado"

const MODULOS = [
  {
    nombre: "Dashboard",
    estado: DISPONIBLE,
    texto: "Ventas del día y del mes, productos con stock bajo o agotado, saldo por cobrar y últimas ventas.",
  },
  {
    nombre: "Facturación",
    estado: DISPONIBLE,
    texto: "Punto de venta con carrito, al contado o al crédito, con numeración fiscal y descuento automático de existencias.",
  },
  {
    nombre: "Cotizaciones",
    estado: DISPONIBLE,
    texto: "Cotizaciones con fecha de vigencia, exportables en PDF y convertibles en factura.",
  },
  {
    nombre: "Inventario",
    estado: DISPONIBLE,
    texto: "Catálogo con código, categoría, precio, costo, foto y stock mínimo. Las existencias se llevan como un libro de movimientos, no como un número que se sobrescribe.",
  },
  {
    nombre: "Clientes",
    estado: DISPONIBLE,
    texto: "RTN, teléfono, correo y dirección, que se completan solos al facturar o cotizar.",
  },
  {
    nombre: "Proveedores",
    estado: DISPONIBLE,
    texto: "Directorio de quienes abastecen, enlazado con los productos que suministran.",
  },
  {
    nombre: "Cuentas por cobrar",
    estado: DISPONIBLE,
    texto: "Saldo de cada venta al crédito, con abonos parciales. La factura pasa a cancelada sola cuando el saldo llega a cero.",
  },
  {
    nombre: "Ubicaciones",
    estado: DISPONIBLE,
    texto: "Bodegas, tiendas y camiones dados de alta como puntos de inventario. Se editan y se desactivan sin perder su historial.",
  },
  {
    nombre: "Usuarios y permisos",
    estado: DISPONIBLE,
    texto: "Cuentas por invitación, con rol y con permiso sección por sección. El control se aplica en la base de datos, no solo escondiendo botones.",
  },
  {
    nombre: "Inventario por ubicación",
    estado: PLANIFICADO,
    texto: "Que cada bodega, tienda y camión lleve sus propias existencias sobre el mismo catálogo. Hoy las ubicaciones existen, pero el inventario todavía es uno solo.",
  },
  {
    nombre: "Traslados entre ubicaciones",
    estado: PLANIFICADO,
    texto: "Mover mercadería de la bodega a la tienda o a un camión, con la salida y la entrada registradas como una sola operación.",
  },
  {
    nombre: "Carga y cierre de camiones",
    estado: PLANIFICADO,
    texto: "Cargar un camión al salir, vender en ruta y cuadrar lo vendido contra lo cargado al volver.",
  },
  {
    nombre: "Kardex",
    estado: PLANIFICADO,
    texto: "Pantalla para consultar el historial de movimientos de un producto. Los datos se registran desde el primer día; falta dónde verlos.",
  },
  {
    nombre: "Compras",
    estado: PLANIFICADO,
    texto: "Entradas de mercadería desde un proveedor, con su costo, en vez de ajustes manuales.",
  },
  {
    nombre: "Reportes",
    estado: PLANIFICADO,
    texto: "Informes por ubicación, por vendedor y por período, más allá de lo que resume el panel.",
  },
]

const ETIQUETA = {
  [DISPONIBLE]: "Disponible",
  [PLANIFICADO]: "Planificado",
}

function ListaDeModulos({ estado }) {
  const modulos = MODULOS.filter((modulo) => modulo.estado === estado)

  return (
    <div className="lp-grid">
      {modulos.map((modulo) => (
        <article className="lp-card" key={modulo.nombre}>
          <h3>
            {modulo.nombre}{" "}
            <span className={`demo-etiqueta demo-etiqueta-${estado}`}>
              {ETIQUETA[estado]}
            </span>
          </h3>
          <p>{modulo.texto}</p>
        </article>
      ))}
    </div>
  )
}

function Demo() {
  return (
    <div className="landing">
      <nav className="lp-nav is-stuck">
        <div className="wrap">
          <Link to="/" className="lp-brand">
            <span className="mark">📱</span>
            <span>
              <b>LUNACELL &amp; ASOCS.</b>
              <span>ACCESORIOS PARA CELULARES</span>
            </span>
          </Link>

          <div className="lp-nav-links">
            <Link to="/login" className="btn btn-primary">
              Ingresar al sistema
            </Link>
          </div>
        </div>
      </nav>

      <section className="lp-features">
        <div className="wrap">
          <div className="lp-head">
            <span className="kicker">Recorrido</span>
            <h2>Qué hace el sistema LUNACELL</h2>
            <p>
              Un repaso de los módulos, separando lo que ya está funcionando de
              lo que todavía está por construirse. El acceso es con cuenta
              propia: esta página no publica credenciales.
            </p>
          </div>

          <h3 className="demo-seccion">Disponible hoy</h3>
          <ListaDeModulos estado={DISPONIBLE} />

          <h3 className="demo-seccion">Planificado</h3>
          <p className="demo-aviso">
            Todavía no está construido. Se describe aquí para que se sepa hacia
            dónde va el sistema, no para dar por hecho que ya se puede usar.
          </p>
          <ListaDeModulos estado={PLANIFICADO} />
        </div>
      </section>

      <section className="lp-cta">
        <div className="wrap">
          <h2>¿Tienes una cuenta?</h2>
          <p>Entra con tu usuario para trabajar en el sistema.</p>
          <div className="lp-cta-row">
            <Link to="/login" className="btn btn-primary btn-lg">
              INGRESAR AL SISTEMA
            </Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="wrap">
          <div className="lp-brand">
            <span className="mark">📱</span>
            <span>
              <b>LUNACELL &amp; ASOCS.</b>
            </span>
          </div>
          <p>
            © {new Date().getFullYear()} LUNACELL &amp; ASOCS. · Accesorios que
            marcan la diferencia.
          </p>
        </div>
      </footer>
    </div>
  )
}

export default Demo
