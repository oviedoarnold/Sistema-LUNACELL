// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"

import { NAV_ROUTES } from "./navigation"
import { config } from "../../middleware.js"
import { onRequest } from "../../functions/[[ruta]].js"
import { onRequestGet as salud } from "../../functions/api/health.js"

/*
  La configuración de Cloudflare Pages tiene que servir lo mismo que la de
  Vercel. Las dos conviven mientras dure la prueba en pages.dev, y lo que
  se agregue a una y se olvide en la otra no lo vería ningún build:

    _routes.json             qué rutas pasan por las funciones
    functions/[[ruta]].js    middleware.js + el armazón de la aplicación
    _redirects               las demás reescrituras de vercel.json
    _headers                 los encabezados de vercel.json
*/

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"))
const rutasDeFunciones = JSON.parse(readFileSync("public/_routes.json", "utf8"))
const redirecciones = readFileSync("public/_redirects", "utf8")
const encabezados = readFileSync("public/_headers", "utf8")
const serviceWorker = readFileSync("public/sw.js", "utf8")

function reglasDeRedireccion() {
  return redirecciones
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea && !linea.startsWith("#"))
    .map((linea) => linea.split(/\s+/))
}

function esReescritura(origen, destino) {
  return reglasDeRedireccion().some(
    ([o, d, codigo]) => o === origen && d === destino && codigo === "200"
  )
}

// { "/ruta": { "Nombre": "valor" } }, en el formato de _headers.
function reglasDeEncabezados() {
  const reglas = {}
  let actual = null

  for (const linea of encabezados.split("\n")) {
    if (!linea.trim() || linea.trim().startsWith("#")) continue

    if (/^\s/.test(linea)) {
      const separador = linea.indexOf(":")
      reglas[actual][linea.slice(0, separador).trim()] = linea.slice(separador + 1).trim()
    } else {
      actual = linea.trim()
      reglas[actual] = {}
    }
  }

  return reglas
}

function encabezadosDeVercel(origen) {
  const regla = vercel.headers.find((h) => h.source === origen)

  return Object.fromEntries(regla.headers.map((h) => [h.key, h.value]))
}

describe("Cloudflare Pages · rutas", () => {
  it("las funciones corren solo en las pantallas privadas y en el healthcheck", () => {
    expect([...rutasDeFunciones.include].sort()).toEqual(
      [...config.matcher, "/api/health"].sort()
    )
  })

  it.each(NAV_ROUTES.map((r) => r.path))(
    "%s pasa por la función que comprueba la sesión",
    (ruta) => {
      expect(rutasDeFunciones.include).toContain(ruta)
    }
  )

  // Vercel reescribe también lo que cuelga de cada pantalla, sin proteger.
  it.each(["/demo", ...NAV_ROUTES.map((r) => r.path).filter((r) => r.split("/").length === 2)])(
    "%s/* se sirve como la aplicación",
    (ruta) => {
      expect(esReescritura(`${ruta}/*`, "/")).toBe(true)
    }
  )

  it("/demo se sirve como la aplicación, sin pasar por la función", () => {
    expect(esReescritura("/demo", "/")).toBe(true)
    expect(rutasDeFunciones.include).not.toContain("/demo")
  })

  it("/login no pasa por la función, o no se podría entrar", () => {
    expect(rutasDeFunciones.include).not.toContain("/login")
  })

  /*
    Pages redirige x.html a x. El service worker precarga /index.html y
    /login.html por su nombre: sin la reescritura guardaría redirecciones,
    y una respuesta redirigida no se puede entregar a una navegación. Sin
    red, la aplicación no abriría.
  */
  it.each(
    [...serviceWorker.matchAll(/"(\/[a-z-]+)\.html"/g)]
      .map((m) => m[1])
      .filter((nombre) => nombre !== "/offline")
  )("%s.html del service worker se sirve sin redirección", (nombre) => {
    const limpio = nombre === "/index" ? "/" : nombre

    expect(esReescritura(`${nombre}.html`, limpio)).toBe(true)
  })
})

