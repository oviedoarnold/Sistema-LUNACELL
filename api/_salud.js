/*
  La revisión del healthcheck, sin atarse a ninguna plataforma.

  La usan api/health.js en Vercel y functions/api/health.js en Cloudflare
  Pages. Cada una solo traduce su forma de recibir la petición y de leer
  las variables de entorno; lo que se revisa y cómo se contesta vive aquí,
  para que las dos digan exactamente lo mismo.

  El guion bajo del nombre le dice a Vercel que este archivo no es una ruta.
*/

async function medir(url, clave, ruta) {
  const empezo = Date.now()

  try {
    const respuesta = await fetch(`${url}${ruta}`, {
      headers: { apikey: clave },
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
async function revisarDependencias(url, clave) {
  if (!url || !clave) {
    const sinConfigurar = {
      estado: "sin configurar",
      detalle: "Faltan las variables de entorno.",
    }

    return { baseDeDatos: sinConfigurar, autenticacion: sinConfigurar }
  }

  const [baseDeDatos, autenticacion] = await Promise.all([
    medir(url, clave, "/rest/v1/empresas?select=id&limit=1"),
    medir(url, clave, "/auth/v1/health"),
  ])

  return { baseDeDatos, autenticacion }
}

export async function revisarSalud({ url, clave, version }) {
  const dependencias = await revisarDependencias(url, clave)

  const sana = Object.values(dependencias).every((d) => d.estado === "arriba")

  return {
    codigoHttp: sana ? 200 : 503,
    cuerpo: {
      estado: sana ? "ok" : "degradado",
      servicio: "lunacell",
      version: version?.slice(0, 7) || "local",
      momento: new Date().toISOString(),
      dependencias,
    },
  }
}
