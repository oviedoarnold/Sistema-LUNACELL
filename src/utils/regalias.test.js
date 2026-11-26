import { describe, it, expect } from "vitest"

import { bloqueoDeRegalias, etiquetaDelMotivo, motivoParaLeer, problemaDelMotivo, resumenDeRegalias } from "./regalias"

describe("resumenDeRegalias", () => {
  const fila = (cantidad, valorComercial) => ({ cantidad, valorComercial })

  it("cuenta regalías y unidades, y suma el valor en centavos", () => {
    expect(resumenDeRegalias([fila(1, 0.1), fila(2, 0.2), fila(4, 600)])).toEqual({ regalias: 3, unidades: 7, sinPrecio: 0, valorComercial: 600.3 })
  })

  it("las que no tienen precio cuentan en regalías y unidades, no en el valor", () => {
    expect(resumenDeRegalias([fila(1, 150), fila(2, null), fila(3, undefined)])).toEqual({ regalias: 3, unidades: 6, sinPrecio: 2, valorComercial: 150 })
  })

  it("si ninguna tiene precio el valor es null; un precio en cero da 0", () => {
    expect(resumenDeRegalias([fila(1, null)]).valorComercial).toBeNull()
    expect(resumenDeRegalias([fila(1, 0)]).valorComercial).toBe(0)
    expect(resumenDeRegalias([])).toEqual({ regalias: 0, unidades: 0, sinPrecio: 0, valorComercial: null })
  })
})

const LISTA = { sinConexion: false, esPedido: false, clienteRegistrado: true, ventaFiscal: false }

describe("bloqueoDeRegalias", () => {
  it("con conexión, cliente registrado y documento interno no bloquea", () => {
    expect(bloqueoDeRegalias(LISTA)).toBeNull()
  })

  it.each([
    [{ esPedido: true }, /pedidos para otra ubicación/],
    [{ sinConexion: true }, /necesitan conexión/],
    [{ ventaFiscal: true }, /facturas fiscales/],
    [{ clienteRegistrado: false }, /cliente registrado/],
  ])("%o lo impide y dice por qué", (cambio, motivo) => {
    expect(bloqueoDeRegalias({ ...LISTA, ...cambio })).toMatch(motivo)
  })

  it("sin conexión pesa más que la falta de cliente: es lo primero que resolver", () => {
    expect(bloqueoDeRegalias({ ...LISTA, sinConexion: true, clienteRegistrado: false })).toMatch(/conexión/)
  })
})

describe("el motivo", () => {
  it("exige uno de la lista y, con «Otro», una descripción", () => {
    expect(problemaDelMotivo("", "")).toBe("Elige el motivo de la regalía.")
    expect(problemaDelMotivo("inventado", "")).toBe("Elige el motivo de la regalía.")
    expect(problemaDelMotivo("otro", "  ab ")).toMatch(/al menos 5 caracteres/)
    expect(problemaDelMotivo("otro", "Aniversario")).toBeNull()
    expect(problemaDelMotivo("cliente_frecuente", "")).toBeNull()
  })

  it("se lee con su etiqueta, y «Otro» con lo que se escribió", () => {
    expect(etiquetaDelMotivo("compra_volumen")).toBe("Compra por volumen")
    expect(motivoParaLeer("otro", " Aniversario ")).toBe("Otro: Aniversario")
    expect(motivoParaLeer("promocion_autorizada", "ignorado")).toBe("Promoción autorizada")
  })
})
