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
  importeBloqueado,
  limpiarImporte,
  problemaDeCobros,
  problemaDelSelector,
  selectorVacio,
  textoDeMedios,
} from "./mediosDePago"

const marcados = (...medios) => medios.reduce((v, m) => elegirMedio(v, m), selectorVacio(MIXTO))

const conImportes = (total, montos) =>
  Object.entries(montos).reduce(
    (v, [medio, monto]) => escribirImporte(v, medio, monto, total).valor,
    marcados(...Object.keys(montos))
  )

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

  it("la referencia es obligatoria donde corresponde", () => {
    expect(problemaDelSelector(unico("tarjeta"), 100)).toMatch(/referencia de tarjeta/i)
    expect(problemaDelSelector(unico("efectivo"), 100)).toBeNull()
  })

  it("sin medio dice que falta elegirlo", () => {
    expect(problemaDelSelector(selectorVacio(), 100)).toMatch(/elige el medio/i)
  })
})

describe("pago mixto", () => {
  it("los importes nacen vacíos: se reparten a mano", () => {
    expect(marcados("efectivo", "tarjeta").montos).toMatchObject({ efectivo: "", tarjeta: "" })
  })

  it("un tercer medio se rechaza, aunque la pantalla no lo hubiera impedido", () => {
    const dos = marcados("efectivo", "tarjeta")

    expect(elegirMedio(dos, "enlace")).toBe(dos)
  })

  it("soltar uno borra su importe y referencia, y deja lugar para otro", () => {
    let valor = escribirReferencia(conImportes(391, { efectivo: "300", tarjeta: "91" }), "tarjeta", "AUT-1")

    valor = elegirMedio(valor, "tarjeta")

    expect(valor.elegidos).toEqual(["efectivo"])
    expect(valor.montos.tarjeta).toBe("")
    expect(valor.referencias.tarjeta).toBe("")
    expect(elegirMedio(valor, "enlace").elegidos).toEqual(["efectivo", "enlace"])
  })

  it("siempre en el mismo orden, sin importar cómo se marquen", () => {
    expect(marcados("enlace", "efectivo").elegidos).toEqual(["efectivo", "enlace"])
  })

  it("sin saldo, el medio sin importe queda bloqueado; bajar el otro lo libera", () => {
    const valor = conImportes(391, { efectivo: "391", tarjeta: "" })

    expect(importeBloqueado(valor, "tarjeta", 391)).toBe(true)
    expect(importeBloqueado(valor, "efectivo", 391)).toBe(false)
    expect(importeBloqueado(escribirImporte(valor, "efectivo", "300", 391).valor, "tarjeta", 391)).toBe(false)
  })

  it.each([
    ["sin medios", () => selectorVacio(MIXTO), /elige 2 medios/i],
    ["con uno que lleva todo", () => escribirImporte(marcados("efectivo"), "efectivo", "100", 100).valor, /elige 2 medios/i],
    ["uno sin importe y sin saldo", () => conImportes(100, { efectivo: "100", tarjeta: "" }), /baja el otro importe/i],
    ["uno sin importe y con saldo", () => conImportes(100, { efectivo: "40", tarjeta: "" }), /importe de tarjeta/i],
    ["uno en cero", () => conImportes(100, { efectivo: "40", tarjeta: "0" }), /importe de tarjeta/i],
    ["sin sumar el total", () => escribirReferencia(conImportes(100, { efectivo: "40", enlace: "50" }), "enlace", "L"), /deben sumar/i],
    ["sin referencia", () => conImportes(100, { efectivo: "40", tarjeta: "60" }), /referencia de tarjeta/i],
  ])("no se confirma %s", (_, valor, mensaje) => {
    expect(problemaDelSelector(valor(), 100)).toMatch(mensaje)
  })

  it("con los dos importes y las referencias, se confirma", () => {
    const valor = escribirReferencia(conImportes(100, { efectivo: "40", tarjeta: "60" }), "tarjeta", "AUT-1")

    expect(problemaDelSelector(valor, 100)).toBeNull()
    expect(cobrosDelSelector(valor, 100)).toEqual([
      { medio: "efectivo", monto: 40, referencia: "" },
      { medio: "tarjeta", monto: 60, referencia: "AUT-1" },
    ])
  })
})

describe("cambiar de modalidad", () => {
  it("empieza de cero: nada de la otra modalidad queda guardado", () => {
    const antes = escribirReferencia(conImportes(100, { efectivo: "40", tarjeta: "60" }), "tarjeta", "AUT-1")

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
    const valor = escribirImporte(marcados("efectivo", "transferencia"), "efectivo", "125", 391).valor
    const resultado = escribirImporte(valor, "transferencia", "1,000", 391)

    expect(resultado.ajustado).toBe(true)
    expect(resultado.valor.montos.transferencia).toBe("266.00")
    expect(faltaPorAsignar(cobrosDelSelector(resultado.valor, 391), 391)).toBe(0)
  })

  it("lo que cabe queda tal como se escribió, también a medias", () => {
    const resultado = escribirImporte(marcados("efectivo", "tarjeta"), "efectivo", "100.", 391)

    expect(resultado).toMatchObject({ ajustado: false })
    expect(resultado.valor.montos.efectivo).toBe("100.")
  })

  it("exactamente lo disponible no es un ajuste", () => {
    const valor = escribirImporte(marcados("efectivo", "tarjeta"), "efectivo", "300", 391).valor

    expect(escribirImporte(valor, "tarjeta", "91", 391)).toMatchObject({ ajustado: false })
  })

  it("borrar un importe libera su saldo", () => {
    const valor = escribirImporte(conImportes(391, { efectivo: "300", tarjeta: "91" }), "tarjeta", "", 391).valor

    expect(faltaPorAsignar(cobrosDelSelector(valor, 391), 391)).toBe(91)
    expect(cobrosDelSelector(valor, 391).map((c) => c.medio)).toEqual(["efectivo"])
  })

  it("cuenta en centavos: 0.10 + 0.20 de 0.30 no deja residuo", () => {
    const valor = conImportes(0.3, { efectivo: "0.10", tarjeta: "0.20" })

    expect(faltaPorAsignar(cobrosDelSelector(valor, 0.3), 0.3)).toBe(0)
    expect(cobrosDelSelector(valor, 0.3).map((c) => c.monto)).toEqual([0.1, 0.2])
  })

  it("si el total bajó, un importe ya escrito no se cambia solo, y al editarlo se limita", () => {
    const valor = conImportes(391, { efectivo: "300", tarjeta: "91" })

    expect(faltaPorAsignar(cobrosDelSelector(valor, 200), 200)).toBe(-191)

    const resultado = escribirImporte(valor, "efectivo", "150", 200)

    expect(resultado.valor.montos.efectivo).toBe("109.00")
    expect(resultado.ajustado).toBe(true)
  })
})

describe("cobrosDelSelector", () => {
  it("un medio marcado sin importe o en cero no viaja", () => {
    const valor = conImportes(100, { efectivo: "100", tarjeta: "0" })

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
    ["sin referencia", [{ medio: "tarjeta", monto: 10, referencia: "" }], 10, /referencia de tarjeta/i],
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
