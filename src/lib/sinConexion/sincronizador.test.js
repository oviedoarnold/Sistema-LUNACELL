// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { CARGADOR, DUENO, copiaDePrueba, sesionDe, nuevoNavegador, ahoraDePrueba, OTRO_VENDEDOR } from "./pruebas/ayudas"
import { crearServidorFalso } from "./pruebas/servidorFalso"
import { construirVentaLocal } from "./venta"
import { guardarCopia } from "./copiaLocal"
import { idDelDispositivo } from "./dispositivo"
import { guardarVenta, ventasDe, marcar, ESTADOS } from "./cola"
import { crearSincronizador } from "./sincronizador"
import { clasificarError } from "./clasificar"

async function dispositivo({ servidor, navegador = nuevoNavegador(), usuario = DUENO.usuarioAuth, locks } = {}) {
  const almacen = await navegador.abrir()
  const copia = copiaDePrueba({ usuarioAuth: usuario })
  await guardarCopia(almacen, copia)
  const id = await idDelDispositivo(almacen)

  const vender = (cantidad = 1) =>
    guardarVenta(
      almacen,
      construirVentaLocal({
        copia,
        sesion: sesionDe(usuario),
        dispositivo: id,
        carrito: [{ productoId: CARGADOR.id, cantidad }],
        formaPago: "contado",
        ahora: ahoraDePrueba(),
      })
    )

  const sincronizador = crearSincronizador({
    almacen,
    enviar: (venta) => servidor.enviar(venta),
    sesionActual: async () => sesionDe(servidor.sesion),
    ahora: ahoraDePrueba,
    locks,
  })

  const estados = async () => (await ventasDe(almacen, { ...DUENO, usuarioAuth: usuario })).map((v) => v.estado)

  return { almacen, navegador, vender, sincronizador, estados, usuario }
}

