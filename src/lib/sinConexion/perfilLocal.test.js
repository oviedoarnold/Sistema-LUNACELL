// @vitest-environment node
import { describe, it, expect } from "vitest"

import { nuevoNavegador } from "./pruebas/ayudas"
import { guardarPerfilLocal, leerPerfilLocal, borrarPerfilLocal, VIGENCIA_DEL_PERFIL_HORAS } from "./perfilLocal"

const PERFIL = {
  id: "u-1",
  empresa_id: "empresa-1",
  nombre: "Vendedor Camión",
  nombre_usuario: "camion01",
  rol: "vendedor",
  ubicacion_id: "camion-01",
  authId: "auth-vendedor",
  permissions: ["pos", "sales-history"],
  email: "no-se-guarda@lunacell.test",
  debeCambiar: false,
}

const reloj = (iso) => () => new Date(iso)

describe("perfil para entrar sin conexión", () => {
  it("guarda solo lo necesario para facturar y lo devuelve marcado como sin conexión", async () => {
    const almacen = await nuevoNavegador().abrir()
    await guardarPerfilLocal(almacen, PERFIL, { ahora: reloj("2026-10-10T12:00:00Z") })

    const perfil = await leerPerfilLocal(almacen, "auth-vendedor", { ahora: reloj("2026-10-10T18:00:00Z") })

    expect(perfil).toMatchObject({
      id: "u-1",
      empresa_id: "empresa-1",
      name: "Vendedor Camión",
      role: "vendedor",
      locationId: "camion-01",
      authId: "auth-vendedor",
      permissions: ["pos", "sales-history"],
      sinConexion: true,
    })
    expect(JSON.stringify(perfil)).not.toContain("no-se-guarda")
  })

  it("no sirve para otro usuario", async () => {
    const almacen = await nuevoNavegador().abrir()
    await guardarPerfilLocal(almacen, PERFIL, { ahora: reloj("2026-10-10T12:00:00Z") })

    expect(await leerPerfilLocal(almacen, "auth-otro", { ahora: reloj("2026-10-10T12:01:00Z") })).toBeNull()
  })

  it(`vence a las ${VIGENCIA_DEL_PERFIL_HORAS} horas de la última vez que se confirmó con el servidor`, async () => {
    const almacen = await nuevoNavegador().abrir()
    await guardarPerfilLocal(almacen, PERFIL, { ahora: reloj("2026-10-10T12:00:00Z") })

    expect(await leerPerfilLocal(almacen, "auth-vendedor", { ahora: reloj("2026-10-17T11:59:00Z") })).not.toBeNull()
    expect(await leerPerfilLocal(almacen, "auth-vendedor", { ahora: reloj("2026-10-17T12:01:00Z") })).toBeNull()
  })

  it("no guarda a quien debe cambiar su contraseña temporal", async () => {
    const almacen = await nuevoNavegador().abrir()
    await guardarPerfilLocal(almacen, { ...PERFIL, debeCambiar: true }, { ahora: reloj("2026-10-10T12:00:00Z") })

    expect(await leerPerfilLocal(almacen, "auth-vendedor", { ahora: reloj("2026-10-10T12:01:00Z") })).toBeNull()
  })

  it("al cerrar sesión se borra", async () => {
    const almacen = await nuevoNavegador().abrir()
    await guardarPerfilLocal(almacen, PERFIL, { ahora: reloj("2026-10-10T12:00:00Z") })
    await borrarPerfilLocal(almacen)

    expect(await leerPerfilLocal(almacen, "auth-vendedor", { ahora: reloj("2026-10-10T12:01:00Z") })).toBeNull()
  })
})
