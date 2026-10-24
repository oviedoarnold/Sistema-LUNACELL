import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, within } from "@testing-library/react"

import ModalShell from "./ModalShell"
import DocumentPreviewModal from "../documents/DocumentPreviewModal"
import ModalDeCliente from "../documents/ModalDeCliente"

/*
  R-2: las ventanas caben en la pantalla del teléfono.

  El aspecto lo pone el CSS (modals.css) y eso no se mide en jsdom. Lo que
  se protege aquí es lo que el CSS necesita para funcionar:
  - cabecera, cuerpo y pie son hermanos: el pie no está dentro del cuerpo
    que se desplaza, así que los botones quedan siempre a la vista;
  - el contenido largo va en el cuerpo, que es lo que se desplaza;
  - mientras la ventana está abierta, el fondo no se desplaza;
  - con el teclado del teléfono abierto, la ventana usa el alto que de
    verdad queda visible (visualViewport) y no el de la pantalla entera.
*/

const bloqueado = () => document.body.classList.contains("sin-desplazamiento")
const raiz = () => document.documentElement.style

/* visualViewport simulado: jsdom no lo trae. */
function simularVistaVisible({ height = 740, offsetTop = 0 } = {}) {
  const oyentes = new Set()
  const vista = {
    height,
    offsetTop,
    addEventListener: (tipo, fn) => tipo === "resize" && oyentes.add(fn),
    removeEventListener: (tipo, fn) => oyentes.delete(fn),
  }
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vista })

  return {
    teclado(alto, arriba = 0) {
      vista.height = alto
      vista.offsetTop = arriba
      act(() => oyentes.forEach((fn) => fn()))
    },
    oyentes,
  }
}

const LARGO = Array.from({ length: 60 }, (_, i) => <p key={i}>Renglón {i + 1}</p>)

beforeEach(() => {
  simularVistaVisible()
})

afterEach(() => {
  delete window.visualViewport
  document.body.classList.remove("sin-desplazamiento")
  raiz().removeProperty("--vista-alto")
  raiz().removeProperty("--vista-arriba")
})

const piezas = () => {
  const dialogo = screen.getByRole("dialog")
  const hijos = [...dialogo.children].map((e) => e.className.split(" ")[0])
  return { dialogo, hijos }
}

describe("ModalShell", () => {
  const ventana = (props = {}) => (
    <ModalShell
      titulo="Nuevo producto"
      onCerrar={() => {}}
      acciones={
        <>
          <button type="button">Cancelar</button>
          <button type="button">Guardar</button>
        </>
      }
      {...props}
    >
      {props.children ?? <input aria-label="Nombre" />}
    </ModalShell>
  )

  it("una ventana pequeña: cabecera, cuerpo y pie como hermanos", () => {
    render(ventana())

    expect(piezas().hijos).toEqual(["modal-head", "modal-body", "modal-foot"])
  })

  it("con contenido extenso, el contenido va en el cuerpo y los botones quedan fuera de él", () => {
    render(ventana({ children: LARGO }))

    const cuerpo = document.querySelector(".modal-body")
    expect(cuerpo).toContainElement(screen.getByText("Renglón 60"))
    expect(cuerpo).not.toContainElement(screen.getByRole("button", { name: "Guardar" }))
    expect(document.querySelector(".modal-foot")).toContainElement(screen.getByRole("button", { name: "Guardar" }))
  })

  it("los botones siguen funcionando y Escape y la X cierran", () => {
    const onCerrar = vi.fn()
    const guardar = vi.fn()
    render(
      ventana({
        onCerrar,
        acciones: (
          <button type="button" onClick={guardar}>
            Guardar
          </button>
        ),
      })
    )

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    expect(guardar).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onCerrar).toHaveBeenCalledTimes(2)
  })

  it("mientras está abierta, el fondo no se desplaza; al cerrarla vuelve a desplazarse", () => {
    const { unmount } = render(ventana())

    expect(bloqueado()).toBe(true)
    unmount()
    expect(bloqueado()).toBe(false)
  })

  it("con el teclado del teléfono abierto, usa el alto que queda visible", () => {
    const vista = simularVistaVisible({ height: 740 })
    const { unmount } = render(ventana())
    expect(raiz().getPropertyValue("--vista-alto")).toBe("740px")

    vista.teclado(420, 30)
    expect(raiz().getPropertyValue("--vista-alto")).toBe("420px")
    expect(raiz().getPropertyValue("--vista-arriba")).toBe("30px")

    unmount()
    expect(raiz().getPropertyValue("--vista-alto")).toBe("")
    expect(vista.oyentes.size).toBe(0)
  })

  it("sin visualViewport (navegadores viejos) se abre igual, con el alto de la pantalla del CSS", () => {
    delete window.visualViewport

    render(ventana())

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(raiz().getPropertyValue("--vista-alto")).toBe("")
  })

  it("el foco sigue entrando por el primer campo y el Tab recorre la ventana", () => {
    render(ventana())

    expect(screen.getByLabelText("Nombre")).toHaveFocus()
    expect(screen.getByRole("button", { name: "Guardar" })).not.toHaveAttribute("tabindex", "-1")
  })
})

describe("vista previa de documentos", () => {
  it("cabecera, cuerpo y pie como hermanos, con sus botones en el pie", () => {
    render(
      <DocumentPreviewModal open title="Factura" onClose={() => {}} onConfirm={() => {}}>
        {LARGO}
      </DocumentPreviewModal>
    )

    expect(piezas().hijos).toEqual(["modal-head", "modal-body", "modal-foot"])
    const pie = document.querySelector(".modal-foot")
    for (const nombre of [/confirmar/i, /descargar pdf/i, /imprimir/i, /^cerrar$/i]) {
      expect(within(pie).getByRole("button", { name: nombre })).toBeInTheDocument()
    }
    expect(document.querySelector(".modal-body")).toContainElement(screen.getByText("Renglón 60"))
  })

  it("bloquea el fondo mientras está abierta", () => {
    const { unmount } = render(
      <DocumentPreviewModal open title="Factura" onClose={() => {}}>
        <p>documento</p>
      </DocumentPreviewModal>
    )

    expect(bloqueado()).toBe(true)
    unmount()
    expect(bloqueado()).toBe(false)
  })

  it("cerrada no bloquea nada", () => {
    render(
      <DocumentPreviewModal open={false} title="Factura" onClose={() => {}}>
        <p>documento</p>
      </DocumentPreviewModal>
    )

    expect(bloqueado()).toBe(false)
  })
})

describe("ventana de cliente", () => {
  const props = {
    prefijo: "cliente",
    formulario: { name: "", rtn: "", phone: "", address: "", email: "" },
    onCambiar: () => {},
    onGuardar: () => {},
    onCerrar: () => {},
  }

  it("abierta bloquea el fondo; cerrada no", () => {
    const { rerender } = render(<ModalDeCliente abierto {...props} />)
    expect(bloqueado()).toBe(true)

    rerender(<ModalDeCliente abierto={false} {...props} />)
    expect(bloqueado()).toBe(false)
  })
})

describe("escritorio", () => {
  it("una ventana abierta en escritorio conserva el mismo marcado de siempre", () => {
    render(
      <ModalShell titulo="Nuevo producto" onCerrar={() => {}} ancho="modal-wide">
        <p>contenido</p>
      </ModalShell>
    )

    expect(screen.getByRole("dialog")).toHaveClass("modal", "modal-wide")
    expect(piezas().hijos).toEqual(["modal-head", "modal-body"])
  })
})
