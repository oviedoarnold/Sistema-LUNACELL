/*
  Arnés de pruebas contra PostgreSQL de verdad.

  Existe porque el doble de `src/test/supabaseFalso.js` guarda filas en un
  objeto de JavaScript: no evalúa un CHECK, no aplica RLS, no tiene
  transacciones y no puede tener dos conexiones peleándose por una fila. Un
  reparto de dinero validado ahí estaría validado contra una imitación.

  Levanta un PostgreSQL desechable —binario real, mismo mayor que
  producción—, le aplica el preludio y después las migraciones del
  proyecto tal cual están en supabase/migrations. Nada se adapta: si una
  migración no corre aquí, tampoco correría allá.
*/

import EmbeddedPostgres from "embedded-postgres"
import { readFile, readdir, rm } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

import { exigirBaseDesechable } from "./guardia.mjs"

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const MIGRACIONES = path.join(AQUI, "..", "supabase", "migrations")

const HOST = "127.0.0.1"

/*
  Las tres que cargan la ferretería de demostración. El README de las
  migraciones ya dice que no se corren en una base de LUNACELL, y aquí
  además ensuciarían las pruebas con ventas y clientes que nadie pidió.
*/
const SOLO_DEMO = new Set([
  "0002_datos_demo.sql",
  "0006_demo_admin_y_fiscal.sql",
  "0010_permisos_de_la_cuenta_demo.sql",
])

export async function listarMigraciones() {
  const archivos = await readdir(MIGRACIONES)

  return archivos
    .filter((f) => f.endsWith(".sql") && !SOLO_DEMO.has(f))
    .sort()
}

/*
  Un puerto por proceso de prueba. Vitest puede levantar varios archivos a
  la vez y dos postmaster en el mismo puerto se pisan.
*/
function puertoLibre() {
  return 55000 + (process.pid % 2000)
}

/*
  Aplica una migración del proyecto tal cual está en el repositorio.
  Separada para poder aplicar las últimas a mano sobre una base que ya
  tiene datos, que es como llegan a producción.
*/
export async function aplicarMigracion(cliente, archivo) {
  const sql = await readFile(path.join(MIGRACIONES, archivo), "utf8")

  try {
    await cliente.query(sql)
  } catch (problema) {
    throw new Error(`La migración ${archivo} falló: ${problema.message}`)
  }
}

