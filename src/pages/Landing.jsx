import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"

import "../styles/landing.css"

const FEATURES = [
  {
    icon: "📦",
    tone: "ico-o",
    title: "Inventario al día",
    text: "Cataloga productos por categoría y precio, y detecta al instante lo que está bajo en stock o agotado antes de que un cliente te lo pida.",
  },
  {
    icon: "🧾",
    tone: "ico-b",
    title: "Facturación rápida",
    text: "Punto de venta pensado para el mostrador: busca, agrega al carrito y cobra en segundos, al contado o al crédito.",
  },
  {
    icon: "📄",
    tone: "ico-t",
    title: "Cotizaciones en PDF",
    text: "Arma una cotización con validez definida y expórtala en PDF con el formato de tu ferretería, lista para enviar al cliente.",
  },
  {
    icon: "👥",
    tone: "ico-p",
    title: "Clientes y RTN",
    text: "Guarda RTN, teléfono, correo y dirección de cada cliente para que se completen solos en facturas y cotizaciones.",
  },
  {
    icon: "💳",
    tone: "ico-a",
    title: "Control de crédito",
    text: "Lleva cuenta de lo que te deben. El panel te muestra el saldo por cobrar de las ventas a crédito sin que tengas que sacar cuentas.",
  },
  {
    icon: "🔐",
    tone: "ico-g",
    title: "Usuarios y permisos",
    text: "Crea usuarios con roles y decide qué puede ver o tocar cada quien. El cajero factura, el dueño ve los números.",
  },
]

const STEPS = [
  {
    n: "1",
    title: "Carga tu inventario",
    text: "Registra tus productos con precio, existencia y stock mínimo. Es el único paso que toma tiempo, y se hace una sola vez.",
  },
  {
    n: "2",
    title: "Vende y cotiza",
    text: "Tu equipo factura desde el punto de venta y genera cotizaciones en PDF. El inventario se descuenta solo.",
  },
  {
    n: "3",
    title: "Revisa los números",
    text: "El panel resume ventas del día y del mes, productos más vendidos, stock crítico y cuentas por cobrar.",
  },
]

const BARS = [38, 54, 45, 71, 86, 100]

function Landing() {
  const rootRef = useRef(null)
  const [stuck, setStuck] = useState(false)

  // Revela los bloques conforme entran en pantalla.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const nodes = root.querySelectorAll("[data-reveal]")
    if (!nodes.length) return

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    if (reduced || !("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("is-visible"))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add("is-visible")
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    )

    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [])

  // Sombra del nav una vez que la página se desplaza.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div className="landing" ref={rootRef}>
      <nav className={`lp-nav ${stuck ? "is-stuck" : ""}`}>
        <div className="wrap">
          <Link to="/" className="lp-brand">
            <span className="mark">🔧</span>
            <span>
              <b>Sistema Ferretería</b>
              <span>GESTIÓN DE MOSTRADOR</span>
            </span>
          </Link>

          <div className="lp-nav-links">
            <a href="#funciones">Funciones</a>
            <a href="#como-funciona">Cómo funciona</a>
            <Link to="/login" className="btn btn-primary">
              Iniciar sesión
            </Link>
          </div>
        </div>
      </nav>

      <header className="lp-hero">
        <div className="wrap">
          <div>
            <span className="lp-eyebrow" data-rise style={{ "--d": "0s" }}>
              Hecho para ferreterías
            </span>

            <h1 data-rise style={{ "--d": ".07s" }}>
              Tu ferretería, <em>ordenada</em> de la bodega a la caja.
            </h1>

            <p className="lead" data-rise style={{ "--d": ".14s" }}>
              Inventario, facturación, cotizaciones y clientes en un solo lugar.
              Sin hojas de cálculo sueltas y sin adivinar qué te queda en bodega.
            </p>

            <div className="lp-cta-row" data-rise style={{ "--d": ".21s" }}>
              <Link to="/login" className="btn btn-primary btn-lg">
                Entrar al sistema
              </Link>
              <a href="#funciones" className="btn btn-secondary btn-lg">
                Ver funciones
              </a>
            </div>

            <p className="lp-note" data-rise style={{ "--d": ".28s" }}>
              Corre en tu navegador · Precios en lempiras · Formato RTN
            </p>
          </div>

          <div className="lp-mock" aria-hidden="true">
            <div className="lp-mock-bar">
              <i></i>
              <i></i>
              <i></i>
              <span>panel · hoy</span>
            </div>

            <div className="lp-mock-body">
              <div className="lp-stat o">
                <span className="k">Ventas hoy</span>
                <span className="v">L 18,450</span>
                <span className="d">Total del día</span>
              </div>
              <div className="lp-stat b">
                <span className="k">Ventas del mes</span>
                <span className="v">L 312,900</span>
                <span className="d">Mes actual</span>
              </div>
              <div className="lp-stat w">
                <span className="k">Stock bajo</span>
                <span className="v">7</span>
                <span className="d">productos</span>
              </div>
              <div className="lp-stat g">
                <span className="k">Por cobrar</span>
                <span className="v">L 24,100</span>
                <span className="d">ventas a crédito</span>
              </div>
            </div>

            <div className="lp-mock-foot">
              <div className="t">Ventas por mes</div>
              <div className="lp-bars">
                {BARS.map((height, index) => (
                  <i
                    key={height}
                    style={{ height: `${height}%`, "--i": index }}
                  ></i>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="lp-features" id="funciones">
        <div className="wrap">
          <div className="lp-head" data-reveal>
            <span className="kicker">Funciones</span>
            <h2>Todo lo que se hace en el mostrador</h2>
            <p>
              Cada módulo resuelve una tarea concreta del día a día de una
              ferretería, sin funciones de más que nadie usa.
            </p>
          </div>

          <div className="lp-grid">
            {FEATURES.map((feature, index) => (
              <article
                className="lp-card"
                key={feature.title}
                data-reveal
                style={{ "--d": `${index * 0.07}s` }}
              >
                <div className={`ico ${feature.tone}`}>{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-steps" id="como-funciona">
        <div className="wrap">
          <div className="lp-head" data-reveal>
            <span className="kicker">Cómo funciona</span>
            <h2>Tres pasos y estás operando</h2>
            <p>
              No necesitas instalar nada ni contratar a alguien para que te lo
              configure.
            </p>
          </div>

          <div className="lp-grid">
            {STEPS.map((step, index) => (
              <div
                className="lp-step"
                key={step.n}
                data-reveal
                style={{ "--d": `${index * 0.1}s` }}
              >
                <span className="n">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-cta">
        <div className="wrap" data-reveal>
          <h2>Empieza a ordenar tu ferretería hoy</h2>
          <p>
            Entra con tu usuario y encuentra el inventario, las ventas y los
            clientes donde deben estar.
          </p>
          <div className="lp-cta-row">
            <Link to="/login" className="btn btn-primary btn-lg">
              Iniciar sesión
            </Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="wrap">
          <div className="lp-brand">
            <span className="mark">🔧</span>
            <span>
              <b>Sistema Ferretería</b>
            </span>
          </div>
          <p>© {new Date().getFullYear()} Sistema Ferretería</p>
        </div>
      </footer>
    </div>
  )
}

export default Landing
