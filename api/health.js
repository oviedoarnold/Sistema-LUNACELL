/*
  Healthcheck de la API.

  No se limita a devolver "ok": eso solo probaría que Vercel está vivo, que
  es justo lo que nadie duda cuando la aplicación falla. Consulta la base y
  reporta si respondió, porque el modo de fallo real de este sistema es que
  el frontend cargue y no haya datos detrás.

  La revisión vive en _salud.js, compartida con la versión de Cloudflare
  Pages (functions/api/health.js).
*/

import { revisarSalud } from "./_salud.js"

export default async function handler(request, response) {
  const { codigoHttp, cuerpo } = await revisarSalud({
    url: process.env.VITE_SUPABASE_URL,
    clave: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    version: process.env.VERCEL_GIT_COMMIT_SHA,
  })

  response.setHeader("Content-Type", "application/json; charset=utf-8")

  // Un healthcheck cacheado no sirve para nada: siempre contestaría lo mismo.
  response.setHeader("Cache-Control", "no-store")

  response.status(codigoHttp).json(cuerpo)
}
