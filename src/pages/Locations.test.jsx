import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor, within } from "@testing-library/react"
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

function renderLocations(ubicaciones = UBICACIONES, fallarEn = {}) {
  return renderizarPantalla(
    <AuthProvider>
      <LocationsProvider>
        <Locations />
      </LocationsProvider>
    </AuthProvider>,
    { ubicaciones, fallarEn, esperar: ["ubicaciones"] }
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

  /*
    Quien busca un camión escribe "camion". Antes la comparación era
    literal y dejaba fuera "Camión 01", que en un mostrador se lee como
    que el dato no existe.
  */
  it("encuentra Camión escribiendo camion, sin tilde", async () => {
    await renderLocations()
    buscar("camion")

    expect(screen.getByText("Camión 01")).toBeInTheDocument()
  })

  it("tampoco le estorban las mayúsculas", async () => {
    await renderLocations()
    buscar("CAMION")

    expect(screen.getByText("Camión 01")).toBeInTheDocument()
  })

  it("y sigue encontrando escribiéndolo con tilde", async () => {
    await renderLocations()
    buscar("camión")

    expect(screen.getByText("Camión 01")).toBeInTheDocument()
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

/*
  Cuando la base rechaza el cambio con un motivo escrito para una persona,
  ese motivo tiene que llegar al diálogo. Antes llegaba solo a la consola.
*/
describe("Locations · el motivo del rechazo llega al diálogo", () => {
  const DEL_DISPARADOR =
    "No se puede desactivar «Bodega Principal»: es la ubicación operativa de 1 usuario(s). Cámbiales la ubicación antes."

  const textoDelError = () => {
    const llamada = Swal.fire.mock.calls
      .map(([args]) => args)
      .reverse()
      .find((args) => args && args.icon === "error")

    return llamada ? llamada.text : null
  }

  it("muestra la causa real que devolvió la base", async () => {
    await renderLocations(UBICACIONES, {
      ubicaciones: { update: { code: "P0001", message: DEL_DISPARADOR } },
    })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(screen.getAllByRole("button", { name: /desactivar/i })[0])

    await waitFor(() => {
      expect(textoDelError()).toBe(DEL_DISPARADOR)
    })
  })

  it("si no hay motivo utilizable, mantiene un aviso comprensible", async () => {
    await renderLocations(UBICACIONES, {
      ubicaciones: { update: { message: "Failed to fetch" } },
    })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(screen.getAllByRole("button", { name: /desactivar/i })[0])

    await waitFor(() => {
      expect(textoDelError()).toMatch(/no se pudo cambiar el estado/i)
    })
  })

  /*
    Y la fila no se queda mintiendo: si la base dijo que no, la ubicación
    sigue activa en pantalla.
  */
  it("la ubicación no cambia de estado cuando la base lo rechaza", async () => {
    const { falso } = await renderLocations(UBICACIONES, {
      ubicaciones: { update: { code: "P0001", message: DEL_DISPARADOR } },
    })

    Swal.fire.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(screen.getAllByRole("button", { name: /desactivar/i })[0])

    await waitFor(() => {
      expect(textoDelError()).toBeTruthy()
    })

    expect(falso.datos.ubicaciones.find((u) => u.id === "u1").activa).toBe(true)
  })
})

/*
  Ventas sin conexión por ubicación. La marca es de la ubicación, no del
  usuario: la cambia un administrador desde aquí, solo en camiones y
  bodegas, y desactivarla exige confirmar que los teléfonos sincronizaron.
*/
describe("Locations · ventas sin conexión", () => {
  const CON_CAMION_HABILITADO = [
    { id: "u1", name: "Bodega Principal", type: LOCATION_TYPES.WAREHOUSE },
    { id: "u2", name: "Lunacell Store", type: LOCATION_TYPES.STORE },
    { id: "u3", name: "Camión 01", type: LOCATION_TYPES.TRUCK, offline: true },
  ]

  const montar = ({ ubicaciones = CON_CAMION_HABILITADO, fallarEn = {}, rol = "admin", tablasExtra = {} } = {}) =>
    renderizarPantalla(
      <AuthProvider>
        <LocationsProvider>
          <Locations />
        </LocationsProvider>
      </AuthProvider>,
      {
        ubicaciones,
        fallarEn,
        rolDelUsuario: rol,
        permisosDelUsuario: rol === "admin" ? [] : ["locations"],
        tablasExtra: { ventas_por_conciliar: [], ...tablasExtra },
        esperar: ["ubicaciones"],
      }
    )

  const fila = (falso, id) => falso.datos.ubicaciones.find((u) => u.id === id)

  const editar = (nombre) =>
    fireEvent.click(
      within(screen.getByText(nombre).closest("tr")).getByRole("button", { name: /editar/i })
    )

  const casilla = () => screen.getByLabelText(/permitir ventas sin conexión/i)
  const guardar = () => fireEvent.click(screen.getByRole("button", { name: /guardar ubicación/i }))

  const ultimoAviso = (icono) =>
    Swal.fire.mock.calls.map(([a]) => a).reverse().find((a) => a?.icon === icono)

  it("la lista marca las ubicaciones que venden sin conexión", async () => {
    await montar()

    const camion = screen.getByText("Camión 01").closest("tr")
    const bodega = screen.getByText("Bodega Principal").closest("tr")
    expect(within(camion).getByText("Vende sin conexión")).toBeInTheDocument()
    expect(within(bodega).queryByText("Vende sin conexión")).not.toBeInTheDocument()
  })

  it("al editar, la casilla muestra el valor guardado", async () => {
    await montar()

    editar("Camión 01")
    expect(casilla()).toBeChecked()

    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }))
    editar("Bodega Principal")
    expect(casilla()).not.toBeChecked()
  })

  it("el administrador la activa en un camión y la lista se actualiza", async () => {
    const { falso } = await montar({
      ubicaciones: [{ id: "u5", name: "Camión 03", type: LOCATION_TYPES.TRUCK }],
    })

    editar("Camión 03")
    fireEvent.click(casilla())
    guardar()

    await waitFor(() => expect(fila(falso, "u5").vende_sin_conexion).toBe(true))
    await waitFor(() => expect(ultimoAviso("success")?.text).toMatch(/camión 03.*ya puede vender sin conexión/i))
    expect(await screen.findByText("Vende sin conexión")).toBeInTheDocument()
  })

  it("el administrador la activa en una bodega", async () => {
    const { falso } = await montar()

    editar("Bodega Principal")
    fireEvent.click(casilla())
    guardar()

    await waitFor(() => expect(fila(falso, "u1").vende_sin_conexion).toBe(true))
  })

  it("en una tienda la casilla está bloqueada y explica por qué", async () => {
    await montar()

    editar("Lunacell Store")

    expect(casilla()).toBeDisabled()
    expect(screen.getByText(/las tiendas no están autorizadas para vender sin conexión/i)).toBeInTheDocument()
  })

  it("quien gestiona ubicaciones sin ser administrador no puede cambiarla, y editar no la toca", async () => {
    const { falso } = await montar({ rol: "vendedor" })

    editar("Camión 01")
    expect(casilla()).toBeDisabled()
    expect(screen.getByText(/solo un administrador puede cambiar esta opción/i)).toBeInTheDocument()

    escribirNombre("Camión Uno")
    guardar()

    await waitFor(() => expect(fila(falso, "u3").nombre).toBe("Camión Uno"))
    expect(fila(falso, "u3").vende_sin_conexion).toBe(true)
  })

  it("una ubicación nueva no ofrece la casilla y se crea sin ventas sin conexión", async () => {
    const { falso } = await montar({ ubicaciones: [] })

    fireEvent.click(screen.getByRole("button", { name: /nueva ubicación/i }))
    expect(screen.queryByLabelText(/permitir ventas sin conexión/i)).not.toBeInTheDocument()

    escribirNombre("Camión 04")
    fireEvent.change(screen.getByLabelText(/tipo/i), { target: { value: LOCATION_TYPES.TRUCK } })
    guardar()

    await waitFor(() => expect(falso.datos.ubicaciones).toHaveLength(1))
    expect(falso.datos.ubicaciones[0].vende_sin_conexion).not.toBe(true)
  })

  it("con la casilla marcada, el tipo solo ofrece camión y bodega", async () => {
    await montar()

    editar("Camión 01")

    expect(screen.getByRole("option", { name: "Camión" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Bodega" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Tienda" })).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Otro" })).not.toBeInTheDocument()
  })

  describe("desactivar", () => {
    const desmarcarYGuardar = () => {
      editar("Camión 01")
      fireEvent.click(casilla())
      guardar()
    }

    const botonDesactivar = () => screen.getByRole("button", { name: /^desactivar ventas sin conexión$/i })
    const confirmo = () => screen.getByLabelText(/confirmo que los teléfonos de esta ubicación sincronizaron/i)
    const nombre = () => screen.getByLabelText(/escribe el nombre de la ubicación/i)

    it("muestra lo que sabe el servidor, advierte de los teléfonos y exige confirmar y escribir el nombre", async () => {
      const { falso } = await montar({
        tablasExtra: {
          ventas_por_conciliar: [{ id: "c1", ubicacion_id: "u3", estado: "pendiente" }],
        },
      })

      desmarcarYGuardar()

      expect(await screen.findByRole("heading", { name: /desactivar ventas sin conexión/i })).toBeInTheDocument()
      expect(await screen.findByTestId("resumen-por-conciliar")).toHaveTextContent("1")
      expect(screen.getByText(/el servidor no puede saber qué ventas siguen guardadas solo en los teléfonos/i)).toBeInTheDocument()
      expect(screen.getByText(/irá a conciliación/i)).toBeInTheDocument()

      expect(botonDesactivar()).toBeDisabled()
      fireEvent.click(confirmo())
      expect(botonDesactivar()).toBeDisabled()
      fireEvent.change(nombre(), { target: { value: "Camión 0" } })
      expect(botonDesactivar()).toBeDisabled()
      fireEvent.change(nombre(), { target: { value: "Camión 01" } })
      expect(botonDesactivar()).toBeEnabled()

      fireEvent.click(botonDesactivar())

      await waitFor(() => expect(fila(falso, "u3").vende_sin_conexion).toBe(false))
      await waitFor(() => expect(ultimoAviso("success")?.text).toMatch(/camión 01.*ya no vende sin conexión/i))
    })

    it("si cancela, no cambia nada", async () => {
      const { falso } = await montar()

      desmarcarYGuardar()
      await screen.findByTestId("resumen-por-conciliar")
      fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }))

      expect(screen.queryByRole("heading", { name: /desactivar ventas sin conexión/i })).not.toBeInTheDocument()
      expect(fila(falso, "u3").vende_sin_conexion).toBe(true)
    })

    it("si no se puede comprobar lo pendiente, lo dice y no deja desactivar", async () => {
      const { falso } = await montar({ fallarEn: { ventas_por_conciliar: { message: "Failed to fetch" } } })

      desmarcarYGuardar()

      expect(await screen.findByText(/no se pudo comprobar el estado de las ventas sin conexión/i)).toBeInTheDocument()
      expect(screen.queryByTestId("resumen-por-conciliar")).not.toBeInTheDocument()
      expect(botonDesactivar()).toBeDisabled()
      expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument()
      expect(fila(falso, "u3").vende_sin_conexion).toBe(true)
    })
  })

  describe("errores de la base", () => {
    const activarCamion03 = async (error) => {
      await montar({
        ubicaciones: [{ id: "u5", name: "Camión 03", type: LOCATION_TYPES.TRUCK }],
        fallarEn: { ubicaciones: { update: error } },
      })

      editar("Camión 03")
      fireEvent.click(casilla())
      guardar()
    }

    it("42501: solo un administrador puede", async () => {
      await activarCamion03({ code: "42501", message: "Solo un administrador decide si una ubicación vende sin conexión" })

      await waitFor(() =>
        expect(ultimoAviso("error")?.text).toBe("Solo un administrador puede cambiar si una ubicación vende sin conexión.")
      )
    })

    it("23514: solo camiones y bodegas", async () => {
      await activarCamion03({
        code: "23514",
        message: 'new row for relation "ubicaciones" violates check constraint "ubicaciones_sin_conexion_solo_camion_o_bodega"',
      })

      await waitFor(() =>
        expect(ultimoAviso("error")?.text).toBe("Solo los camiones y las bodegas pueden vender sin conexión.")
      )
    })
  })
})
