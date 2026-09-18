import { describe, expect, it } from "vitest"

import { coincideBusqueda, normalizarTexto } from "./texto"

/*
  Buscar sin tildes.

  El caso que originó esto: escribir "camion" en Ubicaciones no encontraba
  "Camión 01", y en un mostrador eso se lee como que el dato no existe.
*/

describe("normalizarTexto", () => {
  it("quita las tildes", () => {
    expect(normalizarTexto("Camión")).toBe("camion")
  })

  it("baja a minúsculas", () => {
    expect(normalizarTexto("CAMIÓN")).toBe("camion")
  })

  it("deja igual un texto sin tildes", () => {
    expect(normalizarTexto("Bodega")).toBe("bodega")
  })

  it("cubre las cinco vocales acentuadas", () => {
    expect(normalizarTexto("áéíóú ÁÉÍÓÚ")).toBe("aeiou aeiou")
  })

  it("quita la diéresis", () => {
    expect(normalizarTexto("Güiro")).toBe("guiro")
  })

  /*
    La ñ es una letra, no una n con tilde. Quien escribe "cañon" no busca
    "canon", y confundirlas devolvería resultados que nadie pidió.
  */
  it("conserva la ñ", () => {
    expect(normalizarTexto("Cañón")).toBe("cañon")
  })

  it("conserva la Ñ en minúscula, no la convierte en n", () => {
    expect(normalizarTexto("ÑANDÚ")).toBe("ñandu")
  })

  it("no confunde cañon con canon", () => {
    expect(normalizarTexto("cañon")).not.toBe(normalizarTexto("canon"))
  })

  it("con nada devuelve cadena vacía", () => {
    expect(normalizarTexto(null)).toBe("")
    expect(normalizarTexto(undefined)).toBe("")
  })

  it("acepta números sin romperse", () => {
    expect(normalizarTexto(123)).toBe("123")
  })
})

describe("coincideBusqueda", () => {
  it("encuentra con tilde escribiendo sin tilde", () => {
    expect(coincideBusqueda("Camión 01", "camion")).toBe(true)
  })

  it("encuentra sin tilde escribiendo con tilde", () => {
    expect(coincideBusqueda("Camion 01", "camión")).toBe(true)
  })

  it("no distingue mayúsculas", () => {
    expect(coincideBusqueda("Camión 01", "CAMION")).toBe(true)
  })

  it("encuentra texto normal", () => {
    expect(coincideBusqueda("Bodega Principal", "bodega")).toBe(true)
  })

  it("coincide en medio del texto", () => {
    expect(coincideBusqueda("Lunacell Store", "cell")).toBe(true)
  })

  it("no inventa coincidencias", () => {
    expect(coincideBusqueda("Bodega Principal", "tienda")).toBe(false)
  })

  it("ignora los espacios de sobra alrededor", () => {
    expect(coincideBusqueda("Camión 01", "  camion  ")).toBe(true)
  })

  /*
    Una caja de búsqueda recién abierta no debe esconder nada.
  */
  it("un texto vacío coincide con todo", () => {
    expect(coincideBusqueda("cualquier cosa", "")).toBe(true)
  })

  it("contenido vacío solo coincide con búsqueda vacía", () => {
    expect(coincideBusqueda("", "")).toBe(true)
    expect(coincideBusqueda("", "algo")).toBe(false)
  })
})
