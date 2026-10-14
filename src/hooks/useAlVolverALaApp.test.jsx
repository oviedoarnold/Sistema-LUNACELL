import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

import { useAlVolverALaApp, ESPERA_ENTRE_RECARGAS } from "./useAlVolverALaApp"

/*
  Volver a LUNACELL después de usar otra app (o de cambiar de pestaña)
  recarga lo que pudo cambiar en otros dispositivos. No en cada vuelta: como
  mucho una vez cada ESPERA_ENTRE_RECARGAS, para no castigar al servidor.
*/
let visibilidad = "visible"

function cambiarVisibilidad(estado) {
  visibilidad = estado
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
}

beforeEach(() => {
  visibilidad = "visible"
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidad })
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-14T10:00:00Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

const avanzar = (ms) => vi.setSystemTime(new Date(Date.now() + ms))

describe("useAlVolverALaApp", () => {
  it("al volver a la app después de la espera mínima, recarga", () => {
    const recargar = vi.fn()
    renderHook(() => useAlVolverALaApp(recargar))

    cambiarVisibilidad("hidden")
    avanzar(ESPERA_ENTRE_RECARGAS + 1000)
    cambiarVisibilidad("visible")

    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it("si vuelve enseguida, no recarga (se acaba de cargar)", () => {
    const recargar = vi.fn()
    renderHook(() => useAlVolverALaApp(recargar))

    cambiarVisibilidad("hidden")
    avanzar(5000)
    cambiarVisibilidad("visible")

    expect(recargar).not.toHaveBeenCalled()
  })

  it("al irse a otra app no recarga", () => {
    const recargar = vi.fn()
    renderHook(() => useAlVolverALaApp(recargar))
    avanzar(ESPERA_ENTRE_RECARGAS + 1000)

    cambiarVisibilidad("hidden")

    expect(recargar).not.toHaveBeenCalled()
  })

  it("dos vueltas seguidas recargan una sola vez", () => {
    const recargar = vi.fn()
    renderHook(() => useAlVolverALaApp(recargar))
    avanzar(ESPERA_ENTRE_RECARGAS + 1000)

    cambiarVisibilidad("hidden")
    cambiarVisibilidad("visible")
    avanzar(2000)
    cambiarVisibilidad("hidden")
    cambiarVisibilidad("visible")

    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it("desactivado (sin sesión o sin ubicación), no hace nada", () => {
    const recargar = vi.fn()
    renderHook(() => useAlVolverALaApp(recargar, { activo: false }))
    avanzar(ESPERA_ENTRE_RECARGAS + 1000)

    cambiarVisibilidad("hidden")
    cambiarVisibilidad("visible")

    expect(recargar).not.toHaveBeenCalled()
  })

  it("al desmontarse deja de escuchar", () => {
    const recargar = vi.fn()
    const vista = renderHook(() => useAlVolverALaApp(recargar))
    vista.unmount()
    avanzar(ESPERA_ENTRE_RECARGAS + 1000)

    cambiarVisibilidad("hidden")
    cambiarVisibilidad("visible")

    expect(recargar).not.toHaveBeenCalled()
  })
})
