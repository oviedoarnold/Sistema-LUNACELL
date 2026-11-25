import { describe, it, expect } from "vitest"

import { bloqueoDeRegalias, etiquetaDelMotivo, motivoParaLeer, problemaDelMotivo } from "./regalias"

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
