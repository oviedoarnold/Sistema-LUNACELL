/*
  Protecciones del modo de pruebas (entorno local, ver docs/entorno-local.md).

  El frontend de pruebas solo puede hablar con el Supabase LOCAL: directo
  (127.0.0.1 / localhost, desde la PC) o publicado en la red privada con
  Tailscale Serve (*.ts.net, desde los teléfonos). Nunca con un proyecto de
  Supabase en la nube: ni producción ni ningún otro.

  Uso (desde la raíz del repositorio):
    node scripts/entornoDePruebas.mjs verificar   revisa .env.pruebas
    node scripts/entornoDePruebas.mjs compilar    revisa, compila en dist-pruebas y revisa el resultado
    node scripts/entornoDePruebas.mjs servir      sirve dist-pruebas solo en 127.0.0.1:4173
*/
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const REF_PRODUCCION = "qlzkriyibpbnesidtiiy"
export const CARPETA_DE_PRUEBAS = "dist-pruebas"

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/
const TAILSCALE = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net(:\d+)?\/?$/

// La lista de problemas; vacía si la configuración es segura.
export function revisarConfiguracion(variables) {
  const url = String(variables.VITE_SUPABASE_URL || "").trim()
  const clave = String(variables.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim()
  const errores = []

  if (!url) {
    errores.push("Falta VITE_SUPABASE_URL en .env.pruebas.")
  } else if (url.includes(REF_PRODUCCION)) {
    errores.push(`VITE_SUPABASE_URL apunta a PRODUCCIÓN (${REF_PRODUCCION}). Nunca en modo de pruebas.`)
  } else if (/supabase\.(co|in)/i.test(url)) {
    errores.push("VITE_SUPABASE_URL apunta a un proyecto de Supabase en la nube. En pruebas solo se usa el Supabase local.")
  } else if (!LOCAL.test(url) && !TAILSCALE.test(url)) {
    errores.push("VITE_SUPABASE_URL debe ser el Supabase local: http://127.0.0.1:54321 o la URL https://<pc>.<red>.ts.net:8443 de Tailscale Serve.")
  }

  if (!clave) errores.push("Falta VITE_SUPABASE_PUBLISHABLE_KEY (la clave publicable LOCAL que muestra `npx supabase status`).")

  return errores
}

/*
  ¿El build apunta a algún proyecto de Supabase en la nube? Se busca la URL
  de un proyecto (https://<ref>.supabase.co), no el texto «supabase.co»:
  supabase-js trae el literal `*.supabase.co` y eso no apunta a nada.
*/
const PROYECTO_EN_LA_NUBE = /https?:\/\/[a-z0-9-]+\.supabase\.(co|in)/i

export function buscarProduccionEnElBuild(contenidos) {
  return contenidos.some((texto) => texto.includes(REF_PRODUCCION) || PROYECTO_EN_LA_NUBE.test(texto))
}

function archivosDe(carpeta) {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = path.join(carpeta, nombre)
    return statSync(ruta).isDirectory() ? archivosDe(ruta) : [ruta]
  })
}

async function principal(orden) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const { loadEnv } = await import("vite")

  if (!existsSync(path.join(raiz, ".env.pruebas")) && !existsSync(path.join(raiz, ".env.pruebas.local"))) {
    console.error("No existe .env.pruebas. Créalo como indica docs/entorno-local.md.")
    process.exit(1)
  }

  // Lo que Vite usará de verdad en modo pruebas (.env.pruebas manda sobre .env.local).
  const errores = revisarConfiguracion(loadEnv("pruebas", raiz, "VITE_"))

  if (errores.length) {
    for (const error of errores) console.error(`✖ ${error}`)
    process.exit(1)
  }

  console.log("✔ .env.pruebas apunta solo al Supabase local.")

  if (orden === "compilar") {
    const salida = path.join(raiz, CARPETA_DE_PRUEBAS)
    const compilado = spawnSync("npx", ["vite", "build", "--mode", "pruebas", "--outDir", CARPETA_DE_PRUEBAS, "--emptyOutDir"], {
      cwd: raiz,
      stdio: "inherit",
      shell: true,
    })

    if (compilado.status !== 0) process.exit(compilado.status || 1)

    const textos = archivosDe(salida)
      .filter((f) => /\.(js|html|json|webmanifest|css)$/.test(f))
      .map((f) => readFileSync(f, "utf8"))

    if (buscarProduccionEnElBuild(textos)) {
      rmSync(salida, { recursive: true, force: true })
      console.error("✖ PELIGRO: el build menciona Supabase en la nube. Se borró dist-pruebas. Revisa .env.pruebas.")
      process.exit(1)
    }

    console.log(`✔ Build de pruebas listo en ${CARPETA_DE_PRUEBAS}/ y sin rastros de Supabase en la nube.`)
  }

  if (orden === "servir") {
    if (!existsSync(path.join(raiz, CARPETA_DE_PRUEBAS))) {
      console.error("No existe dist-pruebas: corre primero `npm run pruebas:compilar`.")
      process.exit(1)
    }

    // Solo en 127.0.0.1: a los teléfonos llega por Tailscale Serve, no por la red local.
    spawnSync(
      "npx",
      ["vite", "preview", "--mode", "pruebas", "--outDir", CARPETA_DE_PRUEBAS, "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
      { cwd: raiz, stdio: "inherit", shell: true }
    )
  }
}

const ordenes = new Set(["verificar", "compilar", "servir"])
const orden = process.argv[2]

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!ordenes.has(orden)) {
    console.error("Uso: node scripts/entornoDePruebas.mjs verificar|compilar|servir")
    process.exit(1)
  }

  await principal(orden)
}
