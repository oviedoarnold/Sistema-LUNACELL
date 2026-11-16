import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, renderHook, screen } from "@testing-library/react"

import AvisoDeActualizacion from "./AvisoDeActualizacion"
import { bloquearActualizacion, hayOperacionEnCurso } from "../lib/actualizacion/bloqueos"
import { useCarrito } from "../hooks/useCarrito"
import { useBloqueoDeActualizacion } from "../hooks/useBloqueoDeActualizacion"

/*
  La actualización obligatoria: aviso, cuenta de 15 segundos, instalación sin
  botones, y espera solo mientras recargar destruiría algo o no hay conexión.
*/

// De segundo en segundo: cada paso de la cuenta se programa después de pintar el anterior.
async function pasar(ms) {
  let falta = ms

  do {
    const paso = Math.min(falta, 1000)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(paso)
    })

    falta -= paso
  } while (falta > 0)
}

const aviso = () => screen.queryByRole("status")

function montar({ version = "90bcdbf", publicada = "d6e27e7" } = {}) {
  const consultar = vi.fn(async () => (typeof publicada === "function" ? publicada() : publicada))
  const instalar = vi.fn(async () => {})

  render(<AvisoDeActualizacion version={version} consultar={consultar} instalar={instalar} />)

  return { consultar, instalar }
}

// Monta y espera la primera consulta: desde ahí corren los 15 segundos.
async function montarYConsultar(opciones) {
  const r = montar(opciones)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })

  return r
}

const fijarConexion = (valor) => {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => valor })
  window.dispatchEvent(new Event(valor ? "online" : "offline"))
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("aviso y cuenta regresiva", () => {
  it("avisa, cuenta de 15 a 0 e instala sin que nadie pulse nada", async () => {
    const { instalar } = montar()

    await pasar(0)
    expect(aviso()).toHaveTextContent("Hay una nueva versión de LUNACELL disponible. Se instalará automáticamente en 15 segundos.")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()

    await pasar(1000)
    expect(aviso()).toHaveTextContent("en 14 segundos")

    await pasar(13000)
    expect(aviso()).toHaveTextContent("en 1 segundo.")
    expect(instalar).not.toHaveBeenCalled()

    await pasar(1000)
    expect(instalar).toHaveBeenCalledTimes(1)
    expect(aviso()).toHaveTextContent("Instalando la nueva versión de LUNACELL")

    await pasar(60000)
    expect(instalar).toHaveBeenCalledTimes(1)
  })

  it("sin versión nueva no muestra nada ni instala", async () => {
    const { instalar } = montar({ publicada: "90bcdbf" })

    await pasar(20000)
    expect(aviso()).toBeNull()
    expect(instalar).not.toHaveBeenCalled()
  })

  it("una compilación local no consulta nada", async () => {
    const { consultar } = montar({ version: "local" })

    await pasar(10 * 60 * 1000)
    expect(consultar).not.toHaveBeenCalled()
  })

  it("busca al abrir, al volver a la aplicación, al recuperar la conexión y cada cinco minutos, sin duplicar el aviso", async () => {
    let publicada = "90bcdbf"
    const { consultar } = montar({ publicada: () => publicada })

    await pasar(0)
    expect(consultar).toHaveBeenCalledTimes(1)

    // Volver enseguida no consulta otra vez: mínimo un minuto entre consultas.
    document.dispatchEvent(new Event("visibilitychange"))
    expect(consultar).toHaveBeenCalledTimes(1)

    await pasar(5 * 60 * 1000)
    expect(consultar).toHaveBeenCalledTimes(2)

    window.dispatchEvent(new Event("online"))
    expect(consultar).toHaveBeenCalledTimes(3)

    publicada = "d6e27e7"
    await pasar(61 * 1000)
    document.dispatchEvent(new Event("visibilitychange"))
    await pasar(0)
    expect(aviso()).toHaveTextContent("en 15 segundos")

    window.dispatchEvent(new Event("online"))
    await pasar(1000)
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(aviso()).toHaveTextContent("en 14 segundos")
  })
})

describe("protege lo que está en curso", () => {
  it("con una operación abierta cuenta igual, pero espera a que termine y entonces instala sola", async () => {
    const retirar = bloquearActualizacion("carrito")
    const { instalar } = await montarYConsultar()

    await pasar(15000)
    expect(aviso()).toHaveTextContent("Actualización pendiente. Se instalará automáticamente al finalizar la operación actual.")

    await pasar(10 * 60 * 1000)
    expect(instalar).not.toHaveBeenCalled()

    await act(async () => retirar())
    await pasar(0)
    expect(instalar).toHaveBeenCalledTimes(1)
  })

  it("sin conexión espera a recuperarla", async () => {
    const { instalar } = montar()

    await pasar(0)
    fijarConexion(false)
    await pasar(15000)
    expect(aviso()).toHaveTextContent("Actualización pendiente. Se instalará automáticamente al recuperar la conexión.")
    expect(instalar).not.toHaveBeenCalled()

    await act(async () => fijarConexion(true))
    await pasar(0)
    expect(instalar).toHaveBeenCalledTimes(1)
  })

  it("si ya recargó hacia esta versión hace poco y seguía la vieja, no recarga en bucle", async () => {
    sessionStorage.setItem("lunacell:actualizacion", JSON.stringify({ objetivo: "d6e27e7", intentos: 1, ultimo: Date.now() }))
    const { instalar } = await montarYConsultar()

    await pasar(15000)
    await pasar(0)
    expect(instalar).not.toHaveBeenCalled()
    expect(aviso()).toHaveTextContent("Se volverá a intentar automáticamente")

    await pasar(2 * 60 * 1000)
    expect(instalar).toHaveBeenCalledTimes(1)
  })

  it("al arrancar ya con la versión buscada, olvida los intentos", async () => {
    sessionStorage.setItem("lunacell:actualizacion", JSON.stringify({ objetivo: "d6e27e7", intentos: 2, ultimo: Date.now() }))
    montar({ version: "d6e27e7", publicada: "d6e27e7" })

    await pasar(0)
    expect(sessionStorage.getItem("lunacell:actualizacion")).toBeNull()
  })
})

describe("qué cuenta como operación en curso", () => {
  it("un carrito con productos (venta, pedido, cotización, precio negociado)", () => {
    const { result } = renderHook(() => useCarrito({ productos: [{ id: "p1", name: "Cargador", price: 100 }], existenciaDe: () => 10 }))

    expect(hayOperacionEnCurso()).toBe(false)

    act(() => result.current.agregar({ id: "p1", name: "Cargador", price: 100 }, 1))
    expect(hayOperacionEnCurso()).toBe(true)

    act(() => result.current.vaciar())
    expect(hayOperacionEnCurso()).toBe(false)
  })

  it("lo que una pantalla marca mientras dura, y se retira al cerrarla", () => {
    const { rerender, unmount } = renderHook(({ activo }) => useBloqueoDeActualizacion(activo, "abono"), { initialProps: { activo: true } })

    expect(hayOperacionEnCurso()).toBe(true)
    rerender({ activo: false })
    expect(hayOperacionEnCurso()).toBe(false)
    rerender({ activo: true })
    unmount()
    expect(hayOperacionEnCurso()).toBe(false)
  })
})
