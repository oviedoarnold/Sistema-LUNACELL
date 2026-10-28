/*
  Healthcheck en Cloudflare Pages: lo mismo que api/health.js en Vercel.

  Las variables se leen de env y no de process.env, que en Cloudflare no
  existe. Tienen que estar definidas en el proyecto de Pages para la
  compilación y para las funciones; son las mismas dos variables públicas.
*/

import { revisarSalud } from "../../api/_salud.js"

export async function onRequestGet({ env }) {
  const { codigoHttp, cuerpo } = await revisarSalud({
    url: env.VITE_SUPABASE_URL,
    clave: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    version: env.CF_PAGES_COMMIT_SHA,
  })

  return new Response(JSON.stringify(cuerpo), {
    status: codigoHttp,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Un healthcheck cacheado no sirve para nada: siempre contestaría lo mismo.
      "Cache-Control": "no-store",
    },
  })
}