describe("sincronizar", () => {
  it("envía las pendientes y las marca registradas con el número del servidor", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const d = await dispositivo({ servidor })
    await d.vender(2)

    const resumen = await d.sincronizador.sincronizar()
    const [venta] = await ventasDe(d.almacen, DUENO)

    expect(resumen).toMatchObject({ enviadas: 1, registradas: 1 })
    expect(venta).toMatchObject({ estado: ESTADOS.REGISTRADA, ventaId: "venta-1", numeroFactura: "VTA-000001" })
    expect(venta.confirmadaEn).toBeTruthy()
  })

  it("una venta en conciliación queda a salvo y no se reenvía", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 0 } })
    const d = await dispositivo({ servidor })
    await d.vender(1)

    await d.sincronizador.sincronizar()
    await d.sincronizador.sincronizar()

    expect(await d.estados()).toEqual([ESTADOS.EN_CONCILIACION])
    expect(servidor.recibidas.length).toBe(1)
  })

  it("sin red no pierde nada: queda pendiente y se envía cuando vuelve", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const d = await dispositivo({ servidor })
    await d.vender(1)
    await d.vender(1)
    servidor.fallarProxima({ tipo: "red" })

    const primera = await d.sincronizador.sincronizar()
    expect(primera.detenidoPor).toBe("red")
    expect(await d.estados()).toEqual([ESTADOS.PENDIENTE, ESTADOS.PENDIENTE])

    await d.sincronizador.sincronizar()
    expect(await d.estados()).toEqual([ESTADOS.REGISTRADA, ESTADOS.REGISTRADA])
  })

  it("si la respuesta se pierde, reenvía con la misma clave y no duplica", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const d = await dispositivo({ servidor })
    const venta = await d.vender(2)
    servidor.fallarProxima({ tipo: "respuesta_perdida" })

    await d.sincronizador.sincronizar()
    await d.sincronizador.sincronizar()

    expect(servidor.recibidas).toEqual([venta.clave, venta.clave])
    expect(servidor.registradas().length).toBe(1)
    expect(servidor.stock[CARGADOR.id]).toBe(8)
    expect(await d.estados()).toEqual([ESTADOS.REGISTRADA])
  })

  it("con la sesión vencida se detiene, conserva las ventas y sigue después de iniciar sesión", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const d = await dispositivo({ servidor })
    await d.vender(1)
    servidor.fallarProxima({ tipo: "sesion" })

    expect((await d.sincronizador.sincronizar()).detenidoPor).toBe("sesion")
    expect(await d.estados()).toEqual([ESTADOS.PENDIENTE])

    await d.sincronizador.sincronizar()
    expect(await d.estados()).toEqual([ESTADOS.REGISTRADA])
  })

  it("un rechazo de una venta (OF003) la marca con error sin bloquear las siguientes", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const d = await dispositivo({ servidor })
    await d.vender(1)
    await d.vender(1)
    servidor.fallarProxima({ tipo: "OF003" })

    await d.sincronizador.sincronizar()

    expect(await d.estados()).toEqual([ESTADOS.ERROR, ESTADOS.REGISTRADA])
  })

  it("un error temporal no bloquea las siguientes y la venta se reintenta después", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const d = await dispositivo({ servidor })
    await d.vender(1)
    await d.vender(1)
    servidor.fallarProxima({ tipo: "temporal" })

    await d.sincronizador.sincronizar()
    expect(await d.estados()).toEqual([ESTADOS.PENDIENTE, ESTADOS.REGISTRADA])

    await d.sincronizador.sincronizar()
    expect(await d.estados()).toEqual([ESTADOS.REGISTRADA, ESTADOS.REGISTRADA])
  })

  it("las ventas con error solo se reintentan con la sincronización manual", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const d = await dispositivo({ servidor })
    const venta = await d.vender(1)
    await marcar(d.almacen, venta.clave, { estado: ESTADOS.ERROR })

    await d.sincronizador.sincronizar()
    expect(await d.estados()).toEqual([ESTADOS.ERROR])

    await d.sincronizador.sincronizar({ manual: true })
    expect(await d.estados()).toEqual([ESTADOS.REGISTRADA])
  })

  it("no envía las ventas de otro usuario con la sesión actual", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 }, sesion: OTRO_VENDEDOR })
    const navegador = nuevoNavegador()
    const delVendedor = await dispositivo({ servidor, navegador })
    await delVendedor.vender(1)

    await delVendedor.sincronizador.sincronizar()

    expect(servidor.recibidas).toEqual([])
    expect(await delVendedor.estados()).toEqual([ESTADOS.PENDIENTE])
  })

  it("recupera lo que quedó enviándose al cerrar la pestaña y lo reenvía con la misma clave", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const d = await dispositivo({ servidor })
    const venta = await d.vender(1)
    await marcar(d.almacen, venta.clave, { estado: ESTADOS.SINCRONIZANDO })

    await d.sincronizador.sincronizar()

    expect(servidor.recibidas).toEqual([venta.clave])
    expect(await d.estados()).toEqual([ESTADOS.REGISTRADA])
  })
})

