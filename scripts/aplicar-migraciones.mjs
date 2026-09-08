/*
  Aplica migraciones al Supabase de desarrollo desde la línea de comandos.

  Existe para que la base de desarrollo evolucione junto con el código, sin
  pasar por el editor SQL del panel. La alternativa —`supabase db push`— no
  sirve en este repositorio: aplicaría también las migraciones de datos de
  demostración y exige que los archivos se llamen con la marca de tiempo de
  catorce dígitos que usa el CLI, lo que obligaría a renumerar migraciones
  ya aplicadas.

  ─────────────────────────────────────────────────────────
  CREDENCIAL
  ─────────────────────────────────────────────────────────
  Lee el token de la variable de entorno SUPABASE_ACCESS_TOKEN. Nunca se
  escribe en el repositorio, no se imprime y no se guarda en ningún
  archivo: se pasa al proceso y muere con él.

  El token se genera en https://supabase.com/dashboard/account/tokens y se
  revoca desde ahí mismo cuando ya no haga falta.

  ─────────────────────────────────────────────────────────
  USO
  ─────────────────────────────────────────────────────────
    SUPABASE_ACCESS_TOKEN=sbp_... node scripts/aplicar-migraciones.mjs \
      --ref qlzkriyibpbnesidtiiy \
      0001_esquema_inicial.sql 0003_permisos_solo_propios.sql

    --ref <id>     obligatorio; se compara contra el proyecto real antes de
                   escribir nada, para no tocar el proyecto equivocado
    --todas        aplica todas las del directorio menos las de demostración
    --dry-run      dice qué haría, sin ejecutar
*/

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const API = "https://api.supabase.com/v1"
const DIRECTORIO = "supabase/migrations"
const CRUZ = "✗"

/*
  Cargan la ferretería de demostración: su empresa, sus productos, sus
  ventas y las cuentas invitadas de aquel proyecto. Aplicarlas a LUNACELL
  sería sembrar datos de otro negocio, así que el script se niega aunque se
  las pida por su nombre.
*/
const MIGRACIONES_DE_DEMOSTRACION = [
  "0002_datos_demo.sql",
  "0006_demo_admin_y_fiscal.sql",
  "0010_permisos_de_la_cuenta_demo.sql",
]

const token = process.env.SUPABASE_ACCESS_TOKEN

/*
  Lanza en vez de llamar a process.exit().

  Con una petición HTTP todavía abierta, process.exit() aborta el proceso
  en Windows con "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" y
  devuelve 127: el mensaje se imprime, pero el código de salida deja de
  distinguir un fallo previsto de una caída. Lanzando, Node cierra los
  sockets solo y el código sigue siendo 1.
*/
class FalloDeMigracion extends Error {}

function morir(mensaje) {
  throw new FalloDeMigracion(mensaje)
}

async function llamar(ruta, opciones = {}) {
  const respuesta = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...opciones.headers,
    },
  })

  const texto = await respuesta.text()
  let cuerpo

  try {
    cuerpo = texto ? JSON.parse(texto) : null
  } catch {
    cuerpo = texto
  }

  return { ok: respuesta.ok, estado: respuesta.status, cuerpo }
}

export const ejecutarSql = (ref, sql) =>
  llamar(`/projects/${ref}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query: sql }),
  })

/*
  Antes de escribir una sola sentencia se comprueba contra qué proyecto se
  está hablando. Aplicar el esquema al proyecto equivocado es el error caro
  de este script, y es barato de descartar.
*/
async function confirmarProyecto(ref) {
  const { ok, estado, cuerpo } = await llamar("/projects")

  if (!ok) {
    morir(
      estado === 401
        ? "El token no es válido o venció. Genera uno nuevo en https://supabase.com/dashboard/account/tokens"
        : `La API respondió ${estado}: ${JSON.stringify(cuerpo)}`
    )
  }

  const proyecto = (cuerpo || []).find((p) => p.id === ref)

  if (!proyecto) {
    const disponibles = (cuerpo || []).map((p) => `${p.name} (${p.id})`)

    morir(
      `El token no da acceso al proyecto ${ref}.\n  Proyectos visibles: ${
        disponibles.join(", ") || "ninguno"
      }`
    )
  }

  return proyecto
}

function elegirMigraciones(argumentos) {
  const todas = readdirSync(DIRECTORIO)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  if (argumentos.includes("--todas")) {
    return todas.filter((f) => !MIGRACIONES_DE_DEMOSTRACION.includes(f))
  }

  const pedidas = argumentos.filter((a) => !a.startsWith("--"))

  if (!pedidas.length) {
    morir(
      `Indica qué migraciones aplicar, o --todas.\n  Disponibles: ${todas.join(", ")}`
    )
  }

  for (const nombre of pedidas) {
    if (!todas.includes(nombre)) {
      morir(`No existe ${DIRECTORIO}/${nombre}`)
    }
  }

  return pedidas
}

async function principal() {
  if (!token) {
    morir(
      "Falta SUPABASE_ACCESS_TOKEN.\n" +
        "  Genera un token en https://supabase.com/dashboard/account/tokens y pásalo así:\n" +
        "  SUPABASE_ACCESS_TOKEN=sbp_... node scripts/aplicar-migraciones.mjs --ref <id> <archivos>"
    )
  }

  const argumentos = process.argv.slice(2)
  const posicionRef = argumentos.indexOf("--ref")
  const ref = posicionRef === -1 ? null : argumentos[posicionRef + 1]

  if (!ref) morir("Falta --ref con el identificador del proyecto.")

  const migraciones = elegirMigraciones(
    argumentos.filter((_, i) => i !== posicionRef && i !== posicionRef + 1)
  )

  const demoPedidas = migraciones.filter((m) =>
    MIGRACIONES_DE_DEMOSTRACION.includes(m)
  )

  if (demoPedidas.length) {
    morir(
      `Estas migraciones cargan datos de la ferretería de demostración: ${demoPedidas.join(
        ", "
      )}.\n  Si de verdad las quieres, aplícalas a mano sabiendo lo que hacen.`
    )
  }

  const proyecto = await confirmarProyecto(ref)

  console.log(`\nProyecto   : ${proyecto.name} (${proyecto.id})`)
  console.log(`Región     : ${proyecto.region}`)
  console.log(`Migraciones: ${migraciones.length}\n`)

  if (argumentos.includes("--dry-run")) {
    migraciones.forEach((m) => console.log(`  [dry-run] ${m}`))
    console.log("\nNada se aplicó.\n")
    return
  }

  for (const nombre of migraciones) {
    const sql = readFileSync(join(DIRECTORIO, nombre), "utf8")

    process.stdout.write(`  ${nombre.padEnd(42)}`)

    const { ok, estado, cuerpo } = await ejecutarSql(ref, sql)

    if (!ok) {
      console.log("FALLÓ")

      morir(
        `${nombre} devolvió ${estado}:\n  ${JSON.stringify(cuerpo, null, 2)}\n\n` +
          "  Las migraciones anteriores sí se aplicaron. Corrige y vuelve a\n" +
          "  correr desde esta en adelante."
      )
    }

    console.log("ok")
  }

  console.log("\nTodas las migraciones se aplicaron.\n")
}

principal().catch((problema) => {
  console.error(`\n${CRUZ} ${problema.message}\n`)
  process.exitCode = 1
})
