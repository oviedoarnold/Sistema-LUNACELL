// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { pedirAlmacenamientoPersistente } from "./persistencia"

describe("almacenamiento persistente", () => {
  it("si ya está concedido no lo vuelve a pedir", async () => {
    const storage = { persisted: vi.fn(async () => true), persist: vi.fn() }

    expect(await pedirAlmacenamientoPersistente(storage)).toBe("concedido")
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it("lo pide y dice si el navegador lo concedió o no", async () => {
    expect(await pedirAlmacenamientoPersistente({ persisted: async () => false, persist: async () => true })).toBe("concedido")
    expect(await pedirAlmacenamientoPersistente({ persisted: async () => false, persist: async () => false })).toBe("denegado")
  })

  it("sin la API o si falla, lo dice sin romper nada", async () => {
    expect(await pedirAlmacenamientoPersistente(undefined)).toBe("no_disponible")
    expect(await pedirAlmacenamientoPersistente({ persist: async () => { throw new Error("x") } })).toBe("no_disponible")
  })
})
