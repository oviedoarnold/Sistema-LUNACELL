// @vitest-environment node
import { describe, it, expect } from "vitest"

import { CARGADOR, DUENO, copiaDePrueba, sesionDe, nuevoNavegador, ahoraDePrueba } from "./pruebas/ayudas"
import { construirVentaLocal } from "./venta"
import { guardarCopia } from "./copiaLocal"
import { idDelDispositivo } from "./dispositivo"
import { guardarVenta, ventasDe, marcar, recuperarInterrumpidas, limpiarConfirmadas, ESTADOS, ErrorDeCola } from "./cola"

async function preparar(navegador = nuevoNavegador()) {
  const almacen = await navegador.abrir()
  await guardarCopia(almacen, copiaDePrueba())
  const dispositivo = await idDelDispositivo(almacen)
  const vender = (cantidad = 2) =>
    guardarVenta(
      almacen,
      construirVentaLocal({
        copia: copiaDePrueba(),
        sesion: sesionDe(),
        dispositivo,
        carrito: [{ productoId: CARGADOR.id, cantidad }],
        formaPago: "contado",
        ahora: ahoraDePrueba(),
      })
    )

  return { almacen, navegador, vender }
}

describe("guardar una venta", () => {
  it("le da un número provisional consecutivo del dispositivo", async () => {
    const { vender } = await preparar()

    const a = await vender(1)
    const b = await vender(1)

    expect(a.numeroProvisional).toMatch(/^PROV-[A-Z0-9]{4}-000001$/)
    expect(b.numeroProvisional).toMatch(/^PROV-[A-Z0-9]{4}-000002$/)
  })

  it("queda guardada aunque se cierre la pestaña o se reinicie el teléfono", async () => {
    const navegador = nuevoNavegador()
    const { almacen, vender } = await preparar(navegador)
    const venta = await vender()
    almacen.cerrar()

    const reabierto = await navegador.abrir()

    expect((await ventasDe(reabierto, DUENO)).map((v) => v.clave)).toEqual([venta.clave])
  })

  it("no deja vender en este dispositivo más de lo que hay localmente", async () => {
    const { almacen, vender } = await preparar()
    await vender(8)

    await expect(vender(3)).rejects.toThrow(ErrorDeCola)
    expect((await ventasDe(almacen, DUENO)).length).toBe(1)
  })

  it("si falla no gasta número provisional", async () => {
    const { vender } = await preparar()
    await vender(8)
    await vender(5).catch(() => {})

    const siguiente = await vender(1)

    expect(siguiente.numeroProvisional).toMatch(/-000002$/)
  })

  it("no acepta dos veces la misma clave", async () => {
    const { almacen, vender } = await preparar()
    const venta = await vender(1)

    await expect(guardarVenta(almacen, { ...venta, numeroProvisional: undefined })).rejects.toThrow(/ya está guardada/i)
  })

  it("sin copia local no se puede vender", async () => {
    const almacen = await nuevoNavegador().abrir()
    const venta = construirVentaLocal({
      copia: copiaDePrueba(),
      sesion: sesionDe(),
      dispositivo: "dispositivo-sin-copia",
      carrito: [{ productoId: CARGADOR.id, cantidad: 1 }],
      formaPago: "contado",
      ahora: ahoraDePrueba(),
    })

    await expect(guardarVenta(almacen, venta)).rejects.toThrow(/copia local/i)
  })
})

describe("estados", () => {
  it("una venta confirmada por el servidor no vuelve atrás", async () => {
    const { almacen, vender } = await preparar()
    const venta = await vender(1)
    await marcar(almacen, venta.clave, { estado: ESTADOS.REGISTRADA, ventaId: "v-1" })

    await expect(marcar(almacen, venta.clave, { estado: ESTADOS.PENDIENTE })).rejects.toThrow(/confirmada/i)
  })

  it("al abrir, lo que quedó enviándose vuelve a pendiente con la misma clave", async () => {
    const { almacen, vender } = await preparar()
    const venta = await vender(1)
    await marcar(almacen, venta.clave, { estado: ESTADOS.SINCRONIZANDO })

    const recuperadas = await recuperarInterrumpidas(almacen)

    expect(recuperadas).toBe(1)
    expect((await ventasDe(almacen, DUENO))[0]).toMatchObject({ clave: venta.clave, estado: ESTADOS.PENDIENTE })
  })

  it("la limpieza solo quita ventas confirmadas y viejas; nunca pendientes ni con error", async () => {
    const { almacen, vender } = await preparar()
    const vieja = await vender(1)
    const pendiente = await vender(1)
    const conError = await vender(1)
    await marcar(almacen, vieja.clave, { estado: ESTADOS.REGISTRADA, confirmadaEn: "2026-09-01T00:00:00.000Z" })
    await marcar(almacen, conError.clave, { estado: ESTADOS.ERROR })

    const quitadas = await limpiarConfirmadas(almacen, { antesDe: new Date("2026-10-01T00:00:00.000Z") })

    expect(quitadas).toBe(1)
    expect((await ventasDe(almacen, DUENO)).map((v) => v.clave).sort()).toEqual([pendiente.clave, conError.clave].sort())
  })
})
