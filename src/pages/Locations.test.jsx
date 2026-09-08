import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor } from "@testing-library/react"
import Swal from "sweetalert2"

import { AuthProvider } from "../context/AuthContext"
import LocationsProvider from "../context/LocationsContext"
import { renderizarPantalla } from "../test/pantallas"
import { LOCATION_TYPES } from "../utils/locations"
import Locations from "./Locations"

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const UBICACIONES = [
  { id: "u1", name: "Bodega Principal", type: LOCATION_TYPES.WAREHOUSE },
  { id: "u2", name: "Lunacell Store", type: LOCATION_TYPES.STORE },
  { id: "u3", name: "Camión 01", type: LOCATION_TYPES.TRUCK },
  { id: "u4", name: "Camión 02", type: LOCATION_TYPES.TRUCK, active: false },
]

function renderLocations(ubicaciones = UBICACIONES) {
  return renderizarPantalla(
    <AuthProvider>
      <LocationsProvider>
        <Locations />
      </LocationsProvider>
    </AuthProvider>,
    { ubicaciones, esperar: ["ubicaciones"] }
  )
}

const buscar = (texto) =>
  fireEvent.change(screen.getByPlaceholderText(/buscar/i), {
    target: { value: texto },
  })

const escribirNombre = (texto) =>
  fireEvent.change(screen.getByLabelText(/nombre/i), {
    target: { value: texto },
  })

describe("Locations — listado", () => {
  it("lista las ubicaciones guardadas", async () => {
    await renderLocations()

    expect(screen.getByText("Bodega Principal")).toBeInTheDocument()
    expect(screen.getByText("Lunacell Store")).toBeInTheDocument()
    expect(screen.getByText("Camión 01")).toBeInTheDocument()
  })

  it("muestra el tipo con el nombre que entiende el usuario", async () => {
    await renderLocations()

    expect(screen.getByText("Tienda")).toBeInTheDocument()
    expect(screen.getAllByText("Camión")).toHaveLength(2)
  })

  /*
    Una ubicación apagada tiene que seguir viéndose: es lo único que
    permite volver a encenderla, y su nombre sigue ocupado.
  */
  it("muestra también las desactivadas, marcadas como inactivas", async () => {
    await renderLocations()

    expect(screen.getByText("Camión 02")).toBeInTheDocument()
    expect(screen.getByText("Inactiva")).toBeInTheDocument()
  })

  it("muestra un mensaje cuando no hay ubicaciones", async () => {
    await renderLocations([])

    expect(screen.getByText(/no hay ubicaciones/i)).toBeInTheDocument()
  })
})

describe("Locations — búsqueda", () => {
  it("filtra por nombre", async () => {
    await renderLocations()
    buscar("lunacell")

    expect(screen.getByText("Lunacell Store")).toBeInTheDocument()
    expect(screen.queryByText("Bodega Principal")).not.toBeInTheDocument()
  })

  it("filtra por tipo", async () => {
    await renderLocations()
    buscar("camión")

    expect(screen.getByText("Camión 01")).toBeInTheDocument()
    expect(screen.queryByText("Bodega Principal")).not.toBeInTheDocument()
  })

  it("no muestra nada cuando la búsqueda no coincide", async () => {
    await renderLocations()
    buscar("sucursal-inexistente")

    expect(screen.getByText(/no se encontraron resultados/i)).toBeInTheDocument()
  })
})

describe("Locations — crear", () => {
  it("abre el formulario de ubicación nueva", async () => {
    await renderLocations()

    fireEvent.click(screen.getByRole("button", { name: /nueva ubicación/i }))

    expect(
      screen.getByRole("heading", { name: /nueva ubicación/i })
    ).toBeInTheDocument()
  })

  it("ofrece los cuatro tipos en el desplegable", async () => {
    await renderLocations()

    fireEvent.click(screen.getByRole("button", { name: /nueva ubicación/i }))

    expect(screen.getByRole("option", { name: "Bodega" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Tienda" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Camión" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Otro" })).toBeInTheDocument()
  })

  it("guarda la ubicación nueva y la muestra en la lista", async () => {
    // Arrange
    await renderLocations([])
    fireEvent.click(screen.getByRole("button", { name: /nueva ubicación/i }))

    // Act
    escribirNombre("Camión 03")
    fireEvent.click(screen.getByRole("button", { name: /guardar ubicación/i }))

    // Assert
    expect(await screen.findByText("Camión 03")).toBeInTheDocument()
  })

  it("no guarda una ubicación sin nombre", async () => {
    const { falso } = await renderLocations([])

    fireEvent.click(screen.getByRole("button", { name: /nueva ubicación/i }))
    fireEvent.click(screen.getByRole("button", { name: /guardar ubicación/i }))

    await waitFor(() => {
      expect(falso.datos.ubicaciones).toHaveLength(0)
    })
  })
})

describe("Locations — editar", () => {
  it("abre el formulario con los datos de la ubicación", async () => {
    await renderLocations()

    fireEvent.click(screen.getAllByRole("button", { name: /editar/i })[0])

    expect(
      screen.getByRole("heading", { name: /editar ubicación/i })
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/nombre/i)).toHaveValue("Bodega Principal")
  })

  it("guarda el nombre cambiado", async () => {
    await renderLocations()

    fireEvent.click(screen.getAllByRole("button", { name: /editar/i })[0])
    escribirNombre("Bodega Central")
    fireEvent.click(screen.getByRole("button", { name: /guardar ubicación/i }))

    expect(await screen.findByText("Bodega Central")).toBeInTheDocument()
  })
})

describe("Locations — estado", () => {
  /*
    La acción sobre una ubicación activa es desactivar, nunca eliminar: su
    historial de inventario tiene que sobrevivir.
  */
  it("ofrece desactivar y no eliminar", async () => {
    await renderLocations()

    expect(screen.getAllByRole("button", { name: /desactivar/i })).toHaveLength(3)
    expect(screen.queryByRole("button", { name: /eliminar/i })).not.toBeInTheDocument()
  })

  it("ofrece activar la que está apagada", async () => {
    await renderLocations()

    expect(screen.getByRole("button", { name: /^activar$/i })).toBeInTheDocument()
  })

  it("desactivar pide confirmación y conserva la fila", async () => {
    // Arrange
    const { falso } = await renderLocations()
    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })

    // Act
    fireEvent.click(screen.getAllByRole("button", { name: /desactivar/i })[0])

    // Assert
    await waitFor(() => {
      const bodega = falso.datos.ubicaciones.find((u) => u.id === "u1")
      expect(bodega.activa).toBe(false)
    })

    expect(falso.datos.ubicaciones).toHaveLength(4)
  })

  it("no desactiva si el usuario cancela la confirmación", async () => {
    const { falso } = await renderLocations()

    fireEvent.click(screen.getAllByRole("button", { name: /desactivar/i })[0])

    await waitFor(() => {
      expect(Swal.fire).toHaveBeenCalled()
    })

    const bodega = falso.datos.ubicaciones.find((u) => u.id === "u1")
    expect(bodega.activa).toBe(true)
  })

  it("activar una ubicación apagada la deja activa", async () => {
    const { falso } = await renderLocations()

    fireEvent.click(screen.getByRole("button", { name: /^activar$/i }))

    await waitFor(() => {
      const camion02 = falso.datos.ubicaciones.find((u) => u.id === "u4")
      expect(camion02.activa).toBe(true)
    })
  })
})
