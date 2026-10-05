import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { registrarTraslado, traerTraslados, ErrorDeTraslado } from "./traslados"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

/*
  El contrato de la API de traslados: un traslado es UNA llamada a
  registrar_traslado(), y el navegador solo dice de dónde, hacia dónde,
  qué productos y cuántos. Empresa, usuario y existencias los decide la
  base.
*/

const EMPRESA = "empresa-1"
const AUTH = "auth-1"

const montar = ({ fallarEn = {}, tablas = {} } = {}) => {
  const falso = crearSupabaseFalso({
    sesionInicial: { user: { id: AUTH } },
    tablas: {
      empresas: [{ id: EMPRESA, nombre: "LUNACELL" }],
      usuarios: [
        { id: "u1", auth_id: AUTH, empresa_id: EMPRESA, nombre: "Ana", activo: true },
        { id: "u2", auth_id: "auth-2", empresa_id: EMPRESA, nombre: "Beto", activo: true },
      ],
      ubicaciones: [
        { id: "bodega", empresa_id: EMPRESA, nombre: "Lunacell Bodega" },
        { id: "store", empresa_id: EMPRESA, nombre: "Lunacell Store" },
      ],
      productos: [{ id: "p1", empresa_id: EMPRESA, nombre: "Cargador", activo: true }],
      inventario_ubicacion: [
        { empresa_id: EMPRESA, ubicacion_id: "bodega", producto_id: "p1", cantidad: 10 },
      ],
      traslados: [],
      traslado_detalle: [],
      movimientos_inventario: [],
      ...tablas,
    },
    fallarEn,
  })

  globalThis.__supabaseFalso = falso

  return falso
}

const traslado = (cambios = {}) => ({
  origenId: "bodega",
  destinoId: "store",
  items: [{ productId: "p1", qty: 3, name: "Cargador", available: 10 }],
  nota: "Reposición",
  ...cambios,
})

const llamadas = (falso) =>
  falso.rpc.mock.calls.filter(([nombre]) => nombre === "registrar_traslado")

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("registrar un traslado", () => {
  it("es una sola llamada con el payload exacto y devuelve el id", async () => {
    const falso = montar()

    const id = await registrarTraslado(traslado(), { clave: "tr-1" })

    expect(llamadas(falso)).toHaveLength(1)
    expect(llamadas(falso)[0][1]).toEqual({
      p_origen: "bodega",
      p_destino: "store",
      p_items: [{ producto_id: "p1", cantidad: 3 }],
      p_nota: "Reposición",
      p_clave_idempotencia: "tr-1",
    })
    expect(id).toBe(falso.datos.traslados[0].id)
  })

  /*
    Lo que pertenece al servidor no viaja. Si viajara, bastaría con editar
    el payload para trasladar a nombre de otro o desde otra empresa.
  */
  it("no envía empresa, usuario ni existencias", async () => {
    const falso = montar()

    await registrarTraslado(traslado(), { clave: "tr-2" })

    const texto = JSON.stringify(llamadas(falso)[0][1])

    for (const prohibido of ["empresa", "usuario", "available", "existencia", "name"]) {
      expect(texto).not.toContain(prohibido)
    }
  })

  it("mueve la existencia de origen a destino", async () => {
    const falso = montar()

    await registrarTraslado(traslado(), { clave: "tr-3" })

    const celda = (u) =>
      falso.datos.inventario_ubicacion.find((c) => c.ubicacion_id === u).cantidad

    expect(celda("bodega")).toBe(7)
    expect(celda("store")).toBe(3)
  })

  it("el reintento con la misma clave devuelve el mismo traslado y no mueve dos veces", async () => {
    const falso = montar()

    const primero = await registrarTraslado(traslado(), { clave: "tr-4" })
    const segundo = await registrarTraslado(traslado(), { clave: "tr-4" })

    expect(segundo).toBe(primero)
    expect(falso.datos.traslados).toHaveLength(1)
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(7)
  })

  it("no escribe tablas directamente", async () => {
    const falso = montar()

    await registrarTraslado(traslado(), { clave: "tr-5" })

    for (const tabla of ["traslados", "traslado_detalle", "movimientos_inventario", "inventario_ubicacion"]) {
      expect(falso.from).not.toHaveBeenCalledWith(tabla)
    }
  })
})

describe("los rechazos", () => {
  it.each([
    ["LT001", "mismo-origen-destino"],
    ["LT002", "ubicacion-inactiva"],
    ["LT003", "traslado-invalido"],
    ["LT004", "producto-invalido"],
    ["LT005", "existencia-insuficiente"],
    ["LT006", "clave-reusada"],
    ["42501", "sin-permiso"],
  ])("%s llega como ErrorDeTraslado con motivo %s y el mensaje del motor", async (code, motivo) => {
    montar({ fallarEn: { registrar_traslado: { code, message: "mensaje del motor" } } })

    const intento = registrarTraslado(traslado(), { clave: "tr-6" })

    await expect(intento).rejects.toBeInstanceOf(ErrorDeTraslado)
    await expect(intento).rejects.toMatchObject({ motivo, codigo: code, message: "mensaje del motor" })
  })

  it("la falta de existencia dice cuánto hay y dónde, y no mueve nada", async () => {
    const falso = montar()

    await expect(
      registrarTraslado(traslado({ items: [{ productId: "p1", qty: 11 }] }), { clave: "tr-7" })
    ).rejects.toThrow("No hay suficiente «Cargador» en Lunacell Bodega: hay 10, se trasladan 11")

    expect(falso.datos.traslados).toHaveLength(0)
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(10)
  })

  it("un fallo desconocido se informa sin detalles internos", async () => {
    montar({ fallarEn: { registrar_traslado: { message: "connection reset" } } })

    await expect(registrarTraslado(traslado(), { clave: "tr-8" })).rejects.toThrow(
      "No se pudo registrar el traslado."
    )
  })
})

