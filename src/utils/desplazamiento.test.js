import { describe, it, expect } from "vitest"

import { mostrarDentroDeLista } from "./desplazamiento"

// Una lista de 200 px de alto con filas de 50 px.
const lista = (scrollTop = 0) => ({ scrollTop, clientHeight: 200 })
const fila = (indice) => ({ offsetTop: indice * 50, offsetHeight: 50 })

describe("mostrarDentroDeLista", () => {
  it("no mueve nada si la fila ya se ve", () => {
    const l = lista(0)

    mostrarDentroDeLista(l, fila(2))
    expect(l.scrollTop).toBe(0)
  })

  it("baja lo justo para mostrar una fila que quedó debajo", () => {
    const l = lista(0)

    mostrarDentroDeLista(l, fila(5))
    expect(l.scrollTop).toBe(100)
  })

  it("sube lo justo para mostrar una fila que quedó arriba", () => {
    const l = lista(150)

    mostrarDentroDeLista(l, fila(1))
    expect(l.scrollTop).toBe(50)
  })

  it("sin lista o sin fila no hace nada", () => {
    expect(() => mostrarDentroDeLista(null, fila(1))).not.toThrow()
    expect(() => mostrarDentroDeLista(lista(), null)).not.toThrow()
  })
})
