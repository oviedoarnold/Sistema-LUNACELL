/*
  La versión de una compilación: el mismo commit y la misma forma que
  devuelve /api/health (los siete primeros caracteres del SHA que publica
  Cloudflare Pages, o Vercel en el respaldo). Fuera de un despliegue vale
  "local" y la actualización automática no hace nada.

  La usa vite.config.js para escribirla en el JavaScript y en version.json.
*/
export function versionDeLaCompilacion(entorno = process.env) {
  return (entorno.CF_PAGES_COMMIT_SHA || entorno.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'local'
}
