import { describe, it, expect, vi } from "vitest"

import { responderAlServiceWorker } from "./registrarServiceWorker"

/*
  El service worker pregunta a cada ventana si es una versión actual: las que
  no contestan son instalaciones anteriores al aviso de actualización, y esas
  las recarga él al pasar a segundo plano. Esta tiene que contestar siempre.
*/
describe("la página contesta al service worker", () => {
  const montar = () => {
    let oyente
    responderAlServiceWorker({ addEventListener: (nombre, fn) => (oyente = fn) })
    return (evento) => oyente(evento)
  }

  it("a IDENTIFICATE responde SOY_ACTUAL con su versión", () => {
    const enviar = montar()
    const source = { postMessage: vi.fn() }

    enviar({ data: { tipo: "IDENTIFICATE" }, source })

    expect(source.postMessage).toHaveBeenCalledWith({ tipo: "SOY_ACTUAL", version: expect.any(String) })
  })

  it("ignora cualquier otro mensaje", () => {
    const enviar = montar()
    const source = { postMessage: vi.fn() }

    enviar({ data: { tipo: "OTRA_COSA" }, source })
    enviar({ data: null, source })

    expect(source.postMessage).not.toHaveBeenCalled()
  })
})
