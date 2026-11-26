import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { traerTraslados } from "../lib/api/traslados"
import { ESPERA_ENTRE_RECARGAS } from "./useAlVolverALaApp"
import { CADA_CUANTO, useTraslados } from "./useTraslados"

vi.mock("../lib/api/traslados", async (original) => ({ ...(await original()), traerTraslados: vi.fn() }))

/*
  El refresco del historial entre dispositivos: quien recibe confirma en su
  teléfono y el remitente, con Traslados abierta, lo ve sin recargar. Qué
  consulta se manda y cuándo; lo que la pantalla muestra lo prueba
  pages/Transfers.sincronizacion.test.jsx.
*/

const traslado = (n, estado = "pendiente") => ({ id: `t-${n}`, numero: `TR-${n}`, status: estado })
const pagina = (desde, hasta, { estado = "pendiente", hayMas = false } = {}) => ({
  traslados: Array.from({ length: hasta - desde }, (_, i) => traslado(desde + i, estado)),
  hayMas,
})

// Una respuesta que se entrega cuando la prueba quiera.
function respuestaPendiente() {
  let entregar
  let fallar
  const promesa = new Promise((resolver, rechazar) => {
    entregar = resolver
    fallar = rechazar
  })

  return { promesa, entregar, fallar }
}

// Deja terminar las consultas ya respondidas (el reloj de intervalos es falso).
const asentar = () => act(async () => {})
const tic = () => act(async () => vi.advanceTimersByTime(CADA_CUANTO))
const estados = (result) => result.current.traslados.map((t) => t.status)
const ids = (result) => result.current.traslados.map((t) => t.id)

let visible

