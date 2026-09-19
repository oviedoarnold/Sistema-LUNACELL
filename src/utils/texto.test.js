import { describe, expect, it } from "vitest"

import { coincideBusqueda, normalizarTexto } from "./texto"

/*
  Estos dos se construyen en ejecucion a proposito: escritos en el fuente
  serian caracteres invisibles, y un fuente con caracteres invisibles es
  un fuente que nadie puede revisar mirandolo.
*/
// La tilde combinante que NFD deja detras de la n.
const TILDE = String.fromCharCode(0x303)

// Un caracter de control cualquiera, para el caso del centinela.
const CONTROL = String.fromCharCode(1)

/*
  Buscar sin tildes.

  El caso que originó esto: escribir "camion" en Ubicaciones no encontraba
  "Camión 01", y en un mostrador eso se lee como que el dato no existe.

  Los casos van en tabla porque todos comprueban lo mismo con distinta
  entrada; escribirlos uno a uno repetía el mismo bloque veinte veces.
*/

describe("normalizarTexto", () => {
  it.each([
    ["quita las tildes", "Camión", "camion"],
    ["baja a minúsculas", "CAMIÓN", "camion"],
    ["deja igual lo que no lleva tilde", "Bodega", "bodega"],
    ["cubre las cinco vocales", "áéíóú ÁÉÍÓÚ", "aeiou aeiou"],
    ["quita la diéresis", "Güiro", "guiro"],
    ["acepta números", 123, "123"],
    ["con nulo devuelve vacío", null, ""],
    ["sin valor devuelve vacío", undefined, ""],
  ])("%s", (_, entrada, esperado) => {
    expect(normalizarTexto(entrada)).toBe(esperado)
  })

  /*
    La ñ es una letra, no una n con tilde. Y da igual cómo venga escrita
    en origen: como un solo carácter o como una n seguida de la tilde
    combinante, que es lo que produce NFD.
  */
  it.each([
    ["Cañón en un solo carácter", "Cañón", "cañon"],
    ["Ñ mayúscula", "ÑANDÚ", "ñandu"],
    ["n + tilde combinante", "can" + TILDE + "on", "cañon"],
    ["N + tilde combinante", "CAN" + TILDE + "ON", "cañon"],
  ])("conserva la ñ: %s", (_, entrada, esperado) => {
    expect(normalizarTexto(entrada)).toBe(esperado)
  })

  it("no confunde cañon con canon", () => {
    expect(normalizarTexto("cañon")).not.toBe(normalizarTexto("canon"))
  })

  /*
    Sin carácter centinela: el primer intento marcaba la
    ñ con un carácter de control, y eso convertía en ñ cualquier
    aparición de ese carácter en la entrada.
  */
  it("no trata caracteres de control como letras", () => {
    expect(normalizarTexto("ca" + CONTROL + "on")).not.toBe("cañon")
  })
})

describe("coincideBusqueda", () => {
  it.each([
    ["con tilde buscando sin tilde", "Camión 01", "camion", true],
    ["sin tilde buscando con tilde", "Camion 01", "camión", true],
    ["ignora mayúsculas", "Camión 01", "CAMION", true],
    ["texto normal", "Bodega Principal", "bodega", true],
    ["coincide en medio", "Lunacell Store", "cell", true],
    ["ignora espacios de sobra", "Camión 01", "  camion  ", true],
    ["no inventa coincidencias", "Bodega Principal", "tienda", false],
    ["la ñ no casa con n", "Canon", "cañon", false],
  ])("%s", (_, contenido, buscado, esperado) => {
    expect(coincideBusqueda(contenido, buscado)).toBe(esperado)
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