/*
  `hasta`: el nombre de la última migración a aplicar (incluida). Sin él
  se aplican todas.
*/
export async function levantarBase({ hasta = null } = {}) {
  const port = puertoLibre()
  const databaseDir = path.join(
    os.tmpdir(),
    `lunacell-pruebas-sql-${process.pid}`
  )

  // Antes de nada: que esto no pueda ser la base del cliente.
  exigirBaseDesechable({ host: HOST, port, databaseDir })

  await rm(databaseDir, { recursive: true, force: true })

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    /*
      En Windows, initdb elige la codificación del sistema y las
      migraciones traen acentos y eñes en sus comentarios y mensajes. Sin
      esto, la primera migración con una "ñ" muere con
      "character with byte sequence ... has no equivalent".
    */
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  })

  await pg.initialise()
  await pg.start()

  /*
    La base se crea a mano y no con createDatabase() para poder exigir
    UTF8 desde template0: heredar de template1 arrastraría la codificación
    que initdb haya dejado en el clúster.
  */
  const arranque = pg.getPgClient("postgres")
  await arranque.connect()
  await arranque.query(
    "create database lunacell encoding 'UTF8' template template0"
  )
  await arranque.end()

  const admin = pg.getPgClient("lunacell")
  await admin.connect()
  await admin.query("set client_encoding to 'UTF8'")

  const preludio = await readFile(
    path.join(AQUI, "preludio-supabase.sql"),
    "utf8"
  )
  await admin.query(preludio)

  for (const archivo of await listarMigraciones()) {
    if (hasta && archivo > hasta) break

    await aplicarMigracion(admin, archivo)
  }

  return {
    pg,
    admin,
    port,
    databaseDir,

    /* Una conexión más, para las pruebas que necesitan dos sesiones. */
    async conectar() {
      const cliente = pg.getPgClient("lunacell")
      await cliente.connect()

      return cliente
    },

    async cerrar() {
      await admin.end().catch(() => {})
      await pg.stop().catch(() => {})
      await rm(databaseDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/*
  Hacer que una conexión hable como un usuario concreto, igual que hace
  PostgREST: fija el JWT y baja el rol a authenticated, que es donde RLS
  empieza a aplicar. Con usuario en null queda como anónimo.
*/
export async function comoUsuario(cliente, authId) {
  await cliente.query("reset role")
  await cliente.query("select set_config('request.jwt.claims', $1, false)", [
    authId ? JSON.stringify({ sub: authId, role: "authenticated" }) : "",
  ])
  await cliente.query(`set role ${authId ? "authenticated" : "anon"}`)
}

export async function comoDueno(cliente) {
  await cliente.query("reset role")
  await cliente.query("select set_config('request.jwt.claims', '', false)")
}

/*
  Una consulta como ese usuario (null = anónimo), y la conexión vuelve a
  ser del dueño pase lo que pase: la siguiente prueba no hereda el rol.
*/
export async function consultarComo(cliente, authId, consulta, valores = []) {
  await comoUsuario(cliente, authId)

  try {
    return await cliente.query(consulta, valores)
  } finally {
    await comoDueno(cliente)
  }
}

/*
  Espera a que una sesión esté de verdad detenida esperando un candado, y
  falla si no llega a estarlo.

  Es lo que convierte la prueba de concurrencia en una prueba. Sin esto,
  lanzar dos consultas y mirar el resultado solo comprueba en qué orden las
  mandó el bucle de eventos de Node: si la segunda alcanza a empezar
  después de que la primera confirmara, el caso pasa igual aunque no
  hubiera un solo candado en la función. Se comprobó quitándolos.

  Aquí, en cambio, la prueba no avanza hasta que PostgreSQL diga que esa
  sesión está parada esperando; si nunca lo dice, salta el tiempo y el caso
  falla.
*/
export async function esperarBloqueo(observador, pid, milisegundos = 5000) {
  const hasta = Date.now() + milisegundos

  while (Date.now() < hasta) {
    const { rows } = await observador.query(
      `select wait_event_type, wait_event, state
         from pg_stat_activity
        where pid = $1`,
      [pid]
    )

    if (rows[0]?.wait_event_type === "Lock") {
      return `${rows[0].wait_event_type}/${rows[0].wait_event}`
    }

    await new Promise((r) => setTimeout(r, 50))
  }

  throw new Error(
    `La sesión ${pid} nunca se bloqueó esperando un candado. ` +
      `Si esto salta, la operación no está serializando y dos pagos ` +
      `podrían gastar el mismo saldo.`
  )
}

/*
  Dos operaciones de dos usuarios, cada una en su propia sesión y su
  propia transacción, con la segunda obligada a esperar a la primera.

  La primera hace su parte y se queda sin confirmar. La segunda sale
  después, y no se sigue hasta que PostgreSQL confirme que está DETENIDA
  esperando un candado: si la operación no serializara, esa espera
  agotaría su tiempo y la prueba fallaría. Después la primera confirma y
  se devuelve lo que respondió la segunda, que confirma si entró y deshace
  si no.

  `observador` es la conexión del dueño: un rol sin privilegios no ve la
  espera de las sesiones ajenas en pg_stat_activity.
*/
export async function enDosSesiones(base, observador, { primera, segunda }) {
  const a = await base.conectar()
  const b = await base.conectar()

  try {
    await comoUsuario(a, primera.authId)
    await comoUsuario(b, segunda.authId)

    const pidB = (await b.query("select pg_backend_pid() as pid")).rows[0].pid

    await a.query("begin")
    await b.query("begin")

    await primera.hacer(a)

    // El rechazo de la segunda se recoge aquí mismo para que no quede suelto.
    const deB = segunda.hacer(b).then(
      (respuesta) => ({ respuesta }),
      (error) => ({ error })
    )

    const espera = await esperarBloqueo(observador, pidB)

    await a.query("commit")

    const resultado = await deB

    await b.query(resultado.error ? "rollback" : "commit")

    return { ...resultado, espera }
  } finally {
    await a.end()
    await b.end()
  }
}
