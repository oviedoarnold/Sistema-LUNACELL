import { describe, it, expect, vi } from "vitest"

import {
  anotarIntento,
  esperaParaRecargar,
  hayVersionNueva,
  instalarVersionNueva,
  olvidarSiYaSeInstalo,
  versionPublicada,
} from "./actualizador"
import { bloquearActualizacion, escucharBloqueos, hayOperacionEnCurso, motivosEnCurso } from "./bloqueos"

const almacen = () => {
  const datos = new Map()

  return {
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  }
}

describe("la versión publicada", () => {
  it("se lee de /version.json, sin caché", async () => {
    const pedir = vi.fn(async () => ({ ok: true, json: async () => ({ version: "d6e27e7" }) }))

    expect(await versionPublicada(pedir)).toBe("d6e27e7")
    expect(pedir.mock.calls[0][0]).toMatch(/^\/version\.json\?t=\d+$/)
    expect(pedir.mock.calls[0][1]).toEqual({ cache: "no-store" })
  })

  it.each([
    ["sin red", async () => { throw new TypeError("Failed to fetch") }],
    ["un error del servidor", async () => ({ ok: false })],
    ["una respuesta que no es JSON", async () => ({ ok: true, json: async () => { throw new Error("x") } })],
    ["una versión mal formada", async () => ({ ok: true, json: async () => ({ version: "<script>" }) })],
    ["una compilación local", async () => ({ ok: true, json: async () => ({ version: "local" }) })],
  ])("con %s no se sabe nada y no se actualiza", async (_, pedir) => {
    expect(await versionPublicada(pedir)).toBeNull()
  })

  it("solo hay versión nueva entre dos versiones de despliegue distintas", () => {
    expect(hayVersionNueva("90bcdbf", "d6e27e7")).toBe(true)
    expect(hayVersionNueva("d6e27e7", "d6e27e7")).toBe(false)
    expect(hayVersionNueva("local", "d6e27e7")).toBe(false)
    expect(hayVersionNueva("d6e27e7", null)).toBe(false)
  })
})

describe("sin recargas en bucle", () => {
  it("la primera vez se recarga enseguida; si sigue la vieja, espera cada vez más, hasta media hora", () => {
    const s = almacen()
    const t0 = 1_000_000

    expect(esperaParaRecargar(s, "d6e27e7", t0)).toBe(0)

    anotarIntento(s, "d6e27e7", t0)
    expect(esperaParaRecargar(s, "d6e27e7", t0)).toBe(2 * 60_000)

    anotarIntento(s, "d6e27e7", t0)
    expect(esperaParaRecargar(s, "d6e27e7", t0)).toBe(4 * 60_000)

    for (let i = 0; i < 10; i++) anotarIntento(s, "d6e27e7", t0)
    expect(esperaParaRecargar(s, "d6e27e7", t0)).toBe(30 * 60_000)
    expect(esperaParaRecargar(s, "d6e27e7", t0 + 30 * 60_000)).toBe(0)
  })

  it("otra versión nueva empieza de cero, y al llegar a la buscada se olvida", () => {
    const s = almacen()

    anotarIntento(s, "aaaaaaa", 0)
    expect(esperaParaRecargar(s, "bbbbbbb", 0)).toBe(0)

    olvidarSiYaSeInstalo(s, "aaaaaaa")
    expect(esperaParaRecargar(s, "aaaaaaa", 0)).toBe(0)
  })

  it("sin almacenamiento (privado, bloqueado) no falla", () => {
    const roto = { getItem: () => { throw new Error("x") }, setItem: () => { throw new Error("x") }, removeItem: () => {} }

    expect(() => anotarIntento(roto, "aaaaaaa")).not.toThrow()
    expect(esperaParaRecargar(roto, "aaaaaaa")).toBe(0)
  })
})

describe("instalar", () => {
  const servicio = (registro) => {
    const oyentes = {}

    return {
      oyentes,
      getRegistration: async () => registro,
      addEventListener: (nombre, fn) => (oyentes[nombre] = fn),
    }
  }

  it("con un service worker nuevo esperando: le pide activarse y recarga cuando ya controla la página", async () => {
    const recargar = vi.fn()
    const esperando = { postMessage: vi.fn() }
    const sw = servicio({ waiting: esperando })

    esperando.postMessage.mockImplementation(() => setTimeout(() => sw.oyentes.controllerchange(), 10))

    await instalarVersionNueva({ sw, recargar })

    expect(esperando.postMessage).toHaveBeenCalledWith({ tipo: "ACTIVAR" })
    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it("si el service worker todavía se instala, lo espera antes de activarlo", async () => {
    const recargar = vi.fn()
    const trabajador = { state: "installing", addEventListener: (_, fn) => setTimeout(() => { trabajador.state = "installed"; fn() }, 10) }
    const esperando = { postMessage: vi.fn() }
    const registro = { installing: trabajador }
    const sw = servicio(registro)

    setTimeout(() => (registro.waiting = esperando), 10)
    esperando.postMessage.mockImplementation(() => sw.oyentes.controllerchange())

    await instalarVersionNueva({ sw, recargar })

    expect(esperando.postMessage).toHaveBeenCalled()
    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it("sin service worker (Safari antiguo, navegación privada): recarga igual", async () => {
    const recargar = vi.fn()

    await instalarVersionNueva({ sw: undefined, recargar })

    expect(recargar).toHaveBeenCalledTimes(1)
  })
})

describe("operaciones en curso", () => {
  it("se anotan, se avisan y se retiran una sola vez", () => {
    const oyente = vi.fn()
    const soltar = escucharBloqueos(oyente)
    const retirarCarrito = bloquearActualizacion("carrito")
    const retirarAbono = bloquearActualizacion("abono")

    expect(hayOperacionEnCurso()).toBe(true)
    expect(motivosEnCurso()).toEqual(["carrito", "abono"])

    retirarCarrito()
    retirarCarrito()
    expect(hayOperacionEnCurso()).toBe(true)

    retirarAbono()
    expect(hayOperacionEnCurso()).toBe(false)
    expect(oyente.mock.calls.map(([v]) => v)).toEqual([true, true, true, false])

    soltar()
  })
})
