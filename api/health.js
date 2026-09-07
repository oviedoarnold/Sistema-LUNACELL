/*
  Healthcheck de la API.

  No se limita a devolver "ok": eso solo probaría que Vercel está vivo, que
  es justo lo que nadie duda cuando la aplicación falla. Consulta la base y
  reporta si respondió, porque el modo de fallo real de este sistema es que
  el frontend cargue y no haya datos detrás.
*/

const URL_SUPABASE = process.env.VITE_SUPABASE_URL
const CLAVE_PUBLICABLE = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

const CODIGO_VERIFICACION = "LEARN-CAP-50768C03"

async function medir(ruta) {
  const empezo = Date.now()

  try {
    const respuesta = await fetch(`${URL_SUPABASE}${ruta}`, {
      headers: { apikey: CLAVE_PUBLICABLE },
      signal: AbortSignal.timeout(5000),
    })

    return {
      estado: respuesta.ok ? "arriba" : "con errores",
      codigoHttp: respuesta.status,
      milisegundos: Date.now() - empezo,
    }
  } catch (problema) {
    return {
      estado: "inalcanzable",
      detalle:
        problema.name === "TimeoutError" ? "No respondió en 5 s" : problema.message,
      milisegundos: Date.now() - empezo,
    }
  }
}

/*
  La lectura se hace sin sesión y contra una tabla real. Que devuelva 200
  con la lista vacía prueba dos cosas de una vez: que PostgREST responde y
  que las políticas de acceso siguen puestas. Si algún día devolviera filas
  a un desconocido, el problema sería mucho peor que una caída.
*/
async function revisarDependencias() {
  if (!URL_SUPABASE || !CLAVE_PUBLICABLE) {
    const sinConfigurar = {
      estado: "sin configurar",
      detalle: "Faltan las variables de entorno.",
    }

    return { baseDeDatos: sinConfigurar, autenticacion: sinConfigurar }
  }

  const [baseDeDatos, autenticacion] = await Promise.all([
    medir("/rest/v1/empresas?select=id&limit=1"),
    medir("/auth/v1/health"),
  ])

  return { baseDeDatos, autenticacion }
}

export default async function handler(request, response) {
  const dependencias = await revisarDependencias()

  const sana = Object.values(dependencias).every((d) => d.estado === "arriba")

  response.setHeader("Content-Type", "application/json; charset=utf-8")

  // Un healthcheck cacheado no sirve para nada: siempre contestaría lo mismo.
  response.setHeader("Cache-Control", "no-store")

  response.status(sana ? 200 : 503).json({
    estado: sana ? "ok" : "degradado",
    servicio: "sistema-ferreteria",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    momento: new Date().toISOString(),
    codigoVerificacion: CODIGO_VERIFICACION,
    dependencias,
  })
}
