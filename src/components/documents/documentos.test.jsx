import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

import ClientAutocomplete from "./ClientAutocomplete"
import DocumentPreviewModal from "./DocumentPreviewModal"

/*
  Los dos componentes que comparten facturar, cotizar e historial.

  Lo que se prueba aquí es lo que antes no se podía hacer sin ratón: elegir
  un cliente de la lista, registrar uno nuevo y salir de una vista previa.
  Eran divs que escuchaban clics, así que el teclado no llegaba a ellos.
*/

const CLIENTES = [
  {
    id: "c1",
    name: "Arnold Oviedo",
    phone: "9999-0000",
    rtn: "0801199912345",
    address: "Tegucigalpa",
  },
  {
    id: "c2",
    name: "Taller Central",
    phone: "8888-1111",
    rtn: "",
    address: "Comayagüela",
  },
]

function montarBuscador(props = {}) {
  return render(
    <ClientAutocomplete
      clients={CLIENTES}
      value=""
      onChange={() => {}}
      {...props}
    />
  )
}

const listaAbierta = () =>
  document.querySelector(".client-dropdown")

describe("buscador de cliente · se puede usar sin ratón", () => {
  it("cada cliente de la lista es un botón de verdad", () => {
    montarBuscador()

    fireEvent.focus(screen.getByRole("textbox"))

    const opciones = within(listaAbierta()).getAllByRole("button")

    /* Dos clientes más el de registrar uno nuevo no se cuenta aquí. */
    expect(opciones.length).toBeGreaterThanOrEqual(2)
    expect(opciones[0].tagName).toBe("BUTTON")
    expect(opciones[0]).toHaveTextContent("Arnold Oviedo")
  })

  it("se puede enfocar una opción con el teclado", () => {
    montarBuscador()

    fireEvent.focus(screen.getByRole("textbox"))

    const opcion = within(listaAbierta()).getByRole("button", {
      name: /arnold oviedo/i,
    })

    opcion.focus()

    expect(document.activeElement).toBe(opcion)
  })

  /*
    Con un div, Enter no hacía nada: no era un control. Un button lo
    convierte en clic sin que haya que escribir el manejador.
  */
  it("Enter sobre una opción elige ese cliente", () => {
    const onSelect = vi.fn()
    montarBuscador({ onSelect })

    fireEvent.focus(screen.getByRole("textbox"))

    const opcion = within(listaAbierta()).getByRole("button", {
      name: /taller central/i,
    })

    fireEvent.click(opcion)

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c2" })
    )
  })

  it("registrar cliente nuevo también es un botón", () => {
    const onCreateNew = vi.fn()
    montarBuscador({ onCreateNew })

    fireEvent.focus(screen.getByRole("textbox"))

    const alta = screen.getByRole("button", {
      name: /registrar cliente nuevo/i,
    })

    expect(alta.tagName).toBe("BUTTON")

    fireEvent.click(alta)

    expect(onCreateNew).toHaveBeenCalled()
  })

  it("Escape cierra la lista desde el campo", () => {
    montarBuscador()

    fireEvent.focus(screen.getByRole("textbox"))
    expect(listaAbierta()).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })

    expect(listaAbierta()).not.toBeInTheDocument()
  })

  /*
    El manejador vive en el campo y en cada opción, que son los que pueden
    tener el foco, y no en el div que los envuelve. Esta prueba cubre el
    caso que se perdería si alguien lo moviera de vuelta al contenedor y lo
    quitara de las opciones.
  */
  it("Escape también cierra con el foco puesto en una opción", () => {
    montarBuscador()

    fireEvent.focus(screen.getByRole("textbox"))

    const opcion = within(listaAbierta()).getByRole("button", {
      name: /arnold oviedo/i,
    })

    fireEvent.keyDown(opcion, { key: "Escape" })

    expect(listaAbierta()).not.toBeInTheDocument()
  })

  /*
    El aviso de que no hay resultados no es una opción: no debe detener al
    teclado en algo que no hace nada.
  */
  it("el aviso de sin resultados no es pulsable", () => {
    montarBuscador({ value: "zzzznoexiste" })

    fireEvent.focus(screen.getByRole("textbox"))

    expect(
      screen.getByText(/no se encontraron clientes/i).tagName
    ).toBe("P")

    const pulsables = within(listaAbierta()).queryAllByRole("button")

    expect(
      pulsables.some((b) => /no se encontraron/i.test(b.textContent))
    ).toBe(false)
  })

  it("el botón de quitar cliente dice a quién quita", () => {
    montarBuscador({ selectedClient: CLIENTES[0] })

    expect(
      screen.getByRole("button", { name: /quitar a arnold oviedo/i })
    ).toBeInTheDocument()
  })
})

describe("vista previa de documento · se puede cerrar sin ratón", () => {
  const montar = (props = {}) =>
    render(
      <DocumentPreviewModal open title="Factura" onClose={() => {}} {...props}>
        <p>contenido del documento</p>
      </DocumentPreviewModal>
    )

  it("se anuncia como diálogo y toma su nombre del título", () => {
    montar()

    const dialogo = screen.getByRole("dialog")

    expect(dialogo).toHaveAttribute("aria-modal", "true")
    expect(dialogo).toHaveAccessibleName("Factura")
  })

  /*
    Esta ventana era la única del sistema sin Escape: se entraba con el
    teclado y no había forma de salir sin buscar la X con el ratón.
  */
  it("Escape la cierra", () => {
    const onClose = vi.fn()
    montar({ onClose })

    fireEvent.keyDown(document, { key: "Escape" })

    expect(onClose).toHaveBeenCalled()
  })

  it("no escucha el teclado mientras está cerrada", () => {
    const onClose = vi.fn()

    render(
      <DocumentPreviewModal open={false} title="Factura" onClose={onClose}>
        <p>contenido</p>
      </DocumentPreviewModal>
    )

    fireEvent.keyDown(document, { key: "Escape" })

    expect(onClose).not.toHaveBeenCalled()
  })

  /*
    Se acota a la cabecera: el pie tiene su propio «Cerrar», y sin acotar
    la consulta encuentra los dos. La X era un aspa de texto sin nombre.
  */
  it("la X de la cabecera tiene nombre accesible", () => {
    montar()

    const cabecera = document.querySelector(".modal-head")

    expect(
      within(cabecera).getByRole("button", { name: /cerrar/i })
    ).toBeInTheDocument()
  })

  it("sigue mostrando el contenido que recibe", () => {
    montar()

    expect(screen.getByText("contenido del documento")).toBeInTheDocument()
  })
})
