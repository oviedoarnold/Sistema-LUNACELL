import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import FormField from "./FormField"
import ModalShell from "./ModalShell"

/*
  Los dos patrones que comparten los formularios y las ventanas.

  Lo que se protege aquí no es el aspecto: es que la etiqueta quede
  asociada al control, que la ayuda y el error se anuncien al llegar al
  campo, que una ventana se presente como diálogo, que Escape la cierre y
  que el foco vuelva a donde estaba. Nada de eso existía antes y nada de
  eso se ve en una captura.
*/

describe("FormField", () => {
  it("asocia la etiqueta al control", () => {
    render(
      <FormField etiqueta="Código">
        <input id="codigo" />
      </FormField>
    )

    expect(screen.getByLabelText("Código")).toHaveAttribute("id", "codigo")
  })

  it("respeta el id que ya trae el control", () => {
    render(
      <FormField etiqueta="Nombre">
        <input id="nombre-propio" />
      </FormField>
    )

    expect(screen.getByLabelText("Nombre").id).toBe("nombre-propio")
  })

  /*
    Sin id propio hay que ponerle uno igual: una etiqueta sin htmlFor
    que apunte a algo no sirve de nada.
  */
  it("pone un id cuando el control no trae ninguno", () => {
    render(
      <FormField etiqueta="Teléfono">
        <input />
      </FormField>
    )

    const control = screen.getByLabelText("Teléfono")

    expect(control.id).toBeTruthy()
  })

  it("enlaza la ayuda al control para que se anuncie con él", () => {
    render(
      <FormField etiqueta="Stock mínimo" ayuda="Por debajo se marca escaso.">
        <input id="min" />
      </FormField>
    )

    const control = screen.getByLabelText("Stock mínimo")
    const ayuda = screen.getByText("Por debajo se marca escaso.")

    expect(control.getAttribute("aria-describedby")).toBe(ayuda.id)
  })

  it("enlaza el error y marca el campo como inválido", () => {
    render(
      <FormField etiqueta="Monto" error="El monto supera el saldo.">
        <input id="monto" />
      </FormField>
    )

    const control = screen.getByLabelText("Monto")

    expect(control).toHaveAttribute("aria-invalid", "true")
    expect(control.getAttribute("aria-describedby")).toBe(
      screen.getByText("El monto supera el saldo.").id
    )
  })

  it("con ayuda y error anuncia los dos", () => {
    render(
      <FormField etiqueta="Monto" ayuda="Máximo L 100.00" error="Demasiado.">
        <input id="m2" />
      </FormField>
    )

    const descrito = screen.getByLabelText("Monto").getAttribute("aria-describedby")

    expect(descrito.split(" ")).toHaveLength(2)
  })

  it("sin error no marca nada como inválido", () => {
    render(
      <FormField etiqueta="Correo">
        <input id="correo" />
      </FormField>
    )

    const control = screen.getByLabelText("Correo")

    expect(control).not.toHaveAttribute("aria-invalid")
    expect(control).not.toHaveAttribute("aria-describedby")
  })

  it("conserva los atributos propios del control", () => {
    render(
      <FormField etiqueta="Precio">
        <input id="precio" type="number" name="price" step="0.01" />
      </FormField>
    )

    const control = screen.getByLabelText("Precio")

    expect(control).toHaveAttribute("name", "price")
    expect(control).toHaveAttribute("step", "0.01")
    expect(control).toHaveAttribute("type", "number")
  })

  it("el error se lee en cuanto aparece", () => {
    render(
      <FormField etiqueta="Monto" error="Falta el monto.">
        <input id="m3" />
      </FormField>
    )

    expect(screen.getByRole("alert")).toHaveTextContent("Falta el monto.")
  })
})

describe("ModalShell", () => {
  const abrir = (extra = {}) =>
    render(
      <ModalShell titulo="Nuevo producto" onCerrar={() => {}} {...extra}>
        <input aria-label="Código" />
      </ModalShell>
    )

  it("se presenta como diálogo", () => {
    abrir()

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true")
  })

  it("el diálogo lleva el nombre de su título", () => {
    abrir()

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Nuevo producto")
  })

  it("el título es un encabezado", () => {
    abrir()

    expect(
      screen.getByRole("heading", { name: "Nuevo producto" })
    ).toBeInTheDocument()
  })

  it("el botón de cerrar se anuncia", () => {
    const onCerrar = vi.fn()
    abrir({ onCerrar })

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))

    expect(onCerrar).toHaveBeenCalledTimes(1)
  })

  /*
    Escape es lo mismo que pulsar la X, que todas las ventanas tenían ya.
    Sin ella un teclado no tiene salida rápida.
  */
  it("Escape la cierra", () => {
    const onCerrar = vi.fn()
    abrir({ onCerrar })

    fireEvent.keyDown(document, { key: "Escape" })

    expect(onCerrar).toHaveBeenCalledTimes(1)
  })

  it("otra tecla no la cierra", () => {
    const onCerrar = vi.fn()
    abrir({ onCerrar })

    fireEvent.keyDown(document, { key: "a" })

    expect(onCerrar).not.toHaveBeenCalled()
  })

  /*
    Pulsar fuera solo cierra donde la pantalla ya lo hacía: convertir un
    clic despistado en un formulario perdido sería un riesgo nuevo.
  */
  it("por omisión, pulsar fuera no cierra", () => {
    const onCerrar = vi.fn()
    const { container } = abrir({ onCerrar })

    fireEvent.mouseDown(container.querySelector(".modal-overlay"))

    expect(onCerrar).not.toHaveBeenCalled()
  })

  it("pulsar fuera cierra solo si la pantalla lo pide", () => {
    const onCerrar = vi.fn()
    const { container } = abrir({ onCerrar, cerrarAlPulsarFuera: true })

    fireEvent.mouseDown(container.querySelector(".modal-overlay"))

    expect(onCerrar).toHaveBeenCalledTimes(1)
  })

  it("pulsar dentro nunca cierra", () => {
    const onCerrar = vi.fn()
    abrir({ onCerrar, cerrarAlPulsarFuera: true })

    fireEvent.mouseDown(screen.getByRole("dialog"))

    expect(onCerrar).not.toHaveBeenCalled()
  })

  it("el foco entra en la ventana al abrirse", () => {
    abrir()

    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true)
  })

  /*
    Y entra por el primer campo, no por la X: quien abre un formulario
    quiere escribir en él, no cerrarlo.
  */
  it("el foco entra por el primer campo, no por el botón de cerrar", () => {
    abrir()

    expect(document.activeElement).toBe(screen.getByLabelText("Código"))
  })

  /*
    Al cerrarse el foco vuelve al botón que la abrió; si no, quien navega
    con teclado aparece al principio de la página.
  */
  it("al cerrarse el foco vuelve a donde estaba", () => {
    const disparador = document.createElement("button")
    document.body.appendChild(disparador)
    disparador.focus()

    const { unmount } = abrir()
    unmount()

    expect(document.activeElement).toBe(disparador)

    disparador.remove()
  })

  it("sin acciones no dibuja el pie", () => {
    const { container } = abrir()

    expect(container.querySelector(".modal-foot")).toBeNull()
  })

  it("coloca las acciones que le pasan", () => {
    abrir({ acciones: <button>Guardar</button> })

    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument()
  })

  it("conserva la clase .modal, de la que dependen otras pruebas", () => {
    const { container } = abrir({ ancho: "modal-lg" })

    expect(container.querySelector(".modal")).toHaveClass("modal-lg")
  })
})
