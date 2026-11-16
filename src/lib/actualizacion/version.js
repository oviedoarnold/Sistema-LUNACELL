/*
  La versión con la que se compiló el JavaScript que está corriendo.

  La pone vite.config.js en la compilación, con el mismo commit y la misma
  forma que /api/health: los siete primeros caracteres del SHA que publica
  Cloudflare Pages (o Vercel, el respaldo). Fuera de una compilación de
  despliegue vale "local", y entonces la actualización automática no hace
  nada: no hay contra qué comparar.

  Es la versión del JavaScript cargado, no la del servidor: la del servidor
  se lee de /version.json, que sale de la misma compilación.
*/
export const VERSION_DEL_FRONTEND =
  // eslint-disable-next-line no-undef
  typeof __LUNACELL_VERSION__ === "string" ? __LUNACELL_VERSION__ : "local"
