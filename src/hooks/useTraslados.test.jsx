import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

import { LOTE_POR_ID, traerTraslados, traerTrasladosPorId } from "../lib/api/traslados"
import { ESPERA_ENTRE_RECARGAS } from "./useAlVolverALaApp"
import { CADA_CUANTO, porActualizar, useTraslados } from "./useTraslados"

vi.mock("../lib/api/traslados", async (original) => ({
  ...(await original()),
  traerTraslados: vi.fn(),
  traerTrasladosPorId: vi.fn(),
}))

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
    traerTrasladosPorId.mockReset()
    traerTrasladosPorId.mockResolvedValue([])
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

  /*
    Más de 500 cargados (20 páginas o más). El refresco pide las 500
    primeras y, por su id, las de más abajo que todavía pueden cambiar:
    ninguna queda desactualizada para siempre.
  */
  describe("más allá de las 500 primeras filas", () => {
    // La base simulada: n traslados del más reciente (t-0) al más antiguo.
    let base

    const montarBase = (n, estadoDe = () => "pendiente") => {
      base = Array.from({ length: n }, (_, i) => traslado(i, estadoDe(i)))

      traerTraslados.mockImplementation((_, { inicio = 0, cantidad = 25 } = {}) =>
        Promise.resolve({
          traslados: base.slice(inicio, inicio + cantidad).map((t) => ({ ...t })),
          hayMas: inicio + cantidad < base.length,
        })
      )
      traerTrasladosPorId.mockImplementation((lista) =>
        Promise.resolve(base.filter((t) => lista.includes(t.id)).map((t) => ({ ...t })))
      )
    }

    // En el otro dispositivo: el traslado cambia de estado en la base.
    const cambiar = (n, estado) => {
      base[n] = { ...base[n], status: estado }
    }

    async function cargarTodo(result) {
      await asentar()

      while (result.current.hayMas) await act(() => result.current.cargarMas())
    }

    const pedidosPorId = () => traerTrasladosPorId.mock.calls.map(([lista]) => lista)

    it("nunca pide más filas que el máximo por consulta, y pone al día las de más abajo", async () => {
      montarBase(550)
      const { result } = renderHook(() => useTraslados())
      await cargarTodo(result)

      for (let i = 0; i < 550; i++) cambiar(i, "recibido")
      await tic()

      expect(traerTraslados).toHaveBeenLastCalledWith(expect.anything(), { cantidad: 500 })
      expect(estados(result).every((e) => e === "recibido")).toBe(true)
      expect(result.current.traslados).toHaveLength(550)
      expect(result.current.hayMas).toBe(false)
    })

    it("un traslado pendiente después de la fila 500 pasa a «recibido»", async () => {
      montarBase(550, (i) => (i < 500 ? "recibido" : i === 520 ? "pendiente" : "aplicado"))
      const { result } = renderHook(() => useTraslados())
      await cargarTodo(result)

      cambiar(520, "recibido")
      await tic()

      expect(result.current.traslados[520].status).toBe("recibido")
      expect(pedidosPorId()).toEqual([["t-520"]])
    })

    it("uno con incidencia después de la fila 500 también pasa a «recibido»", async () => {
      montarBase(550, (i) => (i === 530 ? "con_incidencia" : "recibido"))
      const { result } = renderHook(() => useTraslados())
      await cargarTodo(result)

      cambiar(530, "recibido")
      await tic()

      expect(result.current.traslados[530].status).toBe("recibido")
    })

    it("no vuelve a pedir los recibidos ni los aplicados de más abajo: ya no cambian", async () => {
      montarBase(560, (i) => (i < 530 ? "recibido" : "aplicado"))
      const { result } = renderHook(() => useTraslados())
      await cargarTodo(result)

      await tic()
      await tic()

      expect(traerTrasladosPorId).not.toHaveBeenCalled()
      expect(traerTraslados).toHaveBeenCalledTimes(1 + 22 + 2)
    })

    it("con más de 500 por actualizar, se turnan de a lotes y ninguna queda fuera", async () => {
      montarBase(1150)
      const { result } = renderHook(() => useTraslados())
      await cargarTodo(result)

      // 650 pendientes más abajo de la fila 500, todas recibidas en el otro dispositivo.
      for (let i = 0; i < 1150; i++) cambiar(i, "recibido")

      const vueltas = Math.ceil(650 / LOTE_POR_ID)
      for (let i = 0; i < vueltas; i++) await tic()

      expect(pedidosPorId()).toHaveLength(vueltas)
      expect(pedidosPorId().every((lista) => lista.length <= LOTE_POR_ID)).toBe(true)
      expect(new Set(pedidosPorId().flat()).size).toBe(650)
      expect(estados(result).every((e) => e === "recibido")).toBe(true)
    })

    it("el detalle abierto más abajo de la fila 500 se pide primero", async () => {
      montarBase(1150)
      const { result } = renderHook(() => useTraslados({ prioridad: "t-1100" }))
      await cargarTodo(result)

      cambiar(1100, "con_incidencia")
      await tic()

      expect(pedidosPorId()[0][0]).toBe("t-1100")
      expect(result.current.traslados[1100].status).toBe("con_incidencia")

      cambiar(1100, "recibido")
      await tic()

      expect(pedidosPorId()[1][0]).toBe("t-1100")
      expect(result.current.traslados[1100].status).toBe("recibido")
    })

    it("conserva el orden y las páginas, sin duplicados, y «cargar más» sigue funcionando", async () => {
      montarBase(560)
      const { result } = renderHook(() => useTraslados({ ubicacionId: "bodega" }))

      await asentar()
      for (let i = 0; i < 21; i++) await act(() => result.current.cargarMas())
      expect(result.current.traslados).toHaveLength(550)

      await tic()
      await tic()

      expect(ids(result)).toEqual(Array.from({ length: 550 }, (_, i) => `t-${i}`))
      expect(traerTraslados).toHaveBeenCalledWith({ ubicacionId: "bodega", desde: "", hasta: "" }, { cantidad: 500 })

      await act(() => result.current.cargarMas())
      expect(ids(result)).toEqual(Array.from({ length: 560 }, (_, i) => `t-${i}`))
    })

    it("una respuesta por id antigua no devuelve a «pendiente» lo ya recibido", async () => {
      montarBase(520)
      const { result } = renderHook(() => useTraslados())
      await cargarTodo(result)

      const vieja = respuestaPendiente()
      traerTrasladosPorId.mockReturnValueOnce(vieja.promesa)
      await tic()

      // Mientras esa respuesta tarda, se recibe y una operación de esta pantalla recarga.
      cambiar(510, "recibido")
      await act(() => result.current.recargar())
      expect(result.current.traslados[510].status).toBe("recibido")

      await act(async () => {
        vieja.entregar([traslado(510, "pendiente")])
        await vieja.promesa
      })

      expect(result.current.traslados[510].status).toBe("recibido")
    })

    it("si la consulta por id falla, conserva lo que había y se pone al día en el siguiente refresco", async () => {
      montarBase(520)
      const { result } = renderHook(() => useTraslados())
      await cargarTodo(result)

      cambiar(510, "recibido")
      traerTrasladosPorId.mockRejectedValueOnce(new Error("sin red"))
      await tic()

      expect(result.current.traslados[510].status).toBe("pendiente")
      expect(result.current.error).toBe("")

      await tic()
      expect(result.current.traslados[510].status).toBe("recibido")
    })

    it("en cada refresco hay como mucho una consulta del historial y una por id", async () => {
      montarBase(1150)
      const { result } = renderHook(() => useTraslados())
      await cargarTodo(result)

      const antes = [traerTraslados.mock.calls.length, traerTrasladosPorId.mock.calls.length]
      await tic()

      expect(traerTraslados.mock.calls.length - antes[0]).toBe(1)
      expect(traerTrasladosPorId.mock.calls.length - antes[1]).toBe(1)
    })
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

describe("porActualizar · qué filas de más abajo se piden por id", () => {
  const abajo = (n, estado = "pendiente") => Array.from({ length: n }, (_, i) => ({ id: `t-${i}`, status: estado }))

  it("solo las que todavía pueden cambiar: pendientes y con incidencia", () => {
    const filas = [
      { id: "a", status: "pendiente" },
      { id: "b", status: "recibido" },
      { id: "c", status: "con_incidencia" },
      { id: "d", status: "aplicado" },
    ]

    expect(porActualizar(filas, 0, null).lote).toEqual(["a", "c"])
    expect(porActualizar(abajo(10, "recibido"), 0, null)).toEqual({ lote: [], turno: 0 })
  })

  it("de a un lote, y el siguiente turno sigue donde quedó hasta dar la vuelta", () => {
    const filas = abajo(LOTE_POR_ID * 2 + 10)
    const vistos = []
    let turno = 0

    for (let i = 0; i < 3; i++) {
      const r = porActualizar(filas, turno, null)

      expect(r.lote.length).toBeLessThanOrEqual(LOTE_POR_ID)
      expect(new Set(r.lote).size).toBe(r.lote.length)
      vistos.push(...r.lote)
      turno = r.turno
    }

    expect(new Set(vistos).size).toBe(filas.length)
  })

  it("el detalle abierto va primero y no se repite en el lote", () => {
    const filas = abajo(LOTE_POR_ID * 3)
    const { lote } = porActualizar(filas, LOTE_POR_ID, "t-149")

    expect(lote[0]).toBe("t-149")
    expect(lote).toHaveLength(LOTE_POR_ID)
    expect(lote.filter((id) => id === "t-149")).toHaveLength(1)
  })

  it("un detalle abierto ya recibido no se vuelve a pedir", () => {
    const filas = [{ id: "t-1", status: "recibido" }, ...abajo(3).map((t, i) => ({ ...t, id: `p-${i}` }))]

    expect(porActualizar(filas, 0, "t-1").lote).toEqual(["p-0", "p-1", "p-2"])
  })

  it("con menos filas que el lote, las pide todas una sola vez", () => {
    const { lote } = porActualizar(abajo(7), 5, null)

    expect([...lote].sort()).toEqual(abajo(7).map((t) => t.id).sort())
  })
})
