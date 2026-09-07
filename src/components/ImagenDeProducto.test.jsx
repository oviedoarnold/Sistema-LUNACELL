import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import {
  MiniaturaDeProducto,
  SelectorDeImagen,
} from "./ImagenDeProducto"

const archivo = ({ type = "image/jpeg", size = 1024, name = "foto.jpg" } = {}) =>
  new File(["x".repeat(size)], name, { type })

describe("MiniaturaDeProducto", () => {
  it("muestra la foto cuando el producto tiene una", () => {
    render(<MiniaturaDeProducto url="https://ejemplo.test/m.png" nombre="Martillo" />)

    const imagen = screen.getByAltText("Martillo")

    expect(imagen).toHaveAttribute("src", "https://ejemplo.test/m.png")
  })

  /*
    Un catálogo con recuadros en blanco se lee peor que uno donde cada
    renglón tiene algo, así que sin foto se muestra la inicial.
  */
  it("sin foto muestra la inicial del producto", () => {
    render(<MiniaturaDeProducto nombre="Cemento gris" />)

    expect(screen.getByText("C")).toBeInTheDocument()
  })

  it("cae en la inicial si la foto no se puede cargar", () => {
    render(<MiniaturaDeProducto url="https://ejemplo.test/rota.png" nombre="Brocha" />)

    fireEvent.error(screen.getByAltText("Brocha"))

    expect(screen.getByText("B")).toBeInTheDocument()
    expect(screen.queryByAltText("Brocha")).not.toBeInTheDocument()
  })

  it("no revienta si el producto no tiene nombre", () => {
    render(<MiniaturaDeProducto />)

    expect(screen.getByText("?")).toBeInTheDocument()
  })

  it("respeta el tamaño que se le pide", () => {
    render(<MiniaturaDeProducto nombre="Taladro" tamano={92} />)

    expect(screen.getByText("T")).toHaveStyle({ width: "92px", height: "92px" })
  })
})

describe("SelectorDeImagen", () => {
  const montar = (props = {}) => {
    const onElegir = vi.fn()
    const onQuitar = vi.fn()

    render(
      <SelectorDeImagen
        nombre="Martillo"
        onElegir={onElegir}
        onQuitar={onQuitar}
        {...props}
      />
    )

    return { onElegir, onQuitar }
  }

  const elegirArchivo = (archivoElegido) =>
    fireEvent.change(document.querySelector("#products-imagen"), {
      target: { files: [archivoElegido] },
    })

  it("ofrece subir cuando el producto no tiene foto", () => {
    montar()

    expect(screen.getByRole("button", { name: /subir imagen/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /quitar/i })).not.toBeInTheDocument()
  })

  it("ofrece cambiarla y quitarla cuando ya tiene una", () => {
    montar({ urlGuardada: "https://ejemplo.test/m.png" })

    expect(screen.getByRole("button", { name: /cambiar imagen/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /quitar/i })).toBeInTheDocument()
  })

  it("avisa qué formatos y qué tamaño admite", () => {
    montar()

    expect(screen.getByText(/JPG, PNG o WebP · máximo 2 MB/i)).toBeInTheDocument()
  })

  it("entrega el archivo elegido cuando es válido", () => {
    const { onElegir } = montar()

    const elegido = archivo()

    elegirArchivo(elegido)

    expect(onElegir).toHaveBeenCalledWith(elegido)
  })

  it("rechaza un archivo que no es imagen y explica por qué", () => {
    const { onElegir } = montar()

    elegirArchivo(archivo({ type: "application/pdf", name: "manual.pdf" }))

    expect(screen.getByText(/JPG, PNG o WebP\./i)).toBeInTheDocument()
    expect(onElegir).toHaveBeenCalledWith(null)
  })

  it("rechaza una imagen que pasa el límite de tamaño", () => {
    const { onElegir } = montar()

    elegirArchivo(archivo({ size: 3 * 1024 * 1024 }))

    expect(screen.getByText(/máximo es 2 MB/i)).toBeInTheDocument()
    expect(onElegir).toHaveBeenCalledWith(null)
  })

  it("avisa al quitar la foto", () => {
    const { onQuitar } = montar({ urlGuardada: "https://ejemplo.test/m.png" })

    fireEvent.click(screen.getByRole("button", { name: /quitar/i }))

    expect(onQuitar).toHaveBeenCalled()
  })
})