describe("dos pestañas y varios dispositivos", () => {
  it("dos pestañas del mismo dispositivo no envían a la vez (candado en IndexedDB)", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const navegador = nuevoNavegador()
    const pestanaA = await dispositivo({ servidor, navegador })
    const pestanaB = await dispositivo({ servidor, navegador })
    await pestanaA.vender(1)
    await pestanaA.vender(1)

    const [a, b] = await Promise.all([pestanaA.sincronizador.sincronizar(), pestanaB.sincronizador.sincronizar()])

    expect([a.omitido, b.omitido].filter(Boolean)).toEqual(["otra_pestana"])
    expect(servidor.recibidas.length).toBe(2)
  })

  it("con Web Locks, la segunda pestaña no espera: se omite", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    let ocupado = false
    const locks = {
      async request(_nombre, { ifAvailable }, trabajo) {
        if (ocupado && ifAvailable) return trabajo(null)
        ocupado = true
        try { return await trabajo({}) } finally { ocupado = false }
      },
    }
    const navegador = nuevoNavegador()
    const a = await dispositivo({ servidor, navegador, locks })
    const b = await dispositivo({ servidor, navegador, locks })
    await a.vender(1)

    const [ra, rb] = await Promise.all([a.sincronizador.sincronizar(), b.sincronizador.sincronizar()])

    expect([ra.omitido, rb.omitido].filter(Boolean)).toEqual(["otra_pestana"])
    expect(servidor.recibidas.length).toBe(1)
  })

  it("dos dispositivos venden la última unidad: uno registra y el otro queda en conciliación, sin perder ninguna", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 1 } })
    const telefonoA = await dispositivo({ servidor })
    const telefonoB = await dispositivo({ servidor })
    await telefonoA.vender(1)
    await telefonoB.vender(1)

    await telefonoA.sincronizador.sincronizar()
    await telefonoB.sincronizador.sincronizar()

    expect(await telefonoA.estados()).toEqual([ESTADOS.REGISTRADA])
    expect(await telefonoB.estados()).toEqual([ESTADOS.EN_CONCILIACION])
    expect(servidor.stock[CARGADOR.id]).toBe(0)
  })
})

describe("clasificar los errores", () => {
  it("distingue red, sesión, otro usuario, rechazo y temporal", () => {
    expect(clasificarError(new TypeError("Failed to fetch"))).toBe("red")
    expect(clasificarError({ message: "timeout" }, 0)).toBe("red")
    expect(clasificarError({ code: "502" }, 502)).toBe("red")
    expect(clasificarError({ code: "PGRST301", message: "JWT expired" }, 401)).toBe("sesion")
    expect(clasificarError({ code: "42501" }, 403)).toBe("sesion")
    expect(clasificarError({ code: "OF002" }, 400)).toBe("otro_usuario")
    expect(clasificarError({ code: "OF001" }, 400)).toBe("rechazo")
    expect(clasificarError({ code: "OF003" }, 400)).toBe("rechazo")
    expect(clasificarError({ code: "40001" }, 500)).toBe("temporal")
  })
})

