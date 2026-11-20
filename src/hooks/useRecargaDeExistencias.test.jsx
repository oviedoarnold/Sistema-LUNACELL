import { afterEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { EVENTO_VENTAS_SINCRONIZADAS } from "../lib/sinConexion/eventos"
import { useRecargaDeExistencias } from "./useRecargaDeExistencias"

const sincronizar = () =>
  act(() => {
    window.dispatchEvent(new CustomEvent(EVENTO_VENTAS_SINCRONIZADAS, { detail: { registradas: 1 } }))
  })

describe("useRecargaDeExistencias", () => {
  afterEach(() => vi.restoreAllMocks())

  it("recarga al sincronizar ventas", () => {
    const recargar = vi.fn()
    renderHook(() => useRecargaDeExistencias(recargar))

    sincronizar()

    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it("inactivo no recarga", () => {
    const recargar = vi.fn()
    renderHook(() => useRecargaDeExistencias(recargar, { activo: false }))

    sincronizar()

    expect(recargar).not.toHaveBeenCalled()
  })

  it("al desmontarse deja de escuchar", () => {
    const recargar = vi.fn()
    const { unmount } = renderHook(() => useRecargaDeExistencias(recargar))

    unmount()
    sincronizar()

    expect(recargar).not.toHaveBeenCalled()
  })
})
