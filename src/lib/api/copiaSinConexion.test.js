// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { montarDatos, EMPRESA, AUTH_ID } from "../../test/pantallas"
import { descargarCopia } from "./copiaSinConexion"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const PRODUCTOS = [
  { id: "p1", code: "M-001", name: "Martillo", category: "Herramientas", price: 180, stock: 13 },
  { id: "p2", code: "C-001", name: "Cemento", category: "Construcción", price: 250, stock: 0 },
]
const CLIENTES = [{ id: "c1", name: "Ferremax", rtn: "0801", phone: "9999", address: "SPS" }]
const CAMION = { id: "camion-01", name: "Camión 01", type: "camion", offline: true }
const BODEGA = { id: "bodega", name: "Bodega", type: "bodega" }
const EXISTENCIAS = [
  { locationId: "camion-01", productId: "p1", quantity: 3 },
  { locationId: "bodega", productId: "p1", quantity: 10 },
]

const PERFIL = { empresa_id: EMPRESA, authId: AUTH_ID, locationId: "camion-01" }
const ahora = () => new Date("2026-10-10T12:00:00.000Z")

const montar = (cambios = {}) =>
  montarDatos({
    productos: PRODUCTOS,
    clientes: CLIENTES,
    ubicaciones: [CAMION, BODEGA],
    existencias: EXISTENCIAS,
    ubicacionOperativa: "camion-01",
    ...cambios,
  })

describe("descargar la copia local", () => {
  it("trae catálogo con precios, existencias solo de su ubicación, clientes y tasa", async () => {
    montar()

    const copia = await descargarCopia({ perfil: PERFIL, ahora })

    expect(copia).toMatchObject({
      empresaId: EMPRESA,
      usuarioAuth: AUTH_ID,
      ubicacionId: "camion-01",
      ubicacion: { id: "camion-01", nombre: "Camión 01", vendeSinConexion: true, emiteFiscal: false },
      empresa: { tasaIsv: 15 },
      existencias: { p1: 3, p2: 0 },
      clientesDisponibles: true,
      tomadaEn: "2026-10-10T12:00:00.000Z",
    })
    expect(copia.productos).toEqual([
      { id: "p2", codigo: "C-001", nombre: "Cemento", precio: 250, categoria: "Construcción" },
      { id: "p1", codigo: "M-001", nombre: "Martillo", precio: 180, categoria: "Herramientas" },
    ])
    expect(copia.clientes).toEqual([{ id: "c1", nombre: "Ferremax", rtn: "0801", telefono: "9999", direccion: "SPS" }])
  })

  it("trae los precios especiales por cliente, sin costos", async () => {
    montar({
      tablasExtra: {
        precios_por_cliente: [
          { id: "e1", cliente_id: "c1", producto_id: "p1", precio: 150, costo: 90 },
          { id: "e2", cliente_id: "c2", producto_id: "p1", precio: "160.50" },
        ],
      },
    })

    const copia = await descargarCopia({ perfil: PERFIL, ahora })

    expect(copia.preciosDisponibles).toBe(true)
    expect(copia.preciosPorCliente).toEqual({ c1: { p1: 150 }, c2: { p1: 160.5 } })
    expect(JSON.stringify(copia)).not.toMatch(/costo/)
  })

  it("si no se pudieron leer los precios, lo deja dicho y la copia sigue sirviendo", async () => {
    montar({ fallarEn: { precios_por_cliente: { select: { code: "XX000", message: "fallo" } } } })

    const copia = await descargarCopia({ perfil: PERFIL, ahora })

    expect(copia).toMatchObject({ preciosDisponibles: false, preciosPorCliente: {} })
    expect(copia.productos).toHaveLength(2)
  })

  it("si la ubicación no vende sin conexión, no baja catálogo, existencias ni clientes", async () => {
    const falso = montar({ ubicaciones: [{ ...CAMION, offline: false }, BODEGA] })

    const copia = await descargarCopia({ perfil: PERFIL, ahora })

    expect(copia.ubicacion.vendeSinConexion).toBe(false)
    expect(copia).toMatchObject({ productos: [], existencias: {}, clientes: [] })
    expect(falso.from).not.toHaveBeenCalledWith("clientes")
    expect(falso.from).not.toHaveBeenCalledWith("productos_con_stock")
  })

  it("una ubicación fiscal nunca queda habilitada aquí, aunque la marca diga que sí", async () => {
    montar({ ubicaciones: [{ ...CAMION, fiscal: true }, BODEGA] })

    const copia = await descargarCopia({ perfil: PERFIL, ahora })

    expect(copia.ubicacion).toMatchObject({ vendeSinConexion: false, emiteFiscal: true })
    expect(copia.productos).toEqual([])
  })

  it("una ubicación inactiva o que no vende tampoco queda habilitada", async () => {
    montar({ ubicaciones: [{ ...CAMION, active: false }, BODEGA] })
    expect((await descargarCopia({ perfil: PERFIL, ahora })).ubicacion.vendeSinConexion).toBe(false)

    montar({ ubicaciones: [{ ...CAMION, sells: false }, BODEGA] })
    expect((await descargarCopia({ perfil: PERFIL, ahora })).ubicacion.vendeSinConexion).toBe(false)
  })

  it("sin ubicación asignada no hay copia", async () => {
    montar()

    expect(await descargarCopia({ perfil: { ...PERFIL, locationId: "" }, ahora })).toBeNull()
  })

  it("si falla el catálogo o las existencias, lanza: nunca guarda una copia incompleta", async () => {
    montar({ fallarEn: { productos_con_stock: { message: "sin red" } } })
    await expect(descargarCopia({ perfil: PERFIL, ahora })).rejects.toThrow()

    montar({ fallarEn: { existencias_por_ubicacion: { message: "sin red" } } })
    await expect(descargarCopia({ perfil: PERFIL, ahora })).rejects.toThrow()
  })

  it("si no se pueden leer los clientes, la copia sale sin ellos y lo dice: el crédito sin conexión queda deshabilitado", async () => {
    montar({ fallarEn: { clientes: { code: "42501", message: "sin permiso" } } })

    const copia = await descargarCopia({ perfil: PERFIL, ahora })

    expect(copia.clientes).toEqual([])
    expect(copia.clientesDisponibles).toBe(false)
    expect(copia.productos).toHaveLength(2)
  })
})