/*
  Regresiones de la revisión del PR #44: un envío que nunca responde y un
  candado de respaldo que vence a mitad de una ronda.
*/
describe("envíos que no responden y candado vencido", () => {
  async function pestana({ navegador, enviar, ahora, limiteDeEnvio }) {
    const almacen = await navegador.abrir()
    const copia = copiaDePrueba()
    await guardarCopia(almacen, copia)
    const id = await idDelDispositivo(almacen)
    const sincronizador = crearSincronizador({
      almacen,
      enviar,
      sesionActual: async () => sesionDe(),
      ahora,
      locks: null,
      limiteDeEnvio,
    })
    const vender = () =>
      guardarVenta(
        almacen,
        construirVentaLocal({
          copia,
          sesion: sesionDe(),
          dispositivo: id,
          carrito: [{ productoId: CARGADOR.id, cantidad: 1 }],
          ahora: ahoraDePrueba(),
        })
      )

    return { almacen, sincronizador, vender, estados: async () => (await ventasDe(almacen, DUENO)).map((v) => v.estado) }
  }

  it("un envío colgado se corta por tiempo: la venta queda pendiente, se aborta la petición y el candado se libera", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    let colgar = true
    let senal = null
    const enviar = (venta, opciones) => {
      if (!colgar) return servidor.enviar(venta)
      senal = opciones?.signal
      return new Promise(() => {})
    }
    const t = await pestana({ navegador: nuevoNavegador(), enviar, ahora: ahoraDePrueba, limiteDeEnvio: 20 })
    await t.vender()

    const primera = await t.sincronizador.sincronizar()

    expect(primera.detenidoPor).toBe("red")
    expect(senal?.aborted).toBe(true)
    expect(await t.estados()).toEqual([ESTADOS.PENDIENTE])

    colgar = false
    const segunda = await t.sincronizador.sincronizar()

    expect(segunda.omitido).toBeUndefined()
    expect(await t.estados()).toEqual([ESTADOS.REGISTRADA])
    expect(servidor.registradas().length).toBe(1)
  })

  it("si otra pestaña toma el candado vencido, la ronda vieja no revienta ni retrocede ventas confirmadas", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const navegador = nuevoNavegador()
    let reloj = Date.parse("2026-10-10T12:00:00.000Z")
    const ahora = () => new Date(reloj)
    let soltar
    let retener = true
    const enviarLento = (venta) => {
      if (!retener) return servidor.enviar(venta)
      retener = false
      return new Promise((r) => (soltar = r)).then(() => servidor.enviar(venta))
    }
    const a = await pestana({ navegador, enviar: enviarLento, ahora, limiteDeEnvio: 60000 })
    const b = await pestana({ navegador, enviar: (v) => servidor.enviar(v), ahora, limiteDeEnvio: 60000 })
    await a.vender()
    await a.vender()

    const rondaA = a.sincronizador.sincronizar()
    while (!soltar) await new Promise((r) => setTimeout(r, 0))

    reloj += 61000
    const rondaB = await b.sincronizador.sincronizar()
    soltar()
    const resultadoA = await rondaA

    expect(rondaB.omitido).toBeUndefined()
    expect(resultadoA.omitido).toBeUndefined()
    expect(await a.estados()).toEqual([ESTADOS.REGISTRADA, ESTADOS.REGISTRADA])
    expect(servidor.registradas().length).toBe(2)
  })
})

/*
  Una venta en línea que se quedó sin respuesta pudo haberse registrado. Si
  el vendedor la guarda sin conexión, antes de enviarla se pregunta al
  servidor por la clave del intento en línea: nunca se registra dos veces.
*/
describe("ventas guardadas tras un intento en línea sin respuesta", () => {
  async function conIntentoEnLinea({ verificar, servidor }) {
    const almacen = await nuevoNavegador().abrir()
    const copia = copiaDePrueba()
    await guardarCopia(almacen, copia)
    const id = await idDelDispositivo(almacen)
    const venta = await guardarVenta(
      almacen,
      construirVentaLocal({
        copia,
        sesion: sesionDe(),
        dispositivo: id,
        carrito: [{ productoId: CARGADOR.id, cantidad: 1 }],
        ahora: ahoraDePrueba(),
        claveEnLinea: "mf2abc-1234567890abcdef",
      })
    )
    const sincronizador = crearSincronizador({
      almacen,
      enviar: (v) => servidor.enviar(v),
      verificarEnLinea: verificar,
      sesionActual: async () => sesionDe(),
      ahora: ahoraDePrueba,
      locks: null,
    })

    return { almacen, venta, sincronizador }
  }

  it("si el servidor ya la tenía, queda registrada con su factura y no se envía otra vez", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const verificar = vi.fn(async () => ({ data: { id: "venta-en-linea", numero_factura: "000-001-01-00000042" }, error: null, status: 200 }))
    const { almacen, venta, sincronizador } = await conIntentoEnLinea({ verificar, servidor })

    const resumen = await sincronizador.sincronizar()

    expect(verificar).toHaveBeenCalledWith("mf2abc-1234567890abcdef", expect.anything())
    expect(servidor.recibidas).toEqual([])
    expect(resumen.registradas).toBe(1)
    expect(await almacen.leer("ventas", venta.clave)).toMatchObject({
      estado: ESTADOS.REGISTRADA,
      ventaId: "venta-en-linea",
      numeroFactura: "000-001-01-00000042",
      registradaEnLinea: true,
    })
  })

  it("si no la tenía, se envía como venta sin conexión", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const verificar = vi.fn(async () => ({ data: null, error: null, status: 200 }))
    const { almacen, venta, sincronizador } = await conIntentoEnLinea({ verificar, servidor })

    await sincronizador.sincronizar()

    expect(servidor.recibidas).toEqual([venta.clave])
    expect((await almacen.leer("ventas", venta.clave)).estado).toBe(ESTADOS.REGISTRADA)
  })

  it("si no se puede comprobar, no se envía: queda pendiente", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const verificar = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    })
    const { almacen, venta, sincronizador } = await conIntentoEnLinea({ verificar, servidor })

    const resumen = await sincronizador.sincronizar()

    expect(resumen.detenidoPor).toBe("red")
    expect(servidor.recibidas).toEqual([])
    expect((await almacen.leer("ventas", venta.clave)).estado).toBe(ESTADOS.PENDIENTE)
  })

  it("sin forma de comprobarla, no se envía nunca a ciegas", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 10 } })
    const { almacen, venta, sincronizador } = await conIntentoEnLinea({ verificar: undefined, servidor })

    await sincronizador.sincronizar()

    expect(servidor.recibidas).toEqual([])
    expect((await almacen.leer("ventas", venta.clave)).estado).toBe(ESTADOS.PENDIENTE)
  })
})

