import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { traerPorRecibir } from "../lib/api/traslados"
import { avisarCambioDeTraslados, CADA_CUANTO, useTrasladosPorRecibir } from "./useTrasladosPorRecibir"

vi.mock("../lib/api/traslados", () => ({ traerPorRecibir: vi.fn() }))
vi.mock("./useAuth", () => ({
  useAuth: () => ({
    user: { id: "u-ruta", role: "vendedor", locationId: "store" },
    hasPermission: (permiso) => permiso === "inventory-own",
  }),
}))

/*
  Lo que cuenta el menú y avisa el POS, al día y sin pisarse: una respuesta
  vieja no devuelve a «por recibir» un traslado ya recibido, y el reloj de
  60 s no encola consultas. Un aviso de cambio sí consulta siempre.
*/

function respuestaPendiente() {
  let entregar
  const promesa = new Promise((resolver) => {
    entregar = resolver
  })

  return { promesa, entregar }
}

const UNO = [{ id: "t-pend", status: "pendiente" }]

describe("useTrasladosPorRecibir · sin consultas que se pisen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    traerPorRecibir.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("una respuesta antigua que llega tarde no devuelve el traslado recibido al contador", async () => {
    const vieja = respuestaPendiente()

    traerPorRecibir.mockResolvedValueOnce(UNO).mockReturnValueOnce(vieja.promesa).mockResolvedValueOnce([])

    const { result } = renderHook(() => useTrasladosPorRecibir())

    await act(async () => {})
    expect(result.current.cantidad).toBe(1)

    // El reloj consulta; mientras tanto, otro aviso consulta y responde antes.
    await act(async () => vi.advanceTimersByTime(CADA_CUANTO))
    await act(async () => avisarCambioDeTraslados())
    expect(result.current.cantidad).toBe(0)

    await act(async () => {
      vieja.entregar(UNO)
      await vieja.promesa
    })

    expect(result.current.cantidad).toBe(0)
  })

  it("el reloj no lanza otra consulta mientras hay una en curso", async () => {
    const lenta = respuestaPendiente()

    traerPorRecibir.mockResolvedValueOnce(UNO).mockReturnValueOnce(lenta.promesa).mockResolvedValue(UNO)

    renderHook(() => useTrasladosPorRecibir())

    await act(async () => {})
    await act(async () => vi.advanceTimersByTime(CADA_CUANTO))
    await act(async () => vi.advanceTimersByTime(CADA_CUANTO))
    expect(traerPorRecibir).toHaveBeenCalledTimes(2)

    await act(async () => {
      lenta.entregar(UNO)
      await lenta.promesa
    })

    await act(async () => vi.advanceTimersByTime(CADA_CUANTO))
    expect(traerPorRecibir).toHaveBeenCalledTimes(3)
  })

  it("fuera de Traslados sigue consultando cada 60 s", async () => {
    traerPorRecibir.mockResolvedValue(UNO)

    renderHook(() => useTrasladosPorRecibir())

    await act(async () => {})
    await act(async () => vi.advanceTimersByTime(30000))
    expect(traerPorRecibir).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTime(30000))
    expect(traerPorRecibir).toHaveBeenCalledTimes(2)
    expect(CADA_CUANTO).toBe(60000)
  })
})
