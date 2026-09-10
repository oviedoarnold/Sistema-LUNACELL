import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import Swal from "sweetalert2"

import { useClienteDelDocumento } from "./useClienteDelDocumento"

/*
  El alta de cliente es asíncrona: addClient consulta la base y devuelve el
  cliente ya creado, con el identificador que le asignó PostgreSQL.

  Estas pruebas existen porque ese `await` faltaba. Sin él, lo que quedaba
  seleccionado era la promesa: un objeto que pasa cualquier comprobación
  que solo mire si hay algo, pero cuyo `.id` es undefined. La venta al
  crédito llegaba a la base sin cliente y la rechazaba la restricción
  credito_exige_cliente, con el cajero ya con todo capturado.

  Se prueban contra el hook y no contra la pantalla porque aquí se puede
  controlar cuándo resuelve la promesa, que es justo lo que estaba mal.
*/

const CLIENTE_GUARDADO = {
  id: "c-real-99",
  name: "Taller Nuevo",
  rtn: "0801199912345",
  phone: "9999-0000",
  address: "San Pedro Sula",
  email: "",
}

const FORMULARIO_COMPLETO = {
  name: "Taller Nuevo",
  rtn: "0801199912345",
  phone: "9999-0000",
  address: "San Pedro Sula",
  email: "",
}

/*
  Una promesa que resuelve cuando la prueba lo decida. Es lo que permite
  comprobar qué pasa mientras el alta está en curso.
*/
function promesaControlada() {
  let resolver
  let rechazar

  const promesa = new Promise((cumplir, fallar) => {
    resolver = cumplir
    rechazar = fallar
  })

  return { promesa, resolver, rechazar }
}

const montar = (addClient, opciones = {}) =>
  renderHook(() => useClienteDelDocumento({ addClient, ...opciones }))

const llenar = (resultado, formulario = FORMULARIO_COMPLETO) =>
  act(() => {
    resultado.current.setFormulario(formulario)
  })

beforeEach(() => {
  Swal.fire.mockClear()
})

describe("alta de cliente · éxito", () => {
  it("selecciona el cliente que devolvió la base, no la promesa", async () => {
    // Arrange
    const addClient = vi.fn().mockResolvedValue(CLIENTE_GUARDADO)
    const { result } = montar(addClient)
    llenar(result)

    // Act
    await act(async () => {
      await result.current.guardarNuevo()
    })

    // Assert
    expect(result.current.seleccionado).toEqual(CLIENTE_GUARDADO)
    expect(result.current.seleccionado).not.toBeInstanceOf(Promise)
  })

  it("conserva el identificador real que asignó la base", async () => {
    const addClient = vi.fn().mockResolvedValue(CLIENTE_GUARDADO)
    const { result } = montar(addClient)
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(result.current.seleccionado.id).toBe("c-real-99")
  })

  it("deja el nombre del cliente en el campo de búsqueda", async () => {
    const addClient = vi.fn().mockResolvedValue(CLIENTE_GUARDADO)
    const { result } = montar(addClient)
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(result.current.busqueda).toBe("Taller Nuevo")
  })

  /*
    El punto de venta cuelga el RTN del comprador de este aviso. Con una
    promesa seleccionada llegaba undefined y el RTN quedaba vacío.
  */
  it("avisa del cambio con el cliente ya creado", async () => {
    const alCambiar = vi.fn()
    const addClient = vi.fn().mockResolvedValue(CLIENTE_GUARDADO)
    const { result } = montar(addClient, { alCambiar })
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(alCambiar).toHaveBeenCalledWith(CLIENTE_GUARDADO)
  })

  it("cierra el modal cuando el alta terminó bien", async () => {
    const addClient = vi.fn().mockResolvedValue(CLIENTE_GUARDADO)
    const { result } = montar(addClient)
    act(() => result.current.abrirAlta())
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(result.current.modalAbierto).toBe(false)
  })

  it("recorta los espacios antes de guardar", async () => {
    const addClient = vi.fn().mockResolvedValue(CLIENTE_GUARDADO)
    const { result } = montar(addClient)
    llenar(result, {
      ...FORMULARIO_COMPLETO,
      name: "  Taller Nuevo  ",
      phone: "  9999-0000  ",
    })

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(addClient).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Taller Nuevo", phone: "9999-0000" })
    )
  })
})

