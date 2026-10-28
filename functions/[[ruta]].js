/*
  Las pantallas privadas en Cloudflare Pages: lo que en Vercel hacen juntos
  middleware.js y las reescrituras de vercel.json.

  Sin la marca de sesión, la misma redirección al login de middleware.js,
  que se reutiliza tal cual. Con ella, el armazón de la aplicación.

  public/_routes.json limita esta función a las rutas del matcher y al
  healthcheck: el resto —los archivos, /login, /demo— lo sirve Pages
  directamente, sin gastar invocaciones del plan.

  El armazón se pide como "/" y no como "/index.html": Pages redirige
  /index.html a / y la pantalla llegaría como una redirección.
*/

import middleware, { config } from "../middleware.js"

export async function onRequest({ request, env, next }) {
  const ruta = new URL(request.url).pathname

  if (!config.matcher.includes(ruta)) {
    return next()
  }

  const alLogin = middleware(request)

  if (alLogin) {
    return alLogin
  }

  return env.ASSETS.fetch(new URL("/", request.url))
}
