import { describe, it, expect, vi } from "vitest"

import { eliminarCotizacion } from "./cotizaciones"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const montar = ({ tablas = {}, fallarEn = {} } = {}) => {
  const falso = crearSupabaseFalso({ tablas: { cotizaciones: [], ...tablas }, fallarEn })

  globalThis.__supabaseFalso = falso

  return falso
}

describe("eliminarCotizacion", () => {
  it("borra la cotización indicada", async () => {
    const falso = montar({ tablas: { cotizaciones: [{ id: "q1" }] } })

    await eliminarCotizacion("q1")

    expect(falso.datos.cotizaciones).toHaveLength(0)
  })

  /*
    Solo su autor o un administrador la borra (0025). A cualquier otro la
    base no le alcanza ninguna fila y responde sin error: la pantalla no
    puede decir que la eliminó.
  */
  it("avisa que no tiene permiso si no se borró ninguna", async () => {
    const falso = montar({ tablas: { cotizaciones: [{ id: "q1" }] } })

    await expect(eliminarCotizacion("ajena")).rejects.toThrow(
      "No tienes permiso para eliminar la cotización."
    )
    expect(falso.datos.cotizaciones).toHaveLength(1)
  })

  it("dice que no tiene permiso si la base lo rechaza por permiso", async () => {
    montar({ fallarEn: { cotizaciones: { delete: { code: "42501", message: "permission denied" } } } })

    await expect(eliminarCotizacion("q1")).rejects.toThrow(
      "No tienes permiso para eliminar la cotización."
    )
  })

  it("no confunde otro fallo con falta de permiso", async () => {
    montar({ fallarEn: { cotizaciones: { delete: { message: "red caída" } } } })

    await expect(eliminarCotizacion("q1")).rejects.toThrow("No se pudo eliminar la cotización.")
  })
})
