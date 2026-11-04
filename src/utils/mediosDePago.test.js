import { describe, it, expect } from "vitest"

import {
  MIXTO,
  cambiarModalidad,
  cobrosDelSelector,
  elegirMedio,
  escribirImporte,
  escribirReferencia,
  etiquetaDelMedio,
  faltaPorAsignar,
  importeCalculado,
  importeDe,
  limpiarImporte,
  problemaDeCobros,
  problemaDelSelector,
  selectorVacio,
  textoDeMedios,
} from "./mediosDePago"

const marcados = (...medios) => medios.reduce((v, m) => elegirMedio(v, m), selectorVacio(MIXTO))

const conImporte = (total, medio, monto) =>
  escribirImporte(marcados("efectivo", "tarjeta"), medio, monto, total).valor

describe("pago único", () => {
  const unico = (medio) => elegirMedio(selectorVacio(), medio)

  it("nace en pago único y sin medio elegido", () => {
    expect(selectorVacio().modalidad).toBe("unico")
    expect(selectorVacio().elegidos).toEqual([])
    expect(cobrosDelSelector(selectorVacio(), 100)).toEqual([])
  })

  it("lleva el total, redondeado a centavos", () => {
    expect(cobrosDelSelector(unico("efectivo"), 391.004)).toEqual([{ medio: "efectivo", monto: 391, referencia: "" }])
  })

  it("sigue al total aunque el total cambie después", () => {
    expect(cobrosDelSelector(unico("efectivo"), 500)[0].monto).toBe(500)
  })

  it("elegir otro reemplaza al anterior y suelta su referencia", () => {
    const valor = elegirMedio(escribirReferencia(unico("tarjeta"), "tarjeta", "AUT-1"), "enlace")

    expect(valor.elegidos).toEqual(["enlace"])
    expect(valor.referencias.tarjeta).toBe("")
  })

  it("la referencia es opcional: sin ella se confirma, y no se inventa una", () => {
    for (const medio of ["efectivo", "transferencia", "tarjeta", "enlace"]) {
      expect(problemaDelSelector(unico(medio), 100)).toBeNull()
      expect(cobrosDelSelector(unico(medio), 100)[0].referencia).toBe("")
    }
  })

  it("sin medio dice que falta elegirlo", () => {
    expect(problemaDelSelector(selectorVacio(), 100)).toMatch(/elige el medio/i)
  })
})

