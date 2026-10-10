// @vitest-environment node
import { describe, it, expect } from "vitest"

import { nuevoNavegador } from "./pruebas/ayudas"
import { VERSION_DEL_ALMACEN } from "./almacen"
import { idDelDispositivo, codigoCorto } from "./dispositivo"

describe("almacén", () => {
  it("crea los almacenes de la versión actual", async () => {
    const almacen = await nuevoNavegador().abrir()

    expect(almacen.version).toBe(VERSION_DEL_ALMACEN)
    expect(almacen.almacenes().sort()).toEqual(["copias", "meta", "ventas"])
  })

  it("lo guardado sigue ahí al volver a abrir (cerrar la pestaña, reiniciar)", async () => {
    const navegador = nuevoNavegador()
    const primera = await navegador.abrir()
    await primera.transaccion(["ventas"], "readwrite", (t) => t.poner("ventas", { clave: "off-x-1", estado: "pendiente" }))
    primera.cerrar()

    const segunda = await navegador.abrir()

    expect(await segunda.leer("ventas", "off-x-1")).toEqual({ clave: "off-x-1", estado: "pendiente" })
  })

  it("una transacción que falla no deja nada a medias", async () => {
    const almacen = await nuevoNavegador().abrir()

    await expect(
      almacen.transaccion(["ventas", "meta"], "readwrite", async (t) => {
        await t.poner("meta", { clave: "secuencia", valor: 7 })
        await t.poner("ventas", { clave: "off-x-2" })
        throw new Error("falla a la mitad")
      })
    ).rejects.toThrow("falla a la mitad")

    expect(await almacen.leer("meta", "secuencia")).toBeUndefined()
    expect(await almacen.leer("ventas", "off-x-2")).toBeUndefined()
  })
})

describe("dispositivo", () => {
  it("tiene un identificador estable entre aperturas", async () => {
    const navegador = nuevoNavegador()
    const id = await idDelDispositivo(await navegador.abrir())

    expect(await idDelDispositivo(await navegador.abrir())).toBe(id)
    expect(id).toMatch(/^[A-Za-z0-9-]{4,64}$/)
  })

  it("dos pedidos simultáneos reciben el mismo identificador", async () => {
    const almacen = await nuevoNavegador().abrir()

    const [a, b] = await Promise.all([idDelDispositivo(almacen), idDelDispositivo(almacen)])

    expect(a).toBe(b)
  })

  it("dos navegadores tienen identificadores distintos", async () => {
    const a = await idDelDispositivo(await nuevoNavegador().abrir())
    const b = await idDelDispositivo(await nuevoNavegador().abrir())

    expect(a).not.toBe(b)
  })

  it("el código corto sirve para el comprobante", async () => {
    const id = await idDelDispositivo(await nuevoNavegador().abrir())

    expect(codigoCorto(id)).toMatch(/^[A-Z0-9]{4}$/)
  })
})
