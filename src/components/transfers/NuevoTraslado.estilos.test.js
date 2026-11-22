import { readFileSync } from "node:fs"
import path from "node:path"
import { cwd } from "node:process"
import { describe, it, expect } from "vitest"

// Vitest no procesa CSS: se lee el archivo tal cual, sin retornos de carro.
const estilos = readFileSync(path.resolve(cwd(), "src/styles/transfers.css"), "utf8").replaceAll("\r", "")

/*
  Lo que jsdom no puede medir —alturas y desplazamientos— se protege
  mirando las reglas de transfers.css.

  Regresión: .search-box es global (flex: 1 1 260px; .crud lo deja en
  240px). Dentro de la tarjeta en columna del formulario esa base se
  volvía altura y dejaba un hueco enorme bajo el buscador, con la lupa
  flotando. La regla propia del buscador tiene que neutralizarlo.
*/
const regla = (selector) => {
  const inicio = estilos.indexOf(`${selector} {`)

  if (inicio === -1) return ""

  return estilos.slice(inicio, estilos.indexOf("}", inicio))
}

describe("estilos del formulario Nuevo traslado", () => {
  it("el buscador no crece en altura dentro de su tarjeta y ocupa todo el ancho", () => {
    const buscador = regla(".transfers .traslado-tarjeta .traslado-buscador")

    expect(buscador).toContain("flex: 0 0 auto;")
    expect(buscador).toContain("width: 100%;")
    expect(buscador).toContain("max-width: none;")
  })

  it("ninguna otra regla del formulario vuelve a darle al buscador una base flexible", () => {
    const sinComentarios = estilos.replaceAll(/\/\*[\s\S]*?\*\//g, "")
    const reglasDelBuscador = sinComentarios.split("}").filter((bloque) => bloque.includes("traslado-buscador"))

    expect(reglasDelBuscador.length).toBeGreaterThan(0)

    for (const bloque of reglasDelBuscador) {
      expect(bloque).not.toMatch(/flex:\s*1/)
      expect(bloque).not.toMatch(/height:\s*\d{3}/)
    }
  })

  it("las listas son la referencia de sus filas, para desplazar solo la lista", () => {
    const listas = regla(".transfers .traslado-catalogo,\n.transfers .traslado-carrito").replaceAll("\r", "")

    expect(listas).toContain("position: relative;")
    expect(listas).toContain("overflow-y: auto;")
  })

  it("dos columnas en escritorio y una sola por debajo de 900 px", () => {
    expect(regla(".transfers .traslado-formulario")).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);")
    expect(estilos.replaceAll("\r", "")).toMatch(/@media \(max-width: 900px\) \{\s*\.transfers \.traslado-formulario \{\s*grid-template-columns: 1fr;/)
  })
})
