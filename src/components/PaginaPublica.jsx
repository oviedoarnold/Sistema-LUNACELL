import { Link } from "react-router-dom"

import LogoLunacell from "./LogoLunacell"

/*
  Marco compartido por las páginas públicas: la portada y el recorrido.

  Las dos abren con la misma cabecera de marca y cierran con el mismo pie.
  Estaban escritos dos veces, y el problema no era el recuento de líneas
  duplicadas sino lo que implica: el día que cambie el nombre comercial o el
  lema, cambiarlos en un sitio y no en el otro deja la marca partida sin que
  nada avise.

  Lo que cambia entre una página y otra son los enlaces del menú, y por eso
  entran como children.
*/

export const EMPRESA = "LUNACELL & ASOCS."
export const LEMA = "Accesorios que marcan la diferencia."
export const BAJADA = "ACCESORIOS PARA CELULARES"

/*
  fija deja la cabecera con sombra desde el principio. La portada la activa
  al desplazarse; el recorrido, que no tiene hero, la lleva puesta.
*/
export function CabeceraPublica({ fija = false, children = null }) {
  return (
    <nav className={fija ? "lp-nav is-stuck" : "lp-nav"}>
      <div className="wrap">
        <Link to="/" className="lp-brand">
          <LogoLunacell variante="simbolo" className="lp-mark" />
          <span>
            <b>{EMPRESA}</b>
            <span>{BAJADA}</span>
          </span>
        </Link>

        <div className="lp-nav-links">
          {children}
          <Link to="/login" className="btn btn-primary">
            Ingresar al sistema
          </Link>
        </div>
      </div>
    </nav>
  )
}

export function PiePublico() {
  return (
    <footer className="lp-footer">
      <div className="wrap">
        <div className="lp-brand">
          <LogoLunacell variante="simbolo" className="lp-mark" />
          <span>
            <b>{EMPRESA}</b>
          </span>
        </div>
        <p>
          © {new Date().getFullYear()} {EMPRESA} · {LEMA}
        </p>
      </div>
    </footer>
  )
}

/*
  El bloque de cierre que invita a entrar. Lo llevan las dos páginas con el
  mismo botón y distinto encabezado.
*/
export function LlamadaAIngresar({ titulo, texto }) {
  return (
    <section className="lp-cta">
      <div className="wrap" data-reveal>
        <h2>{titulo}</h2>
        <p>{texto}</p>
        <div className="lp-cta-row">
          <Link to="/login" className="btn btn-primary btn-lg">
            INGRESAR AL SISTEMA
          </Link>
        </div>
      </div>
    </section>
  )
}
