import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { confirmarRecepcion, reportarIncidencia, traerPorRecibir, ErrorDeTraslado } from "./traslados"
import { crearSupabaseFalso } from "../../test/supabaseFalso"
import { esConfirmacionAdministrativa, puedeRecibirEste, puedeRecibirTraslados } from "../../hooks/useTrasladosPorRecibir"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  El contrato de la recepción (0056): confirmar y reportar son UNA llamada
  cada una con solo el traslado (y la observación); quién recibe lo decide
  la base desde la sesión. Lo que se trae «por recibir» es lo que va a la
  ubicación del usuario y no envió él; al administrador, todo.
*/

const EMPRESA = "empresa-1"

const traslado = (id, cambios = {}) => ({
  id,
  empresa_id: EMPRESA,
  numero: `TR-00000${id.slice(-1)}`,
  origen_id: "bodega",
  destino_id: "store",
  usuario_id: "u-gladys",
  estado: "pendiente",
  unidades: 2,
  nota: "",
  creado_en: `2026-11-26T1${id.slice(-1)}:00:00Z`,
  ...cambios,
})

const montar = ({ auth = "auth-ruta", tablas = {} } = {}) => {
  const falso = crearSupabaseFalso({
    sesionInicial: { user: { id: auth } },
    tablas: {
      usuarios: [
        { id: "u-ruta", auth_id: "auth-ruta", empresa_id: EMPRESA, nombre: "Vendedor Ruta", rol: "vendedor", activo: true, ubicacion_id: "store" },
        { id: "u-admin", auth_id: "auth-admin", empresa_id: EMPRESA, nombre: "Administradora", rol: "admin", activo: true, ubicacion_id: "bodega" },
        { id: "u-gladys", auth_id: "auth-gladys", empresa_id: EMPRESA, nombre: "Gladys Luna", rol: "vendedor", activo: true, ubicacion_id: "bodega" },
      ],
      permisos_usuario: [{ usuario_id: "u-ruta", empresa_id: EMPRESA, seccion: "inventory-own" }],
      ubicaciones: [
        { id: "bodega", empresa_id: EMPRESA, nombre: "Lunacell Bodega" },
        { id: "store", empresa_id: EMPRESA, nombre: "Ruta local" },
      ],
      productos: [{ id: "p1", empresa_id: EMPRESA, nombre: "Cargador", codigo: "C-1", activo: true }],
      inventario_ubicacion: [],
      traslados: [traslado("t1"), traslado("t2", { destino_id: "bodega" }), traslado("t3", { usuario_id: "u-ruta" }), traslado("t4", { estado: "recibido" })],
      traslado_detalle: [{ traslado_id: "t1", empresa_id: EMPRESA, producto_id: "p1", cantidad: 2 }],
      movimientos_inventario: [],
      ...tablas,
    },
  })

  globalThis.__supabaseFalso = falso

  return falso
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("confirmar y reportar", () => {
  it("confirmar es una sola llamada con el traslado y la observación, y devuelve lo que respondió la base", async () => {
    const falso = montar()

    const r = await confirmarRecepcion("t1")

    expect(falso.rpc.mock.calls.filter(([n]) => n === "confirmar_recepcion_traslado")).toEqual([
      ["confirmar_recepcion_traslado", { p_traslado: "t1", p_observacion: null }],
    ])
    expect(r).toMatchObject({ estado: "recibido", repetida: false })
  })

  it("un rechazo de negocio llega con su motivo y el mensaje del motor", async () => {
    montar({ auth: "auth-admin" })

    const intento = confirmarRecepcion("t1")

    await expect(intento).rejects.toBeInstanceOf(ErrorDeTraslado)
    await expect(confirmarRecepcion("t1")).rejects.toMatchObject({ motivo: "falta-observacion", codigo: "LT013" })
  })

  it("reportar manda el traslado y la nota", async () => {
    const falso = montar()

    await reportarIncidencia("t1", "Llegó uno solo")

    expect(falso.rpc.mock.calls.filter(([n]) => n === "reportar_incidencia_traslado")[0][1]).toEqual({ p_traslado: "t1", p_nota: "Llegó uno solo" })
  })

  it("sin permiso se distingue de un fallo de red", async () => {
    montar({ auth: "auth-gladys" })

    await expect(confirmarRecepcion("t1")).rejects.toMatchObject({ motivo: "sin-permiso" })
  })
})

describe("traerPorRecibir", () => {
  it("al vendedor, lo pendiente que va a su ubicación y no envió él, con código de producto", async () => {
    montar()

    const lista = await traerPorRecibir({ esAdmin: false, ubicacionId: "store", usuarioId: "u-ruta" })

    expect(lista.map((t) => t.id)).toEqual(["t1"])
    expect(lista[0]).toMatchObject({ units: 2, items: [{ productId: "p1", productName: "Cargador", productCode: "C-1", qty: 2 }] })
  })

  it("al administrador, todo lo pendiente de la empresa", async () => {
    montar({ auth: "auth-admin" })

    expect((await traerPorRecibir({ esAdmin: true, ubicacionId: "bodega", usuarioId: "u-admin" })).map((t) => t.id)).toEqual(["t1", "t2", "t3"])
  })

  it("sin ubicación operativa no hay nada que recibir", async () => {
    montar()

    expect(await traerPorRecibir({ esAdmin: false, ubicacionId: "", usuarioId: "u-ruta" })).toEqual([])
  })
})

describe("las reglas de la pantalla, iguales a las de la base", () => {
  const permiso = (lista) => (p) => lista.includes(p)
  const vendedor = { id: "u-ruta", role: "vendedor", locationId: "store" }
  const admin = { id: "u-admin", role: "admin", locationId: "bodega" }
  const t = { destinationId: "store", userId: "u-gladys" }

  it("puede recibir quien tiene ubicación y permiso de inventario; nunca el contador ni sin conexión", () => {
    expect(puedeRecibirTraslados(vendedor, permiso(["inventory-own"]))).toBe(true)
    expect(puedeRecibirTraslados(vendedor, permiso(["pos"]))).toBe(false)
    expect(puedeRecibirTraslados({ ...vendedor, locationId: "" }, permiso(["inventory-own"]))).toBe(false)
    expect(puedeRecibirTraslados({ ...vendedor, role: "contador" }, permiso(["inventory-own"]))).toBe(false)
    expect(puedeRecibirTraslados({ ...vendedor, sinConexion: true }, permiso(["inventory-own"]))).toBe(false)
    expect(puedeRecibirTraslados(admin, permiso([]))).toBe(true)
  })

  it("este traslado: el destino propio y no el que envió; el administrador, cualquiera", () => {
    expect(puedeRecibirEste(t, vendedor, permiso(["inventory-own"]))).toBe(true)
    expect(puedeRecibirEste({ ...t, destinationId: "bodega" }, vendedor, permiso(["inventory-all"]))).toBe(false)
    expect(puedeRecibirEste({ ...t, userId: "u-ruta" }, vendedor, permiso(["inventory-all"]))).toBe(false)
    expect(puedeRecibirEste(t, admin, permiso([]))).toBe(true)
  })

  it("confirmación administrativa: el administrador fuera de su ubicación, o lo que envió él", () => {
    expect(esConfirmacionAdministrativa(t, admin)).toBe(true)
    expect(esConfirmacionAdministrativa({ destinationId: "bodega", userId: "u-gladys" }, admin)).toBe(false)
    expect(esConfirmacionAdministrativa({ destinationId: "bodega", userId: "u-admin" }, admin)).toBe(true)
    expect(esConfirmacionAdministrativa(t, vendedor)).toBe(false)
  })
})