describe("Cloudflare Pages · encabezados", () => {
  const reglas = reglasDeEncabezados()

  it("lleva los mismos encabezados de seguridad que Vercel, con los mismos valores", () => {
    expect(reglas["/*"]).toEqual(encabezadosDeVercel("/(.*)"))
  })

  it("los archivos con hash se cachean un año", () => {
    expect(reglas["/assets/*"]).toEqual(encabezadosDeVercel("/assets/(.*)"))
  })

  /*
    Si el service worker o el index se cachearan, un despliegue nuevo no
    llegaría a nadie hasta que caducara la copia.
  */
  it.each(["/", "/index.html", "/sw.js", "/manifest.webmanifest"])(
    "%s se revalida en cada visita",
    (ruta) => {
      expect(reglas[ruta]).toEqual(encabezadosDeVercel("/(index.html|sw.js|manifest.webmanifest)"))
    }
  )

  it.each(["/icons/*", "/imagenes/*"])("%s se cachea un día", (ruta) => {
    expect(reglas[ruta]).toEqual(encabezadosDeVercel("/(icons|imagenes)/(.*)"))
  })

  it("cada línea cabe en el límite de Pages", () => {
    const largas = encabezados.split("\n").filter((linea) => linea.length > 2000)

    expect(largas).toEqual([])
  })
})

describe("Cloudflare Pages · función de las pantallas privadas", () => {
  function pedir(ruta, cookie) {
    const armazon = new Response("armazón")
    const contexto = {
      request: new Request(`https://lunacell.pages.dev${ruta}`, {
        headers: cookie ? { cookie } : {},
      }),
      env: { ASSETS: { fetch: vi.fn(() => armazon) } },
      next: vi.fn(() => new Response("siguiente")),
    }

    return { contexto, armazon }
  }

  it("sin la marca de sesión manda al login con un 307", async () => {
    const { contexto } = pedir("/pos")
    const respuesta = await onRequest(contexto)

    expect(respuesta.status).toBe(307)
    expect(respuesta.headers.get("location")).toBe("https://lunacell.pages.dev/login")
    expect(contexto.env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it("con la marca sirve el armazón pidiéndolo como /", async () => {
    const { contexto, armazon } = pedir("/inventory/transfers", "otra=2; lunacell-sesion=1")

    expect(await onRequest(contexto)).toBe(armazon)
    expect(contexto.env.ASSETS.fetch.mock.calls[0][0].href).toBe("https://lunacell.pages.dev/")
  })

  it("lo que no protege middleware.js sigue de largo", async () => {
    const { contexto } = pedir("/login")

    await onRequest(contexto)

    expect(contexto.next).toHaveBeenCalled()
    expect(contexto.env.ASSETS.fetch).not.toHaveBeenCalled()
  })
})

describe("Cloudflare Pages · healthcheck", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("sin variables responde 503 y no se cachea", async () => {
    const respuesta = await salud({ env: {} })

    expect(respuesta.status).toBe(503)
    expect(respuesta.headers.get("cache-control")).toBe("no-store")
    expect((await respuesta.json()).dependencias.baseDeDatos.estado).toBe("sin configurar")
  })

  it("con la base y la autenticación arriba responde 200 con la versión", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("[]"))))

    const respuesta = await salud({
      env: {
        VITE_SUPABASE_URL: "https://ejemplo.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "clave-publica",
        CF_PAGES_COMMIT_SHA: "37d020711d090d11",
      },
    })
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(200)
    expect(cuerpo.estado).toBe("ok")
    expect(cuerpo.version).toBe("37d0207")
    expect(fetch).toHaveBeenCalledWith(
      "https://ejemplo.supabase.co/auth/v1/health",
      expect.objectContaining({ headers: { apikey: "clave-publica" } })
    )
  })
})