describe("alta de cliente · mientras la base responde", () => {
  /*
    Este es el caso que destapa el defecto: si no se espera, el hook
    continúa con la promesa en la mano.
  */
  it("no selecciona nada hasta que la base contesta", async () => {
    // Arrange
    const { promesa, resolver } = promesaControlada()
    const addClient = vi.fn().mockReturnValue(promesa)
    const { result } = montar(addClient)
    llenar(result)

    // Act: se lanza el guardado y no se espera todavía
    let guardado
    act(() => {
      guardado = result.current.guardarNuevo()
    })

    // Assert: en curso, sin cliente seleccionado
    expect(result.current.seleccionado).toBeNull()

    // Act: la base responde
    await act(async () => {
      resolver(CLIENTE_GUARDADO)
      await guardado
    })

    // Assert
    expect(result.current.seleccionado).toEqual(CLIENTE_GUARDADO)
  })

  it("marca que está guardando mientras espera", async () => {
    const { promesa, resolver } = promesaControlada()
    const addClient = vi.fn().mockReturnValue(promesa)
    const { result } = montar(addClient)
    llenar(result)

    let guardado
    act(() => {
      guardado = result.current.guardarNuevo()
    })

    expect(result.current.guardando).toBe(true)

    await act(async () => {
      resolver(CLIENTE_GUARDADO)
      await guardado
    })

    expect(result.current.guardando).toBe(false)
  })
})

describe("alta de cliente · cuando falla", () => {
  const fallo = () => vi.fn().mockRejectedValue(new Error("No se pudo crear el cliente."))

  it("no deja seleccionado un cliente que no se creó", async () => {
    const { result } = montar(fallo())
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(result.current.seleccionado).toBeNull()
  })

  /*
    El rechazo llega de forma asíncrona. Un try/catch alrededor de una
    llamada sin await no lo atrapa, y el error se perdía sin que el usuario
    se enterara.
  */
  it("atrapa el rechazo y lo explica", async () => {
    const { result } = montar(fallo())
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(Swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({
        icon: "error",
        title: "No se pudo guardar el cliente",
      })
    )
  })

  it("no anuncia un éxito que no ocurrió", async () => {
    const { result } = montar(fallo())
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    const anuncios = Swal.fire.mock.calls.map(([opciones]) => opciones.icon)

    expect(anuncios).not.toContain("success")
  })

  /*
    Cerrar el modal al fallar tira lo que el usuario acababa de escribir.
  */
  it("deja el modal abierto con los datos capturados", async () => {
    const { result } = montar(fallo())
    act(() => result.current.abrirAlta())
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(result.current.modalAbierto).toBe(true)
    expect(result.current.formulario.phone).toBe("9999-0000")
  })

  it("deja de estar guardando aunque haya fallado", async () => {
    const { result } = montar(fallo())
    llenar(result)

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(result.current.guardando).toBe(false)
  })
})

describe("alta de cliente · doble envío", () => {
  /*
    El botón no se bloqueaba mientras la base respondía. Dos clics seguidos
    daban de alta al mismo cliente dos veces.
  */
  it("no da de alta dos veces si se pulsa dos veces seguidas", async () => {
    const { promesa, resolver } = promesaControlada()
    const addClient = vi.fn().mockReturnValue(promesa)
    const { result } = montar(addClient)
    llenar(result)

    let primero
    act(() => {
      primero = result.current.guardarNuevo()
    })

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(addClient).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolver(CLIENTE_GUARDADO)
      await primero
    })
  })
})

describe("alta de cliente · validación", () => {
  it.each([
    ["sin nombre", { name: "" }],
    ["sin teléfono", { phone: "" }],
    ["sin dirección", { address: "" }],
  ])("no llama a la base %s", async (_caso, faltante) => {
    const addClient = vi.fn().mockResolvedValue(CLIENTE_GUARDADO)
    const { result } = montar(addClient)
    llenar(result, { ...FORMULARIO_COMPLETO, ...faltante })

    await act(async () => {
      await result.current.guardarNuevo()
    })

    expect(addClient).not.toHaveBeenCalled()
    expect(result.current.seleccionado).toBeNull()
  })

  it("avisa de los datos que faltan", async () => {
    const addClient = vi.fn()
    const { result } = montar(addClient)
    llenar(result, { ...FORMULARIO_COMPLETO, phone: "" })

    await act(async () => {
      await result.current.guardarNuevo()
    })

    await waitFor(() =>
      expect(Swal.fire).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Faltan datos" })
      )
    )
  })
})