describe("pago mixto", () => {
  it("los importes nacen vacíos, y pide escribir uno", () => {
    const valor = marcados("efectivo", "tarjeta")

    expect(importeDe(valor, "efectivo", 391)).toBe("")
    expect(importeDe(valor, "tarjeta", 391)).toBe("")
    expect(problemaDelSelector(valor, 391)).toMatch(/el otro se calcula solo/i)
  })

  it("un tercer medio se rechaza, aunque la pantalla no lo hubiera impedido", () => {
    const dos = marcados("efectivo", "tarjeta")

    expect(elegirMedio(dos, "enlace")).toBe(dos)
  })

  it("con un importe, el otro se calcula", () => {
    const valor = escribirImporte(marcados("efectivo", "tarjeta"), "efectivo", "300", 391).valor

    expect(importeDe(valor, "tarjeta", 391)).toBe("91.00")
    expect(importeCalculado(valor, "tarjeta")).toBe(true)
    expect(importeCalculado(valor, "efectivo")).toBe(false)
    expect(cobrosDelSelector(valor, 391).map((c) => c.monto)).toEqual([300, 91])
  })

  it("el que se escribe manda: el otro pasa a calcularse", () => {
    let valor = escribirImporte(marcados("efectivo", "tarjeta"), "efectivo", "300", 391).valor

    valor = escribirImporte(valor, "tarjeta", "100", 391).valor

    expect(importeDe(valor, "efectivo", 391)).toBe("291.00")
    expect(importeCalculado(valor, "efectivo")).toBe(true)
  })

  it("el calculado sigue al total", () => {
    const valor = escribirImporte(marcados("efectivo", "tarjeta"), "efectivo", "100", 391).valor

    expect(importeDe(valor, "tarjeta", 500)).toBe("400.00")
    expect(importeDe(valor, "tarjeta", 150.25)).toBe("50.25")
  })

  it("cuenta en centavos: no deja residuo con decimales", () => {
    const valor = escribirImporte(marcados("efectivo", "tarjeta"), "efectivo", "0.10", 0.3).valor

    expect(importeDe(valor, "tarjeta", 0.3)).toBe("0.20")
    expect(faltaPorAsignar(cobrosDelSelector(valor, 0.3), 0.3)).toBe(0)
  })

  it("borrar el importe escrito deja los dos vacíos", () => {
    let valor = escribirImporte(marcados("efectivo", "tarjeta"), "efectivo", "100", 391).valor

    valor = escribirImporte(valor, "efectivo", "", 391).valor

    expect(valor.escrito).toBeNull()
    expect(importeDe(valor, "tarjeta", 391)).toBe("")
  })

  it("soltar el escrito borra su importe, y soltar el calculado conserva el escrito", () => {
    const base = escribirReferencia(escribirImporte(marcados("efectivo", "tarjeta"), "tarjeta", "91", 391).valor, "tarjeta", "AUT-1")
    const sinEscrito = elegirMedio(base, "tarjeta")

    expect(sinEscrito.elegidos).toEqual(["efectivo"])
    expect(sinEscrito.montos.tarjeta).toBe("")
    expect(sinEscrito.referencias.tarjeta).toBe("")
    expect(sinEscrito.escrito).toBeNull()

    const sinCalculado = elegirMedio(base, "efectivo")

    expect(sinCalculado.escrito).toBe("tarjeta")
    expect(importeDe(elegirMedio(sinCalculado, "enlace"), "enlace", 391)).toBe("300.00")
  })

  it("siempre en el mismo orden, sin importar cómo se marquen", () => {
    expect(marcados("enlace", "efectivo").elegidos).toEqual(["efectivo", "enlace"])
  })

  it.each([
    ["sin medios", () => selectorVacio(MIXTO), /elige 2 medios/i],
    ["con uno que lleva todo", () => escribirImporte(marcados("efectivo"), "efectivo", "100", 100).valor, /elige 2 medios/i],
    ["sin importes", () => marcados("efectivo", "tarjeta"), /se calcula solo/i],
    ["con el otro en cero", () => conImporte(100, "efectivo", "100"), /baja el otro importe/i],
    ["con el escrito en cero", () => conImporte(100, "efectivo", "0"), /baja el otro importe/i],
  ])("no se confirma %s", (_, valor, mensaje) => {
    expect(problemaDelSelector(valor(), 100)).toMatch(mensaje)
  })

  it("con un importe y sin referencias, se confirma", () => {
    const valor = conImporte(100, "efectivo", "40")

    expect(problemaDelSelector(valor, 100)).toBeNull()
    expect(cobrosDelSelector(valor, 100)).toEqual([
      { medio: "efectivo", monto: 40, referencia: "" },
      { medio: "tarjeta", monto: 60, referencia: "" },
    ])
  })

  it("con un importe y las referencias, se confirma", () => {
    const valor = escribirReferencia(conImporte(100, "efectivo", "40"), "tarjeta", "AUT-1")

    expect(problemaDelSelector(valor, 100)).toBeNull()
    expect(cobrosDelSelector(valor, 100)).toEqual([
      { medio: "efectivo", monto: 40, referencia: "" },
      { medio: "tarjeta", monto: 60, referencia: "AUT-1" },
    ])
  })
})

describe("cambiar de modalidad", () => {
  it("empieza de cero: nada de la otra modalidad queda guardado", () => {
    const antes = escribirReferencia(conImporte(100, "efectivo", "40"), "tarjeta", "AUT-1")

    expect(cambiarModalidad(antes, "unico")).toEqual(selectorVacio("unico"))
    expect(cambiarModalidad(elegirMedio(selectorVacio(), "tarjeta"), MIXTO)).toEqual(selectorVacio(MIXTO))
  })

  it("volver a pulsar la misma no borra nada", () => {
    const valor = marcados("efectivo")

    expect(cambiarModalidad(valor, MIXTO)).toBe(valor)
  })
})

describe("limpiarImporte", () => {
  it.each([
    ["100", "100"],
    ["100.5", "100.5"],
    ["100.", "100."],
    ["1,125.00", "1125.00"],
    ["12,50", "12.50"],
    ["1,125", "1125"],
    ["1,125,000.75", "1125000.75"],
    ["L 391.00", "391.00"],
    [".5", "0.5"],
    ["100.999", "100.99"],
    ["1.2.3", "1.23"],
    ["-50", "50"],
    ["abc", ""],
    ["", ""],
    [null, ""],
  ])("«%s» queda «%s»", (entrada, esperado) => {
    expect(limpiarImporte(entrada)).toBe(esperado)
  })
})

