import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { FaBoxOpen, FaWarehouse } from "react-icons/fa"

import EmptyState from "./EmptyState"
import PageHeader from "./PageHeader"
import SearchInput from "./SearchInput"
import StatusBadge from "./StatusBadge"

/*
  Los cuatro componentes que comparten las pantallas administrativas.

  Se prueban por separado porque lo que hay que proteger no es cómo se
  ven, sino el contrato: que el encabezado no vuelva a escribir el título
  que ya pone la barra superior, que la búsqueda no filtre por su cuenta,
  que el distintivo no decida qué significa un estado y que un icono
  decorativo no acabe leyéndose en voz alta.
*/

describe("PageHeader", () => {
  it("no escribe ningún encabezado: el título lo pone la barra superior", () => {
    const { container } = render(<PageHeader descripcion="Controla tus productos." />)

    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
  })

  it("muestra la descripción de la pantalla", () => {
    render(<PageHeader descripcion="Controla tus productos." />)

    expect(screen.getByText("Controla tus productos.")).toBeInTheDocument()
  })

  it("aloja la acción principal que le pasen", () => {
    render(
      <PageHeader descripcion="Clientes.">
        <button>Nuevo cliente</button>
      </PageHeader>
    )

    expect(screen.getByRole("button", { name: "Nuevo cliente" })).toBeInTheDocument()
  })

  it("sin acción no deja un hueco vacío", () => {
    const { container } = render(<PageHeader descripcion="Solo lectura." />)

    expect(container.querySelector(".crud-acciones")).toBeNull()
  })
})

describe("SearchInput", () => {
  it("muestra el texto que recibe", () => {
    render(<SearchInput value="cargador" onChange={() => {}} placeholder="Buscar..." />)

    expect(screen.getByPlaceholderText("Buscar...")).toHaveValue("cargador")
  })

  it("avisa de cada cambio sin filtrar nada por su cuenta", () => {
    /*
      El valor se lee dentro del manejador: al ser un campo controlado
      con value="", React devuelve el input a vacío en cuanto termina el
      evento y mirarlo después daría siempre "".
    */
    const recibido = []
    const onChange = vi.fn((evento) => recibido.push(evento.target.value))

    render(<SearchInput value="" onChange={onChange} placeholder="Buscar..." />)

    fireEvent.change(screen.getByPlaceholderText("Buscar..."), {
      target: { value: "funda" },
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(recibido).toEqual(["funda"])
  })

  it("usa la etiqueta explícita cuando se le da", () => {
    render(
      <SearchInput
        value=""
        onChange={() => {}}
        placeholder="Buscar..."
        etiqueta="Buscar en el inventario"
      />
    )

    expect(screen.getByLabelText("Buscar en el inventario")).toBeInTheDocument()
  })

  /*
    Sin etiqueta explícita el campo seguiría siendo anunciable: se cae al
    marcador de posición antes que quedarse mudo.
  */
  it("sin etiqueta explícita recurre al marcador de posición", () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Buscar cliente..." />)

    expect(screen.getByLabelText("Buscar cliente...")).toBeInTheDocument()
  })

  it("la lupa es decorativa y no se anuncia", () => {
    const { container } = render(
      <SearchInput value="" onChange={() => {}} placeholder="Buscar..." />
    )

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })
})

describe("EmptyState", () => {
  it("dice qué pasa", () => {
    render(<EmptyState titulo="No hay productos todavía" />)

    expect(screen.getByText("No hay productos todavía")).toBeInTheDocument()
  })

  it("añade la explicación cuando la hay", () => {
    render(
      <EmptyState titulo="Sin resultados" descripcion="Prueba con otro código." />
    )

    expect(screen.getByText("Prueba con otro código.")).toBeInTheDocument()
  })

  it("sin descripción no inventa texto", () => {
    const { container } = render(<EmptyState titulo="Sin resultados" />)

    expect(container.querySelector(".empty-state-texto")).toBeNull()
  })

  it("el icono es decorativo", () => {
    const { container } = render(<EmptyState Icono={FaBoxOpen} titulo="Vacío" />)

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("aloja una acción si se le pasa", () => {
    render(
      <EmptyState titulo="Vacío">
        <button>Crear el primero</button>
      </EmptyState>
    )

    expect(screen.getByRole("button", { name: "Crear el primero" })).toBeInTheDocument()
  })
})

describe("StatusBadge", () => {
  it("muestra el texto que le dan", () => {
    render(<StatusBadge variante="ok">Disponible</StatusBadge>)

    expect(screen.getByText("Disponible")).toBeInTheDocument()
  })

  /*
    El componente no sabe de inventario ni de cobros: la página le pasa la
    variante ya resuelta y él solo la traduce a una clase.
  */
  it("traduce la variante a su clase, sin interpretarla", () => {
    const { container } = render(<StatusBadge variante="out">Agotado</StatusBadge>)

    expect(container.querySelector(".badge")).toHaveClass("badge-out")
  })

  it("sin variante cae en la neutra", () => {
    const { container } = render(<StatusBadge>Bodega</StatusBadge>)

    expect(container.querySelector(".badge")).toHaveClass("badge-neutral")
  })

  /*
    El estado nunca puede quedarse solo en el color: si no hay icono, va
    un punto; si lo hay, el icono es la segunda señal.
  */
  it("sin icono lleva un punto además del color", () => {
    const { container } = render(<StatusBadge variante="ok">Activa</StatusBadge>)

    expect(container.querySelector(".badge-dot")).toBeInTheDocument()
  })

  it("con icono lo usa como segunda señal y no lo anuncia", () => {
    const { container } = render(
      <StatusBadge variante="neutral" Icono={FaWarehouse}>Bodega</StatusBadge>
    )

    expect(container.querySelector(".badge-dot")).toBeNull()
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })
})
