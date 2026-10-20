import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

/*
  Pruebas del service worker de public/sw.js.

  No se importa como módulo porque no lo es: es un script que se registra
  sobre su propio ámbito global y se comunica por eventos. Se ejecuta aquí
  dentro de un contexto con un `self` y un `caches` de mentira, y se
  disparan los eventos a mano.

  Lo que se protege es la migración de caché. Al renombrar el cache de
  "ferreteria-v1" a "lunacell-v1", lo único que retira el nombre viejo del
  navegador de quien ya visitó el sitio es el manejador de activate. Si
  alguien lo tocara sin darse cuenta, los usuarios se quedarían con la
  caché del sistema anterior y no habría forma de notarlo desde la
  aplicación.
*/

const FUENTE = readFileSync("public/sw.js", "utf8")

const CACHE_ACTUAL = "lunacell-v1"
const CACHE_HEREDADO = "ferreteria-v1"

function montarServiceWorker({ cachesExistentes = [], fetch: pedir } = {}) {
  const borradas = []
  const guardadas = []
  const manejadores = {}

  const cacheFalso = {
    add: () => Promise.resolve(),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
    match: () => Promise.resolve(undefined),
    put: (clave) => {
      guardadas.push(clave)
      return Promise.resolve()
    },
  }

  const contexto = {
    console,
    URL,
    Set,
    Promise,
    fetch: pedir || (() => Promise.resolve({ ok: true, clone: () => ({}) })),

    caches: {
      open: () => Promise.resolve(cacheFalso),
      keys: () => Promise.resolve([...cachesExistentes]),
      match: () => Promise.resolve(undefined),
      delete: (nombre) => {
        borradas.push(nombre)
        return Promise.resolve(true)
      },
    },

    self: {
      location: { origin: "https://lunacell.oviedoarnold.lat" },
      addEventListener: (nombre, fn) => {
        manejadores[nombre] = fn
      },
      skipWaiting: () => {
        contexto.self.skipWaitingLlamado = true
        return Promise.resolve()
      },
      clients: {
        claim: () => {
          contexto.self.claimLlamado = true
          return Promise.resolve()
        },
      },
      skipWaitingLlamado: false,
      claimLlamado: false,
    },
  }

  runInNewContext(FUENTE, contexto)

  /*
    waitUntil recibe la promesa del manejador; esperarla es lo que permite
    comprobar el resultado, igual que hace el navegador antes de dar el
    evento por terminado.
  */
  const disparar = async (evento) => {
    let trabajo = Promise.resolve()
    await manejadores[evento]({ waitUntil: (p) => (trabajo = p) })
    await trabajo
  }

  // Una petición como la entrega el navegador; devuelve lo que respondió.
  const pedirPagina = async (url, mode = "navigate") => {
    let respuesta
    manejadores.fetch({
      request: { url, mode, method: "GET" },
      respondWith: (p) => (respuesta = p),
    })
    return respuesta
  }

  return { contexto, borradas, guardadas, manejadores, disparar, pedirPagina }
}

describe("service worker · migración de caché", () => {
  let sw

  beforeEach(() => {
    sw = montarServiceWorker({
      cachesExistentes: [CACHE_HEREDADO, CACHE_ACTUAL, "otra-cosa-v3"],
    })
  })

  it("registra los manejadores de instalación, activación y peticiones", () => {
    expect(Object.keys(sw.manejadores).sort()).toEqual([
      "activate",
      "fetch",
      "install",
    ])
  })

  it("borra la caché heredada del sistema anterior al activarse", async () => {
    // Arrange: el navegador trae la caché vieja de Ferretería.
    // Act
    await sw.disparar("activate")

    // Assert
    expect(sw.borradas).toContain(CACHE_HEREDADO)
  })

  it("conserva la caché de la versión actual", async () => {
    await sw.disparar("activate")

    expect(sw.borradas).not.toContain(CACHE_ACTUAL)
  })

  it("borra cualquier caché ajena a esta versión", async () => {
    await sw.disparar("activate")

    expect(sw.borradas).toContain("otra-cosa-v3")
  })

  it("toma el control de las pestañas abiertas sin esperar a que se cierren", async () => {
    await sw.disparar("activate")

    expect(sw.contexto.self.claimLlamado).toBe(true)
  })

  /*
    Sin skipWaiting el service worker nuevo espera a que se cierren todas
    las pestañas del sitio para activarse, y mientras tanto el usuario
    sigue con la versión anterior después de un despliegue.
  */
  it("no se queda esperando en la instalación", async () => {
    await sw.disparar("install")

    expect(sw.contexto.self.skipWaitingLlamado).toBe(true)
  })

  it("no borra nada cuando la única caché es la actual", async () => {
    const limpio = montarServiceWorker({ cachesExistentes: [CACHE_ACTUAL] })

    await limpio.disparar("activate")

    expect(limpio.borradas).toEqual([])
  })
})

describe("service worker · nombre de la caché", () => {
  /*
    El nombre viaja en el navegador de cada usuario: si vuelve a llamarse
    como el del sistema anterior, la migración de arriba deja de tener
    sentido.
  */
  it("usa un nombre propio de LUNACELL", () => {
    expect(FUENTE).toContain(`const CACHE_NAME = "${CACHE_ACTUAL}"`)
  })

  it("no declara el nombre heredado como caché activa", () => {
    expect(FUENTE).not.toContain(`const CACHE_NAME = "${CACHE_HEREDADO}"`)
  })
})

/*
  La aplicación instalada abre en /pos. Si quien la abre con conexión no tiene
  la marca de sesión, el middleware responde 307 hacia /login, y el navegador
  entrega esa redirección al service worker sin seguirla. Guardarla como
  «/index.html» haría que, sin red, la aplicación respondiera con esa
  redirección en vez de abrir: el vendedor no podría facturar sin conexión.
*/
describe("service worker · navegación", () => {
  const respuesta = (datos) => ({ ...datos, clone: () => ({ ...datos }) })

  it("guarda la aplicación cuando el servidor la entrega bien", async () => {
    const sw = montarServiceWorker({
      fetch: () => Promise.resolve(respuesta({ ok: true, status: 200, type: "basic", redirected: false })),
    })

    await sw.pedirPagina("https://lunacell.oviedoarnold.lat/pos")

    expect(sw.guardadas).toEqual(["/index.html"])
  })

  it("no guarda la redirección del middleware al login", async () => {
    const sw = montarServiceWorker({
      fetch: () => Promise.resolve(respuesta({ ok: false, status: 0, type: "opaqueredirect", redirected: false })),
    })

    const entregada = await sw.pedirPagina("https://lunacell.oviedoarnold.lat/pos")

    expect(entregada.type).toBe("opaqueredirect")
    expect(sw.guardadas).toEqual([])
  })

  it("no guarda una respuesta que llegó tras una redirección", async () => {
    const sw = montarServiceWorker({
      fetch: () => Promise.resolve(respuesta({ ok: true, status: 200, type: "basic", redirected: true })),
    })

    await sw.pedirPagina("https://lunacell.oviedoarnold.lat/pos")

    expect(sw.guardadas).toEqual([])
  })

  it("no guarda un error del servidor", async () => {
    const sw = montarServiceWorker({
      fetch: () => Promise.resolve(respuesta({ ok: false, status: 500, type: "basic", redirected: false })),
    })

    await sw.pedirPagina("https://lunacell.oviedoarnold.lat/pos")

    expect(sw.guardadas).toEqual([])
  })
})
