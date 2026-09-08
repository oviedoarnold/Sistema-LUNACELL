import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

import { NAV_ROUTES } from "./navigation"

/*
  Una ruta privada vive en cinco sitios, y tres de ellos están fuera del
  código que ejecutan las demás pruebas:

    AppRouter      dibuja la pantalla
    navigation.js  ordena las pestañas y decide el desvío
    Navbar         la muestra en el menú
    vercel.json    la sirve cuando alguien escribe la dirección o recarga
    middleware.js  la protege en el borde

  Agregar Ubicaciones cubrió los tres primeros y olvidó los dos últimos.
  El resultado no se vio en ninguna prueba ni en el build: la pestaña
  funcionaba al pulsarla —React Router resuelve en el navegador— pero
  escribir /locations o recargar devolvía 404, y era la única pantalla
  privada que no rebotaba al login en el borde. Se descubrió en producción,
  con un navegador.

  Estas pruebas cierran ese hueco: cualquier ruta que entre en NAV_ROUTES
  tiene que aparecer también en la configuración de despliegue.
*/

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"))
const middleware = readFileSync("middleware.js", "utf8")

/*
  Las reglas de reescritura declaran las rutas como una alternancia dentro
  de una expresión regular: /(demo|dashboard|pos|...). Se saca esa lista en
  vez de comprobar la cadena entera, para que reordenarla no rompa nada.
*/
function rutasQueSirveVercel() {
  const rutas = new Set()

  for (const regla of vercel.rewrites || []) {
    const alternancia = regla.source.match(/\(([a-z0-9|-]+)\)/i)

    if (alternancia) {
      alternancia[1].split("|").forEach((r) => rutas.add("/" + r))
    } else {
      rutas.add(regla.source)
    }
  }

  return rutas
}

function rutasQueProtegeElMiddleware() {
  const bloque = middleware.match(/matcher:\s*\[([\s\S]*?)\]/)

  if (!bloque) {
    throw new Error("middleware.js no declara un matcher reconocible")
  }

  return new Set(
    [...bloque[1].matchAll(/"([^"]+)"/g)].map((coincidencia) => coincidencia[1])
  )
}

const SERVIDAS = rutasQueSirveVercel()
const PROTEGIDAS = rutasQueProtegeElMiddleware()

describe("rutas privadas · configuración de despliegue", () => {
  it("hay rutas que comprobar", () => {
    expect(NAV_ROUTES.length).toBeGreaterThan(0)
  })

  it.each(NAV_ROUTES.map((r) => r.path))(
    "%s se sirve al escribirla o recargar (vercel.json)",
    (ruta) => {
      expect(SERVIDAS).toContain(ruta)
    }
  )

  it.each(NAV_ROUTES.map((r) => r.path))(
    "%s queda protegida en el borde (middleware.js)",
    (ruta) => {
      expect(PROTEGIDAS).toContain(ruta)
    }
  )

  /*
    Al revés también: una ruta que el middleware proteja pero que ya no
    exista deja a la gente rebotando al login en una dirección muerta.
  */
  it("el middleware no protege rutas que ya no existen", () => {
    const conocidas = new Set(NAV_ROUTES.map((r) => r.path))
    const sobrantes = [...PROTEGIDAS].filter((r) => !conocidas.has(r))

    expect(sobrantes).toEqual([])
  })

  it("/login no se protege en el borde, o no se podría entrar", () => {
    expect(PROTEGIDAS).not.toContain("/login")
  })
})

describe("política de seguridad de contenido", () => {
  const csp = vercel.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === "Content-Security-Policy").value

  const SUPABASE_LUNACELL = "qlzkriyibpbnesidtiiy.supabase.co"

  /*
    La CSP nombra el proyecto de Supabase a mano porque Vercel no interpola
    variables de entorno en vercel.json. Cuando apuntaba al proyecto
    anterior, el navegador bloqueaba cada petición y el login respondía
    "Correo o contraseña incorrectos" con la contraseña correcta.
  */
  it("permite conectarse al Supabase de LUNACELL", () => {
    expect(csp).toContain(`connect-src 'self' https://${SUPABASE_LUNACELL}`)
    expect(csp).toContain(`wss://${SUPABASE_LUNACELL}`)
  })

  it("permite las imágenes de producto del Storage de LUNACELL", () => {
    expect(csp).toContain(`img-src 'self' data: blob: https://${SUPABASE_LUNACELL}`)
  })

  it("no autoriza ningún otro proyecto de Supabase", () => {
    const hosts = [...csp.matchAll(/([a-z0-9]+)\.supabase\.co/g)].map((m) => m[1])

    expect([...new Set(hosts)]).toEqual([SUPABASE_LUNACELL.split(".")[0]])
  })
})
