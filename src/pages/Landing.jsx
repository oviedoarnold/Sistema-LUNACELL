import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"

import {
  CabeceraPublica,
  LlamadaAIngresar,
  PiePublico,
  LEMA,
} from "../components/PaginaPublica"

import "../styles/landing.css"

/*
  Página pública de LUNACELL & ASOCS.

  Solo describe lo que el sistema hace hoy. No lleva teléfonos, direcciones,
  número de clientes, años de operación ni cifras de ventas: nada de eso se
  ha definido, e inventarlo para llenar la página convertiría la portada en
  una promesa que el sistema no respalda.

  El diseño visual definitivo —la paleta negro y dorado, el logotipo— llega
  en su propia fase. La estructura de secciones queda tal cual para que ese
  cambio sea de estilos y no de marcado.
*/

const MODULOS = [
  {
    icon: "📦",
    tone: "ico-o",
    title: "Inventario y catálogo",
    text: "Productos con código, categoría, precio, costo y foto. El sistema avisa de lo que está bajo mínimo o agotado antes de que un cliente lo pida.",
  },
  {
    icon: "🧾",
    tone: "ico-b",
    title: "Facturación",
    text: "Punto de venta con carrito y búsqueda, al contado o al crédito. La numeración fiscal y el descuento de existencias los resuelve el sistema.",
  },
  {
    icon: "📄",
    tone: "ico-t",
    title: "Cotizaciones en PDF",
    text: "Cotizaciones con fecha de vigencia, exportables en PDF y convertibles en factura sin volver a capturar los productos.",
  },
  {
    icon: "👥",
    tone: "ico-p",
    title: "Clientes y proveedores",
    text: "RTN, teléfono, correo y dirección de cada cliente, que se completan solos al facturar. Y el directorio de quienes abastecen.",
  },
  {
    icon: "💳",
    tone: "ico-a",
    title: "Cuentas por cobrar",
    text: "Las ventas al crédito quedan con su saldo a la vista. Cada abono lo descuenta y la factura pasa a cancelada sola cuando llega a cero.",
  },
  {
    icon: "🏬",
    tone: "ico-g",
    title: "Ubicaciones",
    text: "Bodegas, tiendas y camiones registrados como puntos de inventario. Es la base sobre la que cada lugar llevará sus propias existencias.",
  },
]

const PASOS = [
  {
    n: "1",
    title: "Registra tus ubicaciones",
    text: "La bodega, la tienda y cada camión quedan dados de alta como puntos de inventario independientes.",
  },
  {
    n: "2",
    title: "Carga el catálogo",
    text: "Productos con su precio, su costo y su existencia inicial. Es el paso que toma tiempo, y se hace una sola vez.",
  },
  {
    n: "3",
    title: "Vende y cobra",
    text: "Tu equipo factura y cotiza; el inventario se descuenta solo y el panel resume el día, el mes y lo que falta por cobrar.",
  },
]

/*
  Vista previa del panel. Muestra las ubicaciones que administra el sistema
  —que son un dato real— y no cifras de ventas, que no lo serían.
*/
const UBICACIONES_DE_MUESTRA = [
  { nombre: "Bodega Principal", tipo: "Bodega", tono: "o" },
  { nombre: "Lunacell Store", tipo: "Tienda", tono: "b" },
  { nombre: "Camión 01", tipo: "Camión", tono: "w" },
  { nombre: "Camión 02", tipo: "Camión", tono: "g" },
]

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
      <CabeceraPublica fija={stuck}>
        <a href="#modulos">Módulos</a>
        <a href="#como-funciona">Cómo funciona</a>
      </CabeceraPublica>

      <header className="lp-hero">
        <div className="wrap">
          <div>
            <span className="lp-eyebrow" data-rise style={{ "--d": "0s" }}>
              {LEMA}
            </span>

            <h1 data-rise style={{ "--d": ".07s" }}>
              Todo LUNACELL, <em>ordenado</em> de la bodega a la ruta.
            </h1>

            <p className="lead" data-rise style={{ "--d": ".14s" }}>
              Inventario, facturación, cotizaciones, clientes y cobros en un
              solo sistema, con cada bodega, tienda y camión registrado como su
              propio punto de inventario.
            </p>

            <div className="lp-cta-row" data-rise style={{ "--d": ".21s" }}>
              <Link to="/login" className="btn btn-primary btn-lg">
                INGRESAR AL SISTEMA
              </Link>
              <Link to="/demo" className="btn btn-secondary btn-lg">
                Ver los módulos
              </Link>
            </div>

            <p className="lp-note" data-rise style={{ "--d": ".28s" }}>
              Corre en el navegador · Precios en lempiras · Formato RTN
            </p>
          </div>

          <div className="lp-mock" aria-hidden="true">
            <div className="lp-mock-bar">
              <i></i>
              <i></i>
              <i></i>
              <span>ubicaciones</span>
            </div>

            <div className="lp-mock-body">
              {UBICACIONES_DE_MUESTRA.map((ubicacion) => (
                <div className={`lp-stat ${ubicacion.tono}`} key={ubicacion.nombre}>
                  <span className="k">{ubicacion.tipo}</span>
                  <span className="v lp-mock-nombre">{ubicacion.nombre}</span>
                  <span className="d">Punto de inventario</span>
                </div>
              ))}
            </div>

            <div className="lp-mock-foot">
              <div className="t">Un catálogo, varios lugares</div>
              <p className="lp-mock-pie">
                Cada ubicación lleva sus propias existencias sobre el mismo
                catálogo de productos.
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="lp-features" id="modulos">
        <div className="wrap">
          <div className="lp-head" data-reveal>
            <span className="kicker">Módulos</span>
            <h2>Lo que el sistema hace hoy</h2>
            <p>
              Cada módulo resuelve una tarea concreta del día a día de LUNACELL,
              sin funciones de más que nadie usa.
            </p>
          </div>

          <div className="lp-grid">
            {MODULOS.map((modulo, index) => (
              <article
                className="lp-card"
                key={modulo.title}
                data-reveal
                style={{ "--d": `${index * 0.07}s` }}
              >
                <div className={`ico ${modulo.tone}`}>{modulo.icon}</div>
                <h3>{modulo.title}</h3>
                <p>{modulo.text}</p>
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
              No hay nada que instalar: el sistema se abre en el navegador y los
              datos viven en la nube.
            </p>
          </div>

          <div className="lp-grid">
            {PASOS.map((paso, index) => (
              <div
                className="lp-step"
                key={paso.n}
                data-reveal
                style={{ "--d": `${index * 0.1}s` }}
              >
                <span className="n">{paso.n}</span>
                <h3>{paso.title}</h3>
                <p>{paso.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <LlamadaAIngresar
        titulo="Entra a LUNACELL"
        texto="Accede con tu usuario y encuentra el inventario, las ventas y los clientes donde deben estar."
      />

      <PiePublico />
    </div>
  )
}

export default Landing
