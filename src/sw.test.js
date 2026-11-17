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

function montarServiceWorker({ cachesExistentes = [], fetch: pedir, activa = null, ventanas = [] } = {}) {
  const borradas = []
  const guardadas = []
  const manejadores = {}
  const reloj = { ahora: 1_000_000, pendientes: [] }

  // Corre los temporizadores en orden, adelantando la hora, hasta que no quede nada.
  const correrReloj = async (vueltas = 2000) => {
    for (let i = 0; i < vueltas; i++) {
      for (let j = 0; j < 5; j++) await new Promise((r) => globalThis.setTimeout(r, 0))
      const vivos = reloj.pendientes.filter((p) => !p.hecho).sort((a, b) => a.cuando - b.cuando)
      if (!vivos.length) return
      const siguiente = vivos[0]
      siguiente.hecho = true
      reloj.ahora = Math.max(reloj.ahora, siguiente.cuando)
      siguiente.fn()
    }
  }

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
    Map,
    // Un reloj propio: cada espera adelanta la hora sin esperar de verdad.
    Date: { now: () => reloj.ahora },
    setTimeout: (fn, ms = 0) => {
      reloj.pendientes.push({ cuando: reloj.ahora + ms, fn })
      return reloj.pendientes.length
    },
    clearTimeout: (n) => {
      if (reloj.pendientes[n - 1]) reloj.pendientes[n - 1].hecho = true
    },

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
      registration: { active: activa },
      clients: {
        claim: () => {
          contexto.self.claimLlamado = true
          return Promise.resolve()
        },
        matchAll: () => Promise.resolve([...ventanas]),
        get: (id) => Promise.resolve(ventanas.find((v) => v.id === id) || null),
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

  // Una petición de una página ya abierta: devuelve lo que el service worker dejó pendiente.
  const peticionDe = (clientId, url, method = "GET") => {
    const trabajos = []
    manejadores.fetch({
      clientId,
      request: { url, mode: "cors", method },
      respondWith: () => {},
      waitUntil: (p) => trabajos.push(p),
    })
    return Promise.all(trabajos)
  }

  return { contexto, borradas, guardadas, manejadores, disparar, pedirPagina, peticionDe, reloj, correrReloj }
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
      "message",
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
    La versión nueva no toma el control sola en medio de una venta: espera a
    que la aplicación decida que es seguro y se lo pida (src/lib/actualizacion).
  */
  it("se instala sin activarse sola (la primera vez, sin versión anterior)", async () => {
    await sw.disparar("install")

    expect(sw.contexto.self.skipWaitingLlamado).toBe(false)
  })

  const ORIGEN = "https://lunacell.oviedoarnold.lat"

  it("se activa cuando la aplicación se lo pide, y solo con esa orden", () => {
    sw.manejadores.message({ origin: ORIGEN, data: { tipo: "OTRA_COSA" } })
    sw.manejadores.message({ origin: ORIGEN, data: null })
    expect(sw.contexto.self.skipWaitingLlamado).toBe(false)

    sw.manejadores.message({ origin: ORIGEN, data: { tipo: "ACTIVAR" } })
    expect(sw.contexto.self.skipWaitingLlamado).toBe(true)
  })

  it("también cuando el navegador no llena el origen, si la página es del mismo sitio", () => {
    sw.manejadores.message({ origin: "", source: { url: `${ORIGEN}/pos` }, data: { tipo: "ACTIVAR" } })

    expect(sw.contexto.self.skipWaitingLlamado).toBe(true)
  })

  it.each([
    ["otro origen", { origin: "https://otro.example", data: { tipo: "ACTIVAR" } }],
    ["una página de otro sitio sin origen", { origin: "", source: { url: "https://otro.example/x" }, data: { tipo: "ACTIVAR" } }],
    ["un mensaje sin origen ni página", { data: { tipo: "ACTIVAR" } }],
  ])("ignora la orden que llega de %s", (_, evento) => {
    sw.manejadores.message(evento)

    expect(sw.contexto.self.skipWaitingLlamado).toBe(false)
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

/*
  La versión publicada y las funciones del servidor no pasan por la caché:
  respondida desde ahí, la aplicación nunca vería que hay una versión nueva.
*/
describe("service worker · lo que siempre va a la red", () => {
  it.each(["/version.json?t=1", "/api/health"])("%s no se responde desde la caché", async (ruta) => {
    const sw = montarServiceWorker()

    expect(await sw.pedirPagina(`https://lunacell.oviedoarnold.lat${ruta}`, "cors")).toBeUndefined()
  })

  it("los archivos de la aplicación sí", async () => {
    const sw = montarServiceWorker()

    expect(await sw.pedirPagina("https://lunacell.oviedoarnold.lat/assets/index-abc.js", "cors")).toBeDefined()
  })
})

/*
  Las instalaciones anteriores al PR #89: su código no sabe pedirle al service
  worker que se active ni buscar versiones. El service worker las reconoce porque
  no contestan, y las recarga cuando pasan a segundo plano.
*/
describe("service worker · instalaciones anteriores al aviso de actualización", () => {
  const ORIGEN = "https://lunacell.oviedoarnold.lat"
  const DATOS = "https://qlzkriyibpbnesidtiiy.supabase.co/rest/v1/productos"

  // Una ventana: las actuales contestan a IDENTIFICATE; las antiguas, no.
  const ventana = (id, { actual = false, visible = true } = {}) => {
    const v = {
      id,
      type: "window",
      url: `${ORIGEN}/pos`,
      visibilityState: visible ? "visible" : "hidden",
      navegadaEn: null,
      navigate: () => {
        v.navegadaEn = v.sw.reloj.ahora
        return Promise.resolve(v)
      },
      postMessage: (mensaje) => {
        if (actual && mensaje.tipo === "IDENTIFICATE") {
          v.sw.manejadores.message({ origin: ORIGEN, source: v, data: { tipo: "SOY_ACTUAL" } })
        }
      },
    }
    return v
  }

  const montarCon = (ventanas) => {
    const sw = montarServiceWorker({ activa: { state: "activated" }, ventanas })
    for (const v of ventanas) v.sw = sw
    return sw
  }

  it("si ninguna página abierta sabe pedirlo, se activa sola: si no, se quedaría esperando para siempre", async () => {
    const sw = montarCon([ventana("vieja")])
    const instalando = sw.disparar("install")

    await sw.correrReloj()
    await instalando
    expect(sw.contexto.self.skipWaitingLlamado).toBe(true)
  })

  it("si hay una página actual abierta, espera su orden: esa protege su carrito", async () => {
    const sw = montarCon([ventana("vieja"), ventana("nueva", { actual: true })])
    const instalando = sw.disparar("install")

    await sw.correrReloj()
    await instalando
    expect(sw.contexto.self.skipWaitingLlamado).toBe(false)
  })

  it("una página antigua se recarga cuando pasa a segundo plano, nunca a la vista", async () => {
    const vieja = ventana("vieja")
    const sw = montarCon([vieja])
    const vigilando = sw.peticionDe("vieja", DATOS)

    await sw.correrReloj(20)
    expect(vieja.navegadaEn).toBeNull()

    vieja.visibilityState = "hidden"
    await sw.correrReloj()
    await vigilando
    expect(vieja.navegadaEn).not.toBeNull()
  })

  it("una página actual nunca se recarga desde aquí: contesta, o consulta /version.json", async () => {
    const contesta = ventana("contesta", { actual: true })
    const consulta = ventana("consulta")
    const sw = montarCon([contesta, consulta])

    await sw.peticionDe("consulta", `${ORIGEN}/version.json?t=1`)
    const pendientes = Promise.all([sw.peticionDe("contesta", DATOS), sw.peticionDe("consulta", DATOS)])

    contesta.visibilityState = "hidden"
    consulta.visibilityState = "hidden"
    await sw.correrReloj()
    await pendientes
    expect(contesta.navegadaEn).toBeNull()
    expect(consulta.navegadaEn).toBeNull()
  })

  it("no recarga mientras hay una escritura reciente (una venta o un cobro enviándose)", async () => {
    const vieja = ventana("vieja")
    const sw = montarCon([vieja])
    const vigilando = sw.peticionDe("vieja", DATOS)

    await sw.correrReloj(3)
    await sw.peticionDe("vieja", "https://qlzkriyibpbnesidtiiy.supabase.co/rest/v1/rpc/registrar_venta_con_medios", "POST")
    const escribio = sw.reloj.ahora
    vieja.visibilityState = "hidden"

    await sw.correrReloj()
    await vigilando
    expect(vieja.navegadaEn - escribio).toBeGreaterThan(15000)
  })

  it("una página oculta no se juzga: podría estar congelada por el sistema y no contestar", async () => {
    const oculta = ventana("oculta", { visible: false })
    const sw = montarCon([oculta])
    const pendiente = sw.peticionDe("oculta", DATOS)

    await sw.correrReloj()
    await pendiente
    expect(oculta.navegadaEn).toBeNull()
  })

  it("si estaba en segundo plano al activarse, se recarga en cuanto vuelve a abrirse", async () => {
    const vieja = ventana("vieja", { visible: false })
    const sw = montarCon([vieja])
    const activando = sw.disparar("activate")

    await sw.correrReloj()
    await activando

    vieja.visibilityState = "visible"
    const vuelta = sw.peticionDe("vieja", DATOS)

    await sw.correrReloj(20)
    await vuelta
    expect(vieja.navegadaEn).not.toBeNull()
  })
})