describe("el historial", () => {
  const HISTORIAL = {
    traslados: [
      { id: "t1", empresa_id: EMPRESA, origen_id: "bodega", destino_id: "store", usuario_id: "u1", estado: "aplicado", nota: "", creado_en: "2026-10-01T10:00:00Z" },
      { id: "t2", empresa_id: EMPRESA, origen_id: "store", destino_id: "bodega", usuario_id: "u2", estado: "aplicado", nota: "Devolución", creado_en: "2026-10-02T10:00:00Z" },
    ],
    traslado_detalle: [
      { traslado_id: "t1", empresa_id: EMPRESA, producto_id: "p1", cantidad: 4 },
      { traslado_id: "t2", empresa_id: EMPRESA, producto_id: "p1", cantidad: 1 },
    ],
  }

  it("trae los traslados del más reciente al más antiguo, con sus renglones y quién los hizo", async () => {
    montar({ tablas: HISTORIAL })

    const lista = await traerTraslados()

    expect(lista.map((t) => t.id)).toEqual(["t2", "t1"])
    expect(lista[0]).toMatchObject({
      originId: "store",
      destinationId: "bodega",
      userName: "Beto",
      status: "aplicado",
      note: "Devolución",
      items: [{ productId: "p1", qty: 1 }],
    })
  })

  it("si no puede leer quién lo hizo, deja el nombre vacío en vez de fallar", async () => {
    montar({ tablas: HISTORIAL, fallarEn: { usuarios: { message: "sin permiso" } } })

    const lista = await traerTraslados()

    expect(lista).toHaveLength(2)
    expect(lista[0].userName).toBe("")
  })

  it("avisa si no puede cargar los traslados", async () => {
    montar({ fallarEn: { traslados: { message: "sin permiso" } } })

    await expect(traerTraslados()).rejects.toThrow("No se pudo cargar el historial de traslados.")
  })
})

/*
  INV-4.2: el detalle nombra cada producto aunque ya no esté activo. Los
  nombres no salen del catálogo de la pantalla —que solo tiene los
  activos— sino de una consulta propia, UNA por carga del historial y no
  una por traslado.
*/
describe("el historial: nombres de los productos", () => {
  const CATALOGO = [
    { id: "p1", empresa_id: EMPRESA, nombre: "Cargador", activo: true },
    { id: "p2", empresa_id: EMPRESA, nombre: "Cable descontinuado", activo: false },
    { id: "p3", empresa_id: EMPRESA, nombre: "Funda", activo: true },
  ]

  const TRASLADOS = ["t1", "t2", "t3"].map((id, i) => ({
    id,
    empresa_id: EMPRESA,
    origen_id: "bodega",
    destino_id: "store",
    usuario_id: "u1",
    estado: "aplicado",
    nota: "",
    creado_en: `2026-10-0${i + 1}T10:00:00Z`,
  }))

  const DETALLE = [
    { traslado_id: "t1", empresa_id: EMPRESA, producto_id: "p1", cantidad: 4 },
    { traslado_id: "t1", empresa_id: EMPRESA, producto_id: "p2", cantidad: 2 },
    { traslado_id: "t2", empresa_id: EMPRESA, producto_id: "p2", cantidad: 1 },
    { traslado_id: "t3", empresa_id: EMPRESA, producto_id: "p3", cantidad: 5 },
  ]

  const consultasA = (falso, tabla) =>
    falso.from.mock.calls.filter(([nombre]) => nombre === tabla).length

  it("cada renglón trae el nombre del producto, también si está inactivo", async () => {
    montar({ tablas: { productos: CATALOGO, traslados: TRASLADOS, traslado_detalle: DETALLE } })

    const lista = await traerTraslados()

    expect(lista.find((t) => t.id === "t1").items).toEqual([
      { productId: "p1", productName: "Cargador", qty: 4 },
      { productId: "p2", productName: "Cable descontinuado", qty: 2 },
    ])
  })

  it("resuelve los nombres en una sola consulta, sin importar cuántos traslados haya", async () => {
    const falso = montar({
      tablas: { productos: CATALOGO, traslados: TRASLADOS, traslado_detalle: DETALLE },
    })

    await traerTraslados()

    expect(consultasA(falso, "productos")).toBe(1)
  })

  it("sin traslados no consulta productos", async () => {
    const falso = montar({ tablas: { productos: CATALOGO } })

    expect(await traerTraslados()).toEqual([])
    expect(consultasA(falso, "productos")).toBe(0)
  })

  it("si no puede leer los productos, muestra el historial con el nombre vacío", async () => {
    montar({
      tablas: { productos: CATALOGO, traslados: TRASLADOS, traslado_detalle: DETALLE },
      fallarEn: { productos: { message: "sin permiso" } },
    })

    const lista = await traerTraslados()

    expect(lista).toHaveLength(3)
    expect(lista.find((t) => t.id === "t3").items).toEqual([
      { productId: "p3", productName: "", qty: 5 },
    ])
  })
})
