/*
  OFF-1.4: la tienda no vende sin conexión hasta una autorización explícita.

  La protección no depende del nombre de la ubicación ni de emite_fiscal
  (que no se toca hasta la revisión fiscal):
  - solo los camiones y las bodegas pueden tener vende_sin_conexion;
  - la aplicación (authenticated), ni siquiera un administrador, puede
    sacar a una ubicación del tipo «tienda»: sería la forma de esquivar la
    regla anterior.
  Habilitar la tienda exige una migración nueva, revisada y aplicada con
  el procedimiento de migraciones: esa es la autorización explícita.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo } from "./arnes.mjs"
import { escenarioSinConexion, fallo } from "./escenario-sin-conexion.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

const habilitar = (conexion, id) => conexion.query("update ubicaciones set vende_sin_conexion = true where id = $1", [id])
const marca = async (id) => (await db.query("select vende_sin_conexion, tipo from ubicaciones where id = $1", [id])).rows[0]

describe("la tienda no vende sin conexión", () => {
  it("1. ni el administrador desde la aplicación puede habilitarla", async () => {
    const esc = await escenarioSinConexion(db)

    const error = await fallo(
      consultarComo(db, esc.admin.authId, "update ubicaciones set vende_sin_conexion = true where id = $1", [esc.tienda])
    )

    expect(error.code).toBe("23514")
    expect((await marca(esc.tienda)).vende_sin_conexion).toBe(false)
  })

  it("2. tampoco desde el SQL Editor (dueño de la base)", async () => {
    const esc = await escenarioSinConexion(db)

    const error = await fallo(habilitar(db, esc.tienda))

    expect(error.code).toBe("23514")
  })

  it("3. los camiones y las bodegas sí se pueden habilitar", async () => {
    const esc = await escenarioSinConexion(db)
    const bodega = (
      await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Bodega', 'bodega') returning id", [esc.empresa])
    ).rows[0].id

    await consultarComo(db, esc.admin.authId, "update ubicaciones set vende_sin_conexion = true where id = $1", [esc.camion2])
    await consultarComo(db, esc.admin.authId, "update ubicaciones set vende_sin_conexion = true where id = $1", [bodega])

    expect((await marca(esc.camion2)).vende_sin_conexion).toBe(true)
    expect((await marca(bodega)).vende_sin_conexion).toBe(true)
  })

  it("4. un camión habilitado no puede pasar a ser tienda", async () => {
    const esc = await escenarioSinConexion(db)

    const error = await fallo(db.query("update ubicaciones set tipo = 'tienda' where id = $1", [esc.camion1]))

    expect(error.code).toBe("23514")
  })
})

describe("el tipo «tienda» no se cambia desde la aplicación", () => {
  it("5. el administrador no puede convertir la tienda en bodega (sería esquivar la regla)", async () => {
    const esc = await escenarioSinConexion(db)

    const error = await fallo(
      consultarComo(db, esc.admin.authId, "update ubicaciones set tipo = 'bodega' where id = $1", [esc.tienda])
    )

    expect(error.code).toBe("42501")
    expect((await marca(esc.tienda)).tipo).toBe("tienda")
  })

  it("6. editar la tienda sin cambiar su tipo sigue funcionando", async () => {
    const esc = await escenarioSinConexion(db)

    await consultarComo(db, esc.admin.authId, "update ubicaciones set nombre = 'Tienda centro', tipo = 'tienda' where id = $1", [
      esc.tienda,
    ])

    expect((await db.query("select nombre from ubicaciones where id = $1", [esc.tienda])).rows[0].nombre).toBe("Tienda centro")
  })

  it("7. los demás tipos se siguen cambiando como antes", async () => {
    const esc = await escenarioSinConexion(db)

    await consultarComo(db, esc.admin.authId, "update ubicaciones set tipo = 'bodega' where id = $1", [esc.camion2])

    expect((await marca(esc.camion2)).tipo).toBe("bodega")
  })

  it("8. una migración (dueño de la base) sí puede cambiarlo: es la autorización explícita", async () => {
    const esc = await escenarioSinConexion(db)

    await db.query("update ubicaciones set tipo = 'bodega' where id = $1", [esc.tienda])

    expect((await marca(esc.tienda)).tipo).toBe("bodega")
  })
})
