import { describe, it, expect, afterEach } from "vitest"

import { bloquearDesplazamiento } from "./bloqueoDeDesplazamiento"

/*
  El fondo deja de desplazarse mientras haya algo encima: el cajón del menú
  (R-1) o una ventana modal (R-2). Pueden coincidir —una ventana abierta
  desde una página con el cajón recién cerrado, dos ventanas una sobre
  otra—, así que se cuentan: el fondo vuelve a desplazarse cuando se libera
  el último, no el primero.
*/

const bloqueado = () => document.body.classList.contains("sin-desplazamiento")

afterEach(() => {
  document.body.classList.remove("sin-desplazamiento")
})

describe("bloquearDesplazamiento", () => {
  it("bloquea el fondo y lo libera", () => {
    const liberar = bloquearDesplazamiento()
    expect(bloqueado()).toBe(true)

    liberar()
    expect(bloqueado()).toBe(false)
  })

  it("con dos bloqueos, liberar uno no suelta el fondo", () => {
    const menu = bloquearDesplazamiento()
    const ventana = bloquearDesplazamiento()

    menu()
    expect(bloqueado()).toBe(true)

    ventana()
    expect(bloqueado()).toBe(false)
  })

  it("liberar dos veces el mismo bloqueo no suelta el de otro", () => {
    const uno = bloquearDesplazamiento()
    const otro = bloquearDesplazamiento()

    uno()
    uno()
    expect(bloqueado()).toBe(true)

    otro()
    expect(bloqueado()).toBe(false)
  })
})
