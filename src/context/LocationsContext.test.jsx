import { describe, it, expect, vi } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useContext } from "react"

import LocationsProvider from "./LocationsContext"
import { AuthProvider } from "./AuthContext"
import { LocationsContext } from "./contexts"
import { esperarQueSeAsiente, montarDatos } from "../test/pantallas"
import { LOCATION_TYPES } from "../utils/locations"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

function envoltura({ children }) {
  return (
    <AuthProvider>
      <LocationsProvider>{children}</LocationsProvider>
    </AuthProvider>
  )
}

async function montarContexto(ubicaciones = []) {
  const falso = montarDatos({ ubicaciones })

  const vista = renderHook(() => useContext(LocationsContext), {
    wrapper: envoltura,
  })

  await waitFor(() => {
    expect(falso.from).toHaveBeenCalledWith("ubicaciones")
  })

  await esperarQueSeAsiente(falso)

  return { ...vista, falso }
}

const LAS_CUATRO = [
  { id: "u1", name: "Bodega Principal", type: LOCATION_TYPES.WAREHOUSE },
  { id: "u2", name: "Lunacell Store", type: LOCATION_TYPES.STORE },
  { id: "u3", name: "Camión 01", type: LOCATION_TYPES.TRUCK },
  { id: "u4", name: "Camión 02", type: LOCATION_TYPES.TRUCK },
]

describe("LocationsContext — carga", () => {
  it("arranca sin ubicaciones cuando la empresa no tiene ninguna", async () => {
    const { result } = await montarContexto()

    expect(result.current.locations).toEqual([])
  })

  it("lee las ubicaciones que ya están en la base", async () => {
    const { result } = await montarContexto(LAS_CUATRO)

    expect(result.current.locations).toHaveLength(4)
  })

  it("traduce la fila de la base a la forma que usa la pantalla", async () => {
    const { result } = await montarContexto([LAS_CUATRO[0]])

    const [bodega] = result.current.locations

    expect(bodega.name).toBe("Bodega Principal")
    expect(bodega.type).toBe(LOCATION_TYPES.WAREHOUSE)
    expect(bodega.active).toBe(true)
  })

  it("deja de estar cargando cuando terminó", async () => {
    const { result } = await montarContexto(LAS_CUATRO)

    expect(result.current.cargando).toBe(false)
  })
})

describe("LocationsContext — crear", () => {
  it("agrega una ubicación", async () => {
    // Arrange
    const { result } = await montarContexto()

    // Act
    await act(async () => {
      await result.current.agregarUbicacion({
        name: "Camión 03",
        type: LOCATION_TYPES.TRUCK,
      })
    })

    // Assert
    expect(result.current.locations).toHaveLength(1)
    expect(result.current.locations[0].name).toBe("Camión 03")
  })

  it("recorta los espacios del nombre", async () => {
    const { result } = await montarContexto()

    await act(async () => {
      await result.current.agregarUbicacion({ name: "   Bodega Norte   " })
    })

    expect(result.current.locations[0].name).toBe("Bodega Norte")
  })

  /*
    La empresa no la elige la pantalla: sale de la sesión. Si esto se
    rompiera, la ubicación quedaría fuera del alcance de las políticas y
    nadie la vería.
  */
  it("guarda la ubicación con la empresa de quien la crea", async () => {
    const { result, falso } = await montarContexto()

    await act(async () => {
      await result.current.agregarUbicacion({ name: "Bodega Sur" })
    })

    expect(falso.datos.ubicaciones[0].empresa_id).toBe("empresa-prueba")
  })

  it("nace activa", async () => {
    const { result } = await montarContexto()

    await act(async () => {
      await result.current.agregarUbicacion({ name: "Bodega Sur" })
    })

    expect(result.current.locations[0].active).toBe(true)
  })

  /*
    Un tipo que la base rechazaría no debe salir del navegador: la
    restricción devolvería un error críptico en vez de guardar algo
    razonable.
  */
  it("cae al tipo por omisión si le mandan uno inválido", async () => {
    const { result } = await montarContexto()

    await act(async () => {
      await result.current.agregarUbicacion({
        name: "Rara",
        type: "nave-espacial",
      })
    })

    expect(result.current.locations[0].type).toBe(LOCATION_TYPES.WAREHOUSE)
  })

  it("deja que la base asigne el identificador", async () => {
    const { result } = await montarContexto()

    await act(async () => {
      await result.current.agregarUbicacion({ name: "Bodega Sur" })
    })

    expect(result.current.locations[0].id).toBeTruthy()
  })
})

