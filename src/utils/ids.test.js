import { describe, it, expect, vi, afterEach } from "vitest"

import { crearId, sufijoAleatorio } from "./ids"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("sufijoAleatorio", () => {
  it("devuelve una cadena no vacía", () => {
    expect(sufijoAleatorio().length).toBeGreaterThan(0)
  })

  it("no repite el mismo valor en llamadas seguidas", () => {
    const valores = new Set(
      Array.from({ length: 200 }, () => sufijoAleatorio())
    )

    expect(valores.size).toBe(200)
  })

  it("respeta el tamaño pedido en bytes", () => {
    expect(sufijoAleatorio(4)).toHaveLength(8)
    expect(sufijoAleatorio(8)).toHaveLength(16)
  })

  it("solo devuelve dígitos hexadecimales", () => {
    expect(sufijoAleatorio(6)).toMatch(/^[0-9a-f]+$/)
  })

  it("usa getRandomValues cuando randomUUID no existe", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr) => {
        arr.forEach((_, i) => {
          arr[i] = i
        })

        return arr
      },
    })

    expect(sufijoAleatorio(3)).toBe("000102")
  })

  it("cae en un valor con contador si no hay crypto", () => {
    vi.stubGlobal("crypto", undefined)

    const primero = sufijoAleatorio()
    const segundo = sufijoAleatorio()

    expect(primero).toBeTruthy()
    expect(primero).not.toBe(segundo)
  })
})

describe("crearId", () => {
  it("antepone el prefijo indicado", () => {
    expect(crearId("USR")).toMatch(/^USR-/)
    expect(crearId("Q")).toMatch(/^Q-/)
  })

  it("genera identificadores distintos", () => {
    const ids = new Set(Array.from({ length: 200 }, () => crearId("C")))
    expect(ids.size).toBe(200)
  })

  it("arma tres partes separadas por guion", () => {
    expect(crearId("USR").split("-")).toHaveLength(3)
  })
})