/*
  En qué quedaron las ventas en conciliación: después de cada ronda con
  servidor se pregunta por las que todavía no tienen decisión, para que el
  vendedor lo vea y el disponible sin conexión deje de restarlas cuando
  corresponde.
*/
describe("resoluciones de las ventas en conciliación", () => {
  async function conVentaEnConciliacion({ consultar }) {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 0 } })
    const almacen = await nuevoNavegador().abrir()
    const copia = copiaDePrueba()
    await guardarCopia(almacen, copia)
    const id = await idDelDispositivo(almacen)
    const venta = await guardarVenta(
      almacen,
      construirVentaLocal({
        copia,
        sesion: sesionDe(),
        dispositivo: id,
        carrito: [{ productoId: CARGADOR.id, cantidad: 1 }],
        ahora: ahoraDePrueba(),
      })
    )
    const sincronizador = crearSincronizador({
      almacen,
      enviar: (v) => servidor.enviar(v),
      consultarConciliaciones: consultar,
      sesionActual: async () => sesionDe(),
      ahora: ahoraDePrueba,
      locks: null,
    })

    return { almacen, venta, sincronizador, servidor }
  }

  it("guarda la decisión del administrador sin cambiar el estado final de la venta", async () => {
    const consultar = vi.fn(async (claves) => ({
      data: claves.map((clave) => ({ clave_idempotencia: clave, estado: "aplicada", resuelta_en: "2026-10-10T13:00:00.000Z", venta_id: "v-9" })),
      error: null,
    }))
    const { almacen, venta, sincronizador } = await conVentaEnConciliacion({ consultar })

    await sincronizador.sincronizar()

    expect(consultar).toHaveBeenCalledWith([venta.clave])
    expect(await almacen.leer("ventas", venta.clave)).toMatchObject({
      estado: ESTADOS.EN_CONCILIACION,
      conciliacion: { estado: "aplicada", resueltaEn: "2026-10-10T13:00:00.000Z", ventaId: "v-9" },
    })
  })

  it("no vuelve a preguntar por las que ya tienen decisión", async () => {
    const consultar = vi.fn(async (claves) => ({
      data: claves.map((clave) => ({ clave_idempotencia: clave, estado: "anulada", resuelta_en: "2026-10-10T13:00:00.000Z", venta_id: null })),
      error: null,
    }))
    const { sincronizador } = await conVentaEnConciliacion({ consultar })

    await sincronizador.sincronizar()
    await sincronizador.sincronizar()

    expect(consultar).toHaveBeenCalledTimes(1)
  })

  it("si todavía está pendiente, vuelve a preguntar en la próxima ronda", async () => {
    const consultar = vi.fn(async (claves) => ({
      data: claves.map((clave) => ({ clave_idempotencia: clave, estado: "pendiente", resuelta_en: null, venta_id: null })),
      error: null,
    }))
    const { sincronizador } = await conVentaEnConciliacion({ consultar })

    await sincronizador.sincronizar()
    await sincronizador.sincronizar()

    expect(consultar).toHaveBeenCalledTimes(2)
  })

  it("si la consulta falla no pasa nada: la venta sigue igual y se reintenta después", async () => {
    const consultar = vi.fn(async () => ({ data: null, error: { message: "TypeError: Failed to fetch" }, status: 0 }))
    const { almacen, venta, sincronizador } = await conVentaEnConciliacion({ consultar })

    const resumen = await sincronizador.sincronizar()

    expect(resumen.enConciliacion).toBe(1)
    expect((await almacen.leer("ventas", venta.clave)).conciliacion).toBeUndefined()
  })

  it("si la ronda se detuvo por falta de red, no pregunta", async () => {
    const consultar = vi.fn()
    const { servidor, sincronizador } = await conVentaEnConciliacion({ consultar })
    servidor.fallarProxima({ tipo: "red" })

    await sincronizador.sincronizar()

    expect(consultar).not.toHaveBeenCalled()
  })
})

