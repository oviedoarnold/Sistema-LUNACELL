import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

/*
  La existencia que usa el punto de venta: la de la ubicación operativa de
  quien está en sesión, y solo esa. Nunca el total del catálogo, y nunca la
  de una sesión anterior.
*/

let usuarioEnSesion = null
vi.mock("./useAuth", () => ({ useAuth: () => ({ user: usuarioEnSesion }) }))

const traerExistenciasPorUbicacion = vi.fn()
vi.mock("../lib/api/existencias", () => ({
  traerExistenciasPorUbicacion: (...argumentos) => traerExistenciasPorUbicacion(...argumentos),
}))

const { useExistenciaDeMiUbicacion } = await import("./useExistenciaDeMiUbicacion")

const fila = (locationId, productId, quantity) => ({ locationId, productId, quantity })

// Lo que devuelve la vista para un administrador: todas las ubicaciones.
const TODAS = [fila("bodega", "p1", 10), fila("bodega", "p2", 10), fila("camion-01", "p1", 4), fila("camion-01", "p2", 0)]

const CARGADOR = { id: "p1", stock: 10 }
const CUBO = { id: "p2", stock: 10 }

function promesaControlada() {
  let resolver
  const promesa = new Promise((r) => {
    resolver = r
  })
  return { promesa, resolver }
}

beforeEach(() => {
  traerExistenciasPorUbicacion.mockReset()
  usuarioEnSesion = null
})

describe("useExistenciaDeMiUbicacion", () => {
  it("da la existencia de la ubicación del usuario, no la de otra ni la del catálogo", async () => {
    usuarioEnSesion = { id: "u-camion", locationId: "camion-01" }
    traerExistenciasPorUbicacion.mockResolvedValue(TODAS)

    const { result } = renderHook(() => useExistenciaDeMiUbicacion())

    await waitFor(() => expect(result.current.lista).toBe(true))

    expect(result.current.existenciaDe(CARGADOR)).toBe(4)
    expect(result.current.existenciaDe(CUBO)).toBe(0)
  })

  it("un producto sin fila en la ubicación tiene 0", async () => {
    usuarioEnSesion = { id: "u-camion", locationId: "camion-01" }
    traerExistenciasPorUbicacion.mockResolvedValue([fila("bodega", "p1", 10)])

    const { result } = renderHook(() => useExistenciaDeMiUbicacion())

    await waitFor(() => expect(result.current.lista).toBe(true))

    expect(result.current.existenciaDe(CARGADOR)).toBe(0)
  })

  it("mientras carga no hay existencia y lo dice", () => {
    usuarioEnSesion = { id: "u-bodega", locationId: "bodega" }
    traerExistenciasPorUbicacion.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useExistenciaDeMiUbicacion())

    expect(result.current.lista).toBe(false)
    expect(result.current.existenciaDe(CARGADOR)).toBe(0)
    expect(result.current.motivo).toMatch(/cargando/i)
  })

  it("si la carga falla, no cae al total del catálogo y lo dice", async () => {
    usuarioEnSesion = { id: "u-bodega", locationId: "bodega" }
    traerExistenciasPorUbicacion.mockRejectedValue(new Error("No se pudo cargar la existencia por ubicación."))

    const { result } = renderHook(() => useExistenciaDeMiUbicacion())

    await waitFor(() => expect(result.current.motivo).toMatch(/no se pudo cargar/i))

    expect(result.current.lista).toBe(false)
    expect(result.current.error).toBe(true)
    expect(result.current.existenciaDe(CARGADOR)).toBe(0)
  })

  it("sin ubicación operativa no consulta nada y lo dice", () => {
    usuarioEnSesion = { id: "u-sin", locationId: "" }

    const { result } = renderHook(() => useExistenciaDeMiUbicacion())

    expect(result.current.lista).toBe(false)
    expect(result.current.motivo).toMatch(/no tienes una ubicación operativa/i)
    expect(traerExistenciasPorUbicacion).not.toHaveBeenCalled()
  })

  it("recargar trae la cantidad nueva", async () => {
    usuarioEnSesion = { id: "u-bodega", locationId: "bodega" }
    traerExistenciasPorUbicacion.mockResolvedValueOnce(TODAS)

    const { result } = renderHook(() => useExistenciaDeMiUbicacion())
    await waitFor(() => expect(result.current.lista).toBe(true))

    traerExistenciasPorUbicacion.mockResolvedValueOnce([fila("bodega", "p1", 8)])
    await act(() => result.current.recargar())

    expect(result.current.existenciaDe(CARGADOR)).toBe(8)
  })

  it("al cambiar de usuario no queda la existencia de la sesión anterior, ni llega tarde", async () => {
    const primera = promesaControlada()
    const segunda = promesaControlada()
    traerExistenciasPorUbicacion.mockReturnValueOnce(primera.promesa).mockReturnValueOnce(segunda.promesa)

    usuarioEnSesion = { id: "u-bodega", locationId: "bodega" }
    const { result, rerender } = renderHook(() => useExistenciaDeMiUbicacion())

    // Entra otro usuario antes de que llegue la respuesta del primero.
    usuarioEnSesion = { id: "u-camion", locationId: "camion-01" }
    rerender()

    await act(async () => primera.resolver(TODAS))

    expect(result.current.lista).toBe(false)
    expect(result.current.existenciaDe(CARGADOR)).toBe(0)

    await act(async () => segunda.resolver(TODAS))

    expect(result.current.lista).toBe(true)
    expect(result.current.existenciaDe(CARGADOR)).toBe(4)
  })

  it("al cambiar la ubicación del mismo usuario vuelve a cargar y no mezcla cantidades", async () => {
    traerExistenciasPorUbicacion.mockResolvedValue(TODAS)
    usuarioEnSesion = { id: "u-1", locationId: "bodega" }

    const { result, rerender } = renderHook(() => useExistenciaDeMiUbicacion())
    await waitFor(() => expect(result.current.existenciaDe(CARGADOR)).toBe(10))

    usuarioEnSesion = { id: "u-1", locationId: "camion-01" }
    rerender()

    expect(result.current.lista).toBe(false)
    await waitFor(() => expect(result.current.existenciaDe(CARGADOR)).toBe(4))
    expect(traerExistenciasPorUbicacion).toHaveBeenCalledTimes(2)
  })
})
