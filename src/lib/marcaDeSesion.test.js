import { describe, it, expect, beforeEach } from "vitest"

import {
  marcarSesionAbierta,
  borrarMarcaDeSesion,
  hayMarcaDeSesion,
} from "./marcaDeSesion"

beforeEach(() => {
  borrarMarcaDeSesion()
})

describe("marca de sesión", () => {
  it("no hay marca antes de entrar", () => {
    expect(hayMarcaDeSesion()).toBe(false)
  })

  it("queda marcada al abrir sesión", () => {
    marcarSesionAbierta()

    expect(hayMarcaDeSesion()).toBe(true)
  })

  it("se borra al cerrar sesión", () => {
    marcarSesionAbierta()
    borrarMarcaDeSesion()

    expect(hayMarcaDeSesion()).toBe(false)
  })

  it("no guarda el token ni ningún dato de la cuenta", () => {
    marcarSesionAbierta()

    expect(document.cookie).toBe("ferreteria-sesion=1")
  })

  it("marcar dos veces no duplica la cookie", () => {
    marcarSesionAbierta()
    marcarSesionAbierta()

    const marcas = document.cookie
      .split(";")
      .filter((t) => t.trim().startsWith("ferreteria-sesion="))

    expect(marcas).toHaveLength(1)
  })
})
