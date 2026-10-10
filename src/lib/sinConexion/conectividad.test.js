// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { hayServidor, crearProgramador, esperaTrasFallos, ESPERAS } from "./conectividad"

describe("hayServidor", () => {
  const url = "https://ejemplo.supabase.co"

  it("pregunta al servidor de verdad, con la clave publicable", async () => {
    const fetch = vi.fn(async () => ({ ok: true }))

    expect(await hayServidor({ fetch, url, clave: "pub" })).toBe(true)
    expect(fetch).toHaveBeenCalledWith(`${url}/auth/v1/health`, expect.objectContaining({ headers: { apikey: "pub" } }))
  })

  it("una respuesta de error o una excepción es «sin servidor»", async () => {
    expect(await hayServidor({ fetch: async () => ({ ok: false }), url, clave: "pub" })).toBe(false)
    expect(await hayServidor({ fetch: async () => { throw new TypeError("Failed to fetch") }, url, clave: "pub" })).toBe(false)
  })

  it("un servidor que no contesta a tiempo es «sin servidor»", async () => {
    const fetch = (_u, { signal }) => new Promise((_r, rechazar) => signal.addEventListener("abort", () => rechazar(new Error("abortado"))))

    expect(await hayServidor({ fetch, url, clave: "pub", tiempo: 20 })).toBe(false)
  })
})

describe("espera progresiva", () => {
  it("5 s, 15 s, 30 s, 60 s y después 2 min como tope", () => {
    expect([0, 1, 2, 3, 4, 9].map(esperaTrasFallos)).toEqual([5000, 15000, 30000, 60000, 120000, 120000])
    expect(ESPERAS.at(-1)).toBe(120000)
  })
})

/*
  El programador decide CUÁNDO sincronizar. Se prueba con eventos y
  temporizadores propios: nada de esperar segundos reales.
*/
function entorno({ enLinea = true, visible = true } = {}) {
  const ventana = new EventTarget()
  ventana.navigator = { onLine: enLinea }
  const documento = new EventTarget()
  documento.visibilityState = visible ? "visible" : "hidden"
  const pendientes = []
  const temporizador = {
    setTimeout: (fn, ms) => { pendientes.push({ fn, ms }); return pendientes.length },
    clearTimeout: () => {},
  }
  const disparar = async () => { const t = pendientes.shift(); await t?.fn() }

  return { ventana, documento, temporizador, pendientes, disparar }
}

const listo = () => new Promise((r) => setTimeout(r, 0))

describe("programador", () => {
  it("sincroniza al iniciar si hay servidor", async () => {
    const e = entorno()
    const sincronizar = vi.fn(async () => ({ pendientes: 0 }))
    const p = crearProgramador({ sincronizar, hayServidor: async () => true, ...e })

    await p.iniciar()

    expect(sincronizar).toHaveBeenCalledTimes(1)
  })

  it("no confía solo en navigator.onLine: si el servidor no responde, no sincroniza y reintenta más tarde", async () => {
    const e = entorno({ enLinea: true })
    const sincronizar = vi.fn(async () => ({ pendientes: 0 }))
    const p = crearProgramador({ sincronizar, hayServidor: async () => false, ...e })

    await p.iniciar()

    expect(sincronizar).not.toHaveBeenCalled()
    expect(e.pendientes.map((t) => t.ms)).toEqual([5000])
  })

  it("al volver la conexión (evento online) sincroniza sin que nadie lo pida", async () => {
    const e = entorno({ enLinea: false })
    const sincronizar = vi.fn(async () => ({ pendientes: 0 }))
    const p = crearProgramador({ sincronizar, hayServidor: async () => true, ...e })
    await p.iniciar()
    expect(sincronizar).not.toHaveBeenCalled()

    e.ventana.navigator.onLine = true
    e.ventana.dispatchEvent(new Event("online"))
    await listo()

    expect(sincronizar).toHaveBeenCalledTimes(1)
  })

  it("al volver a primer plano sincroniza", async () => {
    const e = entorno()
    const sincronizar = vi.fn(async () => ({ pendientes: 0 }))
    const p = crearProgramador({ sincronizar, hayServidor: async () => true, ...e })
    await p.iniciar()

    e.documento.visibilityState = "visible"
    e.documento.dispatchEvent(new Event("visibilitychange"))
    await listo()

    expect(sincronizar).toHaveBeenCalledTimes(2)
  })

  it("si la ronda se detuvo por red, reintenta con espera progresiva", async () => {
    const e = entorno()
    const sincronizar = vi.fn(async () => ({ detenidoPor: "red", pendientes: 2 }))
    const p = crearProgramador({ sincronizar, hayServidor: async () => true, ...e })

    await p.iniciar()
    await e.disparar()
    await e.disparar()

    expect(sincronizar).toHaveBeenCalledTimes(3)
    expect(e.pendientes.map((t) => t.ms)).toEqual([30000])
  })

  it("mientras quedan pendientes y la app está visible, vuelve a intentar periódicamente", async () => {
    const e = entorno()
    const sincronizar = vi.fn(async () => ({ pendientes: 1 }))
    const p = crearProgramador({ sincronizar, hayServidor: async () => true, periodo: 45000, ...e })

    await p.iniciar()

    expect(e.pendientes.map((t) => t.ms)).toEqual([45000])
  })

  it("en segundo plano no programa nada; al volver retoma", async () => {
    const e = entorno({ visible: false })
    const sincronizar = vi.fn(async () => ({ pendientes: 1 }))
    const p = crearProgramador({ sincronizar, hayServidor: async () => true, ...e })

    await p.iniciar()

    expect(e.pendientes).toEqual([])
  })

  it("ahora() sincroniza enseguida; pedido durante una ronda, hace una más al terminar y nunca dos a la vez", async () => {
    const e = entorno()
    let enCurso = 0
    let maximo = 0
    const sueltas = []
    const sincronizar = vi.fn(async () => {
      enCurso += 1
      maximo = Math.max(maximo, enCurso)
      await new Promise((r) => sueltas.push(r))
      enCurso -= 1
      return { pendientes: 0 }
    })
    const p = crearProgramador({ sincronizar, hayServidor: async () => true, ...e })

    const primera = p.ahora()
    await listo()
    const segunda = p.ahora()
    const tercera = p.ahora()
    sueltas.shift()()
    await listo()
    await listo()
    sueltas.shift()?.()
    await Promise.all([primera, segunda, tercera])

    expect(sincronizar).toHaveBeenCalledTimes(2)
    expect(maximo).toBe(1)
  })

  it("detener() quita los escuchas", async () => {
    const e = entorno()
    const sincronizar = vi.fn(async () => ({ pendientes: 0 }))
    const p = crearProgramador({ sincronizar, hayServidor: async () => true, ...e })
    await p.iniciar()
    p.detener()

    e.ventana.dispatchEvent(new Event("online"))
    await listo()

    expect(sincronizar).toHaveBeenCalledTimes(1)
  })
})
