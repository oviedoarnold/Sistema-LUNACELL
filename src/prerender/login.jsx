import { renderToStaticMarkup } from "react-dom/server"

import FormularioDeLogin from "../components/FormularioDeLogin"

/*
  Genera el HTML del formulario de acceso en el momento de compilar.

  Se usa renderToStaticMarkup y no renderToString a propósito: la
  aplicación monta con createRoot y vuelve a dibujar la pantalla, así que
  los atributos que React necesita para hidratar no servirían de nada y
  solo agrandarían el archivo.
*/
export function renderizarLogin() {
  return renderToStaticMarkup(<FormularioDeLogin />)
}
