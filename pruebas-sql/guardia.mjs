/*
  Guardia contra correr las pruebas destructivas sobre una base que no sea
  la desechable.

  Estas pruebas borran, insertan y confirman transacciones. Contra el
  proyecto de Supabase harían exactamente eso sobre el inventario y las
  facturas del cliente. La única defensa que sirve es que sea imposible
  apuntar a otro sitio, no que nadie se equivoque.

  De ahí que el arnés no lea ninguna variable de entorno para construir su
  conexión: el host, el puerto y el directorio los fija él. Esta función
  comprueba esa promesa antes de cada arranque, por si alguien cambia el
  arnés más adelante.
*/

const HOSTS_PERMITIDOS = new Set(["127.0.0.1", "::1", "localhost"])

/*
  Nombres de variables que en este repositorio apuntan a Supabase. No se
  usan aquí, y verlas mencionadas en una conexión sería la señal de que
  alguien cableó el arnés a un servidor de verdad.
*/
const VARIABLES_DE_PRODUCCION = [
  "VITE_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
]

export function exigirBaseDesechable({ host, port, databaseDir }) {
  if (!HOSTS_PERMITIDOS.has(host)) {
    throw new Error(
      `Las pruebas SQL solo corren contra una base local desechable. ` +
        `Se intentó conectar a "${host}", que no lo es.`
    )
  }

  if (!Number.isInteger(port) || port < 1024) {
    throw new Error(`Puerto inválido para la base de pruebas: ${port}`)
  }

  /*
    El directorio de datos tiene que estar en el temporal del sistema. Si
    apunta dentro del repositorio, una prueba interrumpida dejaría una base
    de datos entera versionada sin querer.
  */
  if (!databaseDir || !/lunacell-pruebas-sql/.test(databaseDir)) {
    throw new Error(
      `El directorio de la base de pruebas debe ser el desechable del ` +
        `arnés. Se recibió: ${databaseDir}`
    )
  }

  const filtradas = VARIABLES_DE_PRODUCCION.filter((v) => process.env[v])

  if (filtradas.length > 0) {
    /*
      No es un fallo: en una máquina de desarrollo esas variables existen
      para que arranque la aplicación. Lo que importa es dejar dicho, cada
      vez, que el arnés no las mira.
    */
    console.warn(
      `[pruebas-sql] Hay variables de Supabase en el entorno ` +
        `(${filtradas.join(", ")}). El arnés las ignora por completo: ` +
        `usa su propia base local en ${host}:${port}.`
    )
  }

  return true
}