describe("consulta de resoluciones que no responde", () => {
  it("se corta por tiempo: la ronda termina, la venta sigue igual y el candado se libera", async () => {
    const servidor = crearServidorFalso({ existencias: { [CARGADOR.id]: 0 } })
    const almacen = await nuevoNavegador().abrir()
    const copia = copiaDePrueba()
    await guardarCopia(almacen, copia)
    const id = await idDelDispositivo(almacen)
    const venta = await guardarVenta(
      almacen,
      construirVentaLocal({ copia, sesion: sesionDe(), dispositivo: id, carrito: [{ productoId: CARGADOR.id, cantidad: 1 }], ahora: ahoraDePrueba() })
    )
    let senal = null
    const consultar = vi.fn((_claves, opciones) => {
      senal = opciones?.signal
      return new Promise(() => {})
    })
    const sincronizador = crearSincronizador({
      almacen,
      enviar: (v) => servidor.enviar(v),
      consultarConciliaciones: consultar,
      sesionActual: async () => sesionDe(),
      ahora: ahoraDePrueba,
      locks: null,
      limiteDeEnvio: 20,
    })

    const primera = await sincronizador.sincronizar()
    const segunda = await sincronizador.sincronizar()

    expect(primera.enConciliacion).toBe(1)
    expect(segunda.omitido).toBeUndefined()
    expect(senal?.aborted).toBe(true)
    expect((await almacen.leer("ventas", venta.clave)).conciliacion).toBeUndefined()
  })

  it("pregunta como máximo por 100 ventas por ronda", async () => {
    const almacen = await nuevoNavegador().abrir()
    await almacen.transaccion(["ventas"], "readwrite", async (t) => {
      for (let i = 0; i < 130; i++) {
        await t.poner("ventas", { ...sesionDe(), clave: `off-dispositivo-${String(i).padStart(8, "0")}`, estado: "en_conciliacion", creadaEn: `2026-10-10T10:${String(i % 60).padStart(2, "0")}:00.000Z`, renglones: [] })
      }
    })
    const consultar = vi.fn(async () => ({ data: [], error: null }))
    const sincronizador = crearSincronizador({
      almacen,
      enviar: vi.fn(),
      consultarConciliaciones: consultar,
      sesionActual: async () => sesionDe(),
      ahora: ahoraDePrueba,
      locks: null,
    })

    await sincronizador.sincronizar()

    expect(consultar).toHaveBeenCalledTimes(1)
    expect(consultar.mock.calls[0][0]).toHaveLength(100)
  })
})