describe("LocationsContext — editar", () => {
  it("actualiza el nombre de una ubicación", async () => {
    const { result } = await montarContexto([
      { id: "u1", name: "Camion 1", type: LOCATION_TYPES.TRUCK },
    ])

    await act(async () => {
      await result.current.editarUbicacion("u1", {
        name: "Camión 01",
        type: LOCATION_TYPES.TRUCK,
      })
    })

    expect(result.current.locations[0].name).toBe("Camión 01")
  })

  it("actualiza el tipo de una ubicación", async () => {
    const { result } = await montarContexto([
      { id: "u1", name: "Local Centro", type: LOCATION_TYPES.WAREHOUSE },
    ])

    await act(async () => {
      await result.current.editarUbicacion("u1", {
        name: "Local Centro",
        type: LOCATION_TYPES.STORE,
      })
    })

    expect(result.current.locations[0].type).toBe(LOCATION_TYPES.STORE)
  })

  it("no toca a las demás ubicaciones", async () => {
    const { result } = await montarContexto(LAS_CUATRO)

    await act(async () => {
      await result.current.editarUbicacion("u1", { name: "Bodega Central" })
    })

    const store = result.current.locations.find((u) => u.id === "u2")

    expect(store.name).toBe("Lunacell Store")
  })

  /*
    Editar el nombre no puede apagar una ubicación por descuido: el estado
    se cambia solo desde su propia acción.
  */
  it("editar no altera el estado", async () => {
    const { result } = await montarContexto([
      { id: "u1", name: "Camión 02", type: LOCATION_TYPES.TRUCK, active: false },
    ])

    await act(async () => {
      await result.current.editarUbicacion("u1", { name: "Camión 02 (taller)" })
    })

    expect(result.current.locations[0].active).toBe(false)
  })
})

describe("LocationsContext — estado", () => {
  it("desactiva una ubicación sin borrarla", async () => {
    // Arrange
    const { result } = await montarContexto([LAS_CUATRO[3]])

    // Act
    await act(async () => {
      await result.current.cambiarEstado("u4", false)
    })

    // Assert
    expect(result.current.locations).toHaveLength(1)
    expect(result.current.locations[0].active).toBe(false)
  })

  it("vuelve a activar una ubicación apagada", async () => {
    const { result } = await montarContexto([
      { id: "u4", name: "Camión 02", type: LOCATION_TYPES.TRUCK, active: false },
    ])

    await act(async () => {
      await result.current.cambiarEstado("u4", true)
    })

    expect(result.current.locations[0].active).toBe(true)
  })

  it("la fila sigue en la base después de desactivarla", async () => {
    const { result, falso } = await montarContexto([LAS_CUATRO[3]])

    await act(async () => {
      await result.current.cambiarEstado("u4", false)
    })

    expect(falso.datos.ubicaciones).toHaveLength(1)
  })

  it("solo las activas quedan disponibles para operar", async () => {
    const { result } = await montarContexto(LAS_CUATRO)

    await act(async () => {
      await result.current.cambiarEstado("u4", false)
    })

    expect(result.current.locations).toHaveLength(4)
    expect(result.current.ubicacionesActivas).toHaveLength(3)
  })
})

describe("LocationsContext — consultas y errores", () => {
  it("encuentra una ubicación por identificador", async () => {
    const { result } = await montarContexto(LAS_CUATRO)

    expect(result.current.obtenerUbicacionPorId("u3").name).toBe("Camión 01")
  })

  it("devuelve null si la ubicación no existe", async () => {
    const { result } = await montarContexto(LAS_CUATRO)

    expect(result.current.obtenerUbicacionPorId("no-existe")).toBeNull()
  })

  /*
    Que la base falle no puede dejar la pantalla en blanco sin explicación:
    el mensaje es lo único que el usuario tiene para saber qué pasó.
  */
  it("avisa cuando la base no devuelve las ubicaciones", async () => {
    const { crearSupabaseFalso } = await import("../test/supabaseFalso")

    globalThis.__supabaseFalso = crearSupabaseFalso({
      tablas: {
        empresas: [{ id: "empresa-prueba", nombre: "LUNACELL" }],
        usuarios: [
          {
            id: "u-prueba",
            auth_id: "auth-prueba",
            empresa_id: "empresa-prueba",
            email: "admin@lunacell.test",
            nombre: "Administradora",
            rol: "admin",
            activo: true,
          },
        ],
        permisos_usuario: [],
        ubicaciones: [],
      },
      sesionInicial: { user: { id: "auth-prueba" } },
      fallarEn: { ubicaciones: { message: "conexión perdida" } },
    })

    const { result } = renderHook(() => useContext(LocationsContext), {
      wrapper: envoltura,
    })

    await waitFor(() => {
      expect(result.current.error).toBeTruthy()
    })

    expect(result.current.locations).toEqual([])
  })

  it("no consulta la base mientras no haya sesión", async () => {
    const falso = montarDatos({ conSesion: false })

    renderHook(() => useContext(LocationsContext), { wrapper: envoltura })

    await esperarQueSeAsiente(falso)

    expect(falso.from).not.toHaveBeenCalledWith("ubicaciones")
  })
})