describe("escribirImporte", () => {
  it("el caso real: en una factura de 391 no se puede llegar a 1,125", () => {
    const resultado = escribirImporte(marcados("efectivo", "transferencia"), "efectivo", "1,125.00", 391)

    expect(resultado.ajustado).toBe(true)
    expect(resultado.valor.montos.efectivo).toBe("391.00")
    expect(faltaPorAsignar(cobrosDelSelector(resultado.valor, 391), 391)).toBe(0)
  })

  it("lo que cabe queda tal como se escribió, también a medias", () => {
    const resultado = escribirImporte(marcados("efectivo", "tarjeta"), "efectivo", "100.", 391)

    expect(resultado).toMatchObject({ ajustado: false })
    expect(resultado.valor.montos.efectivo).toBe("100.")
  })

  it("exactamente el total no es un ajuste", () => {
    expect(escribirImporte(marcados("efectivo", "tarjeta"), "tarjeta", "391", 391)).toMatchObject({ ajustado: false })
  })

  it("si el total bajó, el importe escrito no se cambia solo, y al editarlo se limita", () => {
    const valor = conImporte(391, "efectivo", "300")

    expect(faltaPorAsignar(cobrosDelSelector(valor, 200), 200)).toBe(-100)

    const resultado = escribirImporte(valor, "efectivo", "250", 200)

    expect(resultado.valor.montos.efectivo).toBe("200.00")
    expect(resultado.ajustado).toBe(true)
  })
})

describe("cobrosDelSelector", () => {
  it("un medio en cero no viaja", () => {
    const valor = conImporte(100, "efectivo", "100")

    expect(cobrosDelSelector(valor, 100)).toEqual([{ medio: "efectivo", monto: 100, referencia: "" }])
  })

  it("limpia la referencia", () => {
    const valor = escribirReferencia(elegirMedio(selectorVacio(), "tarjeta"), "tarjeta", "  AUT-1 ")

    expect(cobrosDelSelector(valor, 100)[0].referencia).toBe("AUT-1")
  })
})

describe("faltaPorAsignar", () => {
  it("compara en centavos, sin errores de decimales binarios", () => {
    expect(faltaPorAsignar([{ monto: 0.1 }, { monto: 0.2 }], 0.3)).toBe(0)
  })

  it("dice cuánto falta o cuánto sobra", () => {
    expect(faltaPorAsignar([{ monto: 90 }], 100)).toBe(10)
    expect(faltaPorAsignar([{ monto: 110 }], 100)).toBe(-10)
  })
})

describe("problemaDeCobros", () => {
  const efectivo = (monto) => ({ medio: "efectivo", monto, referencia: "" })

  it("sin problema devuelve null", () => {
    expect(problemaDeCobros([efectivo(15), { medio: "tarjeta", monto: 100, referencia: "A" }], 115)).toBeNull()
    expect(problemaDeCobros([efectivo(0.1), { medio: "enlace", monto: 0.2, referencia: "L" }], 0.3)).toBeNull()
  })

  it.each([
    ["sin medios", [], 10, /elige el medio/i],
    ["medio desconocido", [{ medio: "cheque", monto: 10, referencia: "" }], 10, /no es válido/i],
    ["importe en cero", [efectivo(0)], 0, /mayor que cero/i],
    ["importe negativo", [efectivo(-1)], 10, /mayor que cero/i],
    ["importe que no es número", [efectivo(Number.NaN)], 10, /mayor que cero/i],
    ["más de dos decimales", [efectivo(9.999)], 10, /dos decimales/i],
    ["referencia larga", [{ medio: "tarjeta", monto: 10, referencia: "x".repeat(121) }], 10, /demasiado larga/i],
    ["no suman", [efectivo(9)], 10, /deben sumar/i],
    ["más de dos medios", [efectivo(1), { medio: "tarjeta", monto: 1, referencia: "A" }, { medio: "enlace", monto: 1, referencia: "L" }], 3, /hasta 2 medios/i],
  ])("%s", (_, cobros, total, mensaje) => {
    expect(problemaDeCobros(cobros, total)).toMatch(mensaje)
  })
})

describe("cómo se escriben", () => {
  it("en palabras, y lo anterior como «Sin registrar»", () => {
    expect(etiquetaDelMedio("enlace")).toBe("Enlace de pago")
    expect(etiquetaDelMedio("sin_registrar")).toBe("Sin registrar")
  })

  it("el detalle con importe y referencia", () => {
    expect(textoDeMedios([{ medio: "efectivo", monto: 15, referencia: "" }, { medio: "tarjeta", monto: 100, referencia: "AUT-1" }]))
      .toBe("Efectivo 15.00, Tarjeta 100.00 (AUT-1)")
    expect(textoDeMedios(undefined)).toBe("")
  })
})