describe("useTraslados · refresco entre dispositivos", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    visible = "visible"
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible)
    traerTraslados.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("cada 30 s trae el estado nuevo sin vaciar la tabla ni mostrar «Cargando»", async () => {
    traerTraslados.mockResolvedValueOnce(pagina(1, 3)).mockResolvedValueOnce(pagina(1, 3, { estado: "recibido" }))

    const { result } = renderHook(() => useTraslados())

    await asentar()
    expect(estados(result)).toEqual(["pendiente", "pendiente"])

    await tic()

    expect(estados(result)).toEqual(["recibido", "recibido"])
    expect(result.current.cargando).toBe(false)
    expect(traerTraslados).toHaveBeenCalledTimes(2)
  })

  it("conserva los filtros y las páginas cargadas, y «cargar más» sigue donde iba", async () => {
    const filtros = { ubicacionId: "bodega", desde: "2026-11-01", hasta: "2026-11-30" }

    traerTraslados
      .mockResolvedValueOnce(pagina(0, 25, { hayMas: true }))
      .mockResolvedValueOnce(pagina(25, 50, { hayMas: true }))
      .mockResolvedValueOnce(pagina(0, 50, { estado: "recibido", hayMas: true }))
      .mockResolvedValueOnce(pagina(50, 60))

    const { result } = renderHook(() => useTraslados(filtros))

    await asentar()
    await act(() => result.current.cargarMas())
    expect(result.current.traslados).toHaveLength(50)

    await tic()

    expect(traerTraslados).toHaveBeenLastCalledWith(filtros, { cantidad: 50 })
    expect(result.current.traslados).toHaveLength(50)
    expect(new Set(estados(result))).toEqual(new Set(["recibido"]))
    expect(result.current.hayMas).toBe(true)

    await act(() => result.current.cargarMas())

    expect(traerTraslados).toHaveBeenLastCalledWith(filtros, { inicio: 50 })
    expect(result.current.traslados).toHaveLength(60)
    expect(new Set(ids(result)).size).toBe(60)
  })

  it("un traslado nuevo arriba no pierde ni duplica ninguna fila", async () => {
    traerTraslados
      .mockResolvedValueOnce(pagina(1, 26, { hayMas: true }))
      // Llegó t-0: el mismo tamaño trae t-0..t-24 y empuja a t-25 fuera.
      .mockResolvedValueOnce({ traslados: [traslado(0), ...pagina(1, 25).traslados], hayMas: true })
      .mockResolvedValueOnce(pagina(25, 30))

    const { result } = renderHook(() => useTraslados())

    await asentar()
    await tic()

    expect(ids(result)[0]).toBe("t-0")
    expect(ids(result).at(-1)).toBe("t-25")
    expect(result.current.traslados).toHaveLength(26)

    // La página siguiente vuelve a traer t-25: se descarta por id.
    await act(() => result.current.cargarMas())

    expect(ids(result)).toEqual(Array.from({ length: 30 }, (_, i) => `t-${i}`))
  })

  it("nunca pide más filas que el máximo por consulta, y conserva las que quedan fuera", async () => {
    const MAXIMO = 500
    let siguiente = 0

    traerTraslados.mockImplementation((_, { inicio = 0, cantidad } = {}) => {
      if (cantidad) return Promise.resolve(pagina(0, cantidad, { estado: "recibido", hayMas: true }))

      siguiente = inicio + 25
      return Promise.resolve(pagina(inicio, siguiente, { hayMas: true }))
    })

    const { result } = renderHook(() => useTraslados())

    await asentar()

    for (let i = 0; i < 21; i++) await act(() => result.current.cargarMas())

    expect(result.current.traslados).toHaveLength(550)

    await tic()

    expect(traerTraslados).toHaveBeenLastCalledWith(expect.anything(), { cantidad: MAXIMO })
    expect(result.current.traslados).toHaveLength(550)
    expect(estados(result).slice(0, 500).every((e) => e === "recibido")).toBe(true)
    expect(estados(result).slice(500).every((e) => e === "pendiente")).toBe(true)
    expect(result.current.hayMas).toBe(true)
  })

  it("una respuesta antigua que llega tarde no devuelve a «pendiente» lo ya recibido", async () => {
    const vieja = respuestaPendiente()

    traerTraslados
      .mockResolvedValueOnce(pagina(1, 2))
      .mockReturnValueOnce(vieja.promesa)
      .mockResolvedValueOnce(pagina(1, 2, { estado: "recibido" }))

    const { result } = renderHook(() => useTraslados())

    await asentar()
    await tic()

    // Mientras el refresco espera, una operación de esta pantalla recarga.
    await act(() => result.current.recargar())
    expect(estados(result)).toEqual(["recibido"])

    await act(async () => {
      vieja.entregar(pagina(1, 2))
      await vieja.promesa
    })

    expect(estados(result)).toEqual(["recibido"])
  })

  it("no lanza otro refresco mientras hay uno en curso", async () => {
    const primero = respuestaPendiente()

    traerTraslados.mockResolvedValueOnce(pagina(1, 2)).mockReturnValueOnce(primero.promesa).mockResolvedValue(pagina(1, 2))

    renderHook(() => useTraslados())

    await asentar()
    await tic()
    await tic()
    expect(traerTraslados).toHaveBeenCalledTimes(2)

    await act(async () => {
      primero.entregar(pagina(1, 2))
      await primero.promesa
    })

    await tic()
    expect(traerTraslados).toHaveBeenCalledTimes(3)
  })

  it("con la pestaña oculta no consulta; al volver a la app, se pone al día", async () => {
    let ahora = 1_000_000
    vi.spyOn(Date, "now").mockImplementation(() => ahora)

    traerTraslados.mockResolvedValueOnce(pagina(1, 2)).mockResolvedValueOnce(pagina(1, 2, { estado: "recibido" }))

    const { result } = renderHook(() => useTraslados())

    await asentar()

    visible = "hidden"
    await tic()
    await tic()
    expect(traerTraslados).toHaveBeenCalledTimes(1)

    ahora += ESPERA_ENTRE_RECARGAS
    visible = "visible"
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))

    expect(traerTraslados).toHaveBeenCalledTimes(2)
    expect(estados(result)).toEqual(["recibido"])
  })

  it("si un refresco falla, conserva lo último que se supo y se recupera en el siguiente", async () => {
    traerTraslados
      .mockResolvedValueOnce(pagina(1, 2))
      .mockRejectedValueOnce(new Error("sin red"))
      .mockResolvedValueOnce(pagina(1, 2, { estado: "recibido" }))

    const { result } = renderHook(() => useTraslados())

    await asentar()
    await tic()

    expect(estados(result)).toEqual(["pendiente"])
    expect(result.current.error).toBe("")

    await tic()
    expect(estados(result)).toEqual(["recibido"])
  })

  it("tras un error en la primera carga, el refresco vuelve a intentarlo y lo limpia", async () => {
    traerTraslados.mockRejectedValueOnce(new Error("No se pudo cargar el historial.")).mockResolvedValueOnce(pagina(1, 2))

    const { result } = renderHook(() => useTraslados())

    await asentar()
    expect(result.current.error).toBe("No se pudo cargar el historial.")

    await tic()

    expect(result.current.error).toBe("")
    expect(estados(result)).toEqual(["pendiente"])
  })

  it("en pausa (confirmando o reportando) no refresca; al terminar, sí", async () => {
    traerTraslados.mockResolvedValue(pagina(1, 2))

    const { rerender } = renderHook((props) => useTraslados(props), { initialProps: { pausado: true } })

    await asentar()
    await tic()
    expect(traerTraslados).toHaveBeenCalledTimes(1)

    rerender({ pausado: false })
    await tic()
    expect(traerTraslados).toHaveBeenCalledTimes(2)
  })

  it("mientras se carga la página siguiente no refresca, y un refresco anterior no la pisa", async () => {
    const refresco = respuestaPendiente()
    const mas = respuestaPendiente()

    traerTraslados
      .mockResolvedValueOnce(pagina(0, 25, { hayMas: true }))
      .mockReturnValueOnce(refresco.promesa)
      .mockReturnValueOnce(mas.promesa)

    const { result } = renderHook(() => useTraslados())

    await asentar()
    await tic()

    let cargando
    act(() => {
      cargando = result.current.cargarMas()
    })

    await tic()
    expect(traerTraslados).toHaveBeenCalledTimes(3)

    await act(async () => {
      mas.entregar(pagina(25, 30))
      await cargando
    })

    await act(async () => {
      refresco.entregar(pagina(0, 25, { estado: "recibido" }))
      await refresco.promesa
    })

    expect(result.current.traslados).toHaveLength(30)
    expect(estados(result).every((e) => e === "pendiente")).toBe(true)
  })

  it("avisa a la pantalla después de cada refresco automático, no en la carga ni al recargar", async () => {
    const alRefrescar = vi.fn()

    traerTraslados.mockResolvedValue(pagina(1, 2))

    const { result } = renderHook(() => useTraslados({ alRefrescar }))

    await asentar()
    await act(() => result.current.recargar())
    expect(alRefrescar).not.toHaveBeenCalled()

    await tic()
    expect(alRefrescar).toHaveBeenCalledTimes(1)
  })

  it("con un rango de fechas no válido no consulta ni refresca", async () => {
    traerTraslados.mockResolvedValue(pagina(1, 2))

    renderHook(() => useTraslados({ activo: false }))

    await asentar()
    await tic()
    expect(traerTraslados).not.toHaveBeenCalled()
  })
})
