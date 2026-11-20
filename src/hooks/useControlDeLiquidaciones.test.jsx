import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { traerControlDeLiquidaciones } from "../lib/api/liquidaciones"
import { CADA_CUANTO, useControlDeLiquidaciones } from "./useControlDeLiquidaciones"

vi.mock("../lib/api/liquidaciones", () => ({ traerControlDeLiquidaciones: vi.fn() }))

/*
  Qué consulta manda y cuándo se consulta. Lo que la pantalla hace con los
  datos lo prueba pages/Liquidaciones.test.jsx.
*/

const control = (estado) => ({ pares: [], pedidos: [], liquidaciones: [{ id: "liq-1", estado }] })

// Una respuesta que se entrega cuando la prueba quiera.
function respuestaPendiente() {
  let entregar
  const promesa = new Promise((resolver) => {
    entregar = resolver
  })

  return { promesa, entregar }
}

const estadoDe = (result) => result.current.liquidaciones[0]?.estado

// Deja terminar las consultas ya respondidas (el reloj de intervalos es falso).
const asentar = () => act(async () => {})

describe("useControlDeLiquidaciones", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    traerControlDeLiquidaciones.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("una respuesta antigua que llega tarde no pisa a la más reciente", async () => {
    const vieja = respuestaPendiente()
    const nueva = respuestaPendiente()

    traerControlDeLiquidaciones.mockReturnValueOnce(vieja.promesa).mockReturnValueOnce(nueva.promesa)

    const { result } = renderHook(() => useControlDeLiquidaciones())

    let recarga

    act(() => {
      recarga = result.current.recargar()
    })

    await act(async () => {
      nueva.entregar(control("confirmada"))
      await recarga
    })

    expect(estadoDe(result)).toBe("confirmada")

    await act(async () => {
      vieja.entregar(control("por_confirmar"))
      await vieja.promesa
    })

    expect(estadoDe(result)).toBe("confirmada")
  })

  it("no lanza otra consulta automática mientras hay una en curso", async () => {
    const primera = respuestaPendiente()

    traerControlDeLiquidaciones.mockReturnValueOnce(primera.promesa).mockResolvedValue(control("confirmada"))

    renderHook(() => useControlDeLiquidaciones())

    act(() => vi.advanceTimersByTime(CADA_CUANTO))
    expect(traerControlDeLiquidaciones).toHaveBeenCalledTimes(1)

    await act(async () => {
      primera.entregar(control("por_confirmar"))
      await primera.promesa
    })

    act(() => vi.advanceTimersByTime(CADA_CUANTO))
    expect(traerControlDeLiquidaciones).toHaveBeenCalledTimes(2)
  })

  it("mientras se registra o se resuelve una entrega, la recarga automática espera", async () => {
    traerControlDeLiquidaciones.mockResolvedValue(control("por_confirmar"))

    const { result, rerender } = renderHook((props) => useControlDeLiquidaciones(props), { initialProps: { pausado: true } })

    await asentar()
    expect(result.current.cargado).toBe(true)

    act(() => vi.advanceTimersByTime(CADA_CUANTO))
    expect(traerControlDeLiquidaciones).toHaveBeenCalledTimes(1)

    rerender({ pausado: false })
    act(() => vi.advanceTimersByTime(CADA_CUANTO))
    expect(traerControlDeLiquidaciones).toHaveBeenCalledTimes(2)
  })

  it("sin conexión no consulta por su cuenta", async () => {
    traerControlDeLiquidaciones.mockResolvedValue(control("por_confirmar"))

    const { result } = renderHook(() => useControlDeLiquidaciones({ conConexion: false }))

    await asentar()
    expect(result.current.cargado).toBe(true)

    act(() => vi.advanceTimersByTime(CADA_CUANTO * 3))
    expect(traerControlDeLiquidaciones).toHaveBeenCalledTimes(1)
  })

  it("si una recarga automática falla, conserva lo último que se supo", async () => {
    traerControlDeLiquidaciones.mockResolvedValueOnce(control("por_confirmar")).mockRejectedValueOnce(new Error("sin red"))

    const { result } = renderHook(() => useControlDeLiquidaciones())

    await asentar()
    expect(estadoDe(result)).toBe("por_confirmar")

    await act(async () => {
      vi.advanceTimersByTime(CADA_CUANTO)
    })

    expect(traerControlDeLiquidaciones).toHaveBeenCalledTimes(2)
    expect(estadoDe(result)).toBe("por_confirmar")
    expect(result.current.error).toBe("")
  })

  it("si la primera carga falla, muestra el motivo", async () => {
    traerControlDeLiquidaciones.mockRejectedValueOnce(new Error("No se pudo cargar las liquidaciones."))

    const { result } = renderHook(() => useControlDeLiquidaciones())

    await asentar()
    expect(result.current.error).toBe("No se pudo cargar las liquidaciones.")
    expect(result.current.cargado).toBe(true)
  })
})
