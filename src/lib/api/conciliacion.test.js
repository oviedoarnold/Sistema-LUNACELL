// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { montarDatos } from "../../test/pantallas"
import {
  traerVentasPorConciliar,
  conciliarVenta,
  traerAuditoriaRescates,
  ErrorDeConciliacion,
  ACCIONES_DE_CONCILIACION,
} from "./conciliacion"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const fila = (cambios = {}) => ({
  id: "conc-1",
  empresa_id: "empresa-prueba",
  clave_idempotencia: "off-dispositivo-0001-abc",
  usuario_id: "u-vendedor",
  usuario_auth: "auth-vendedor",
  ubicacion_id: "camion-01",
  dispositivo: "dispositivo-0001",
  numero_provisional: "PROV-DISP-000001",
  registrada_en: "2026-10-10T10:00:00.000Z",
  recibida_en: "2026-10-10T11:00:00.000Z",
  desfase_segundos: 3,
  forma_pago: "contado",
  cliente_id: null,
  nombre_cliente: "Consumidor Final",
  rtn_comprador: "",
  fecha_vencimiento: null,
  nota: "",
  renglones: [{ producto_id: "p1", codigo: "M-001", nombre: "Martillo", cantidad: 2, precio_unitario: 180 }],
  tasa_isv: "15.00",
  total_cobrado: "414.00",
  motivo: "existencia-insuficiente",
  codigo: "LV007",
  detalle: "Solo hay 1",
  recibida_por: "vendedor",
  rescatada_por: null,
  estado: "pendiente",
  resuelta_en: null,
  resolucion_accion: null,
  resolucion_motivo: null,
  venta_id: null,
  ajuste_movimientos: [],
  ...cambios,
})

describe("ventas por conciliar", () => {
  it("las trae con nombres de la aplicación, las más recientes primero", async () => {
    montarDatos({
      tablasExtra: {
        ventas_por_conciliar: [fila(), fila({ id: "conc-2", recibida_en: "2026-10-10T12:00:00.000Z", estado: "aplicada" })],
      },
    })

    const lista = await traerVentasPorConciliar()

    expect(lista.map((v) => v.id)).toEqual(["conc-2", "conc-1"])
    expect(lista[1]).toMatchObject({
      id: "conc-1",
      clave: "off-dispositivo-0001-abc",
      usuarioId: "u-vendedor",
      ubicacionId: "camion-01",
      dispositivo: "dispositivo-0001",
      numeroProvisional: "PROV-DISP-000001",
      registradaEn: "2026-10-10T10:00:00.000Z",
      formaPago: "contado",
      totalCobrado: 414,
      tasaIsv: 15,
      motivo: "existencia-insuficiente",
      estado: "pendiente",
      renglones: [{ productoId: "p1", codigo: "M-001", nombre: "Martillo", cantidad: 2, precio: 180 }],
    })
  })

  it("un fallo se informa", async () => {
    montarDatos({ fallarEn: { ventas_por_conciliar: { message: "sin red" } } })

    await expect(traerVentasPorConciliar()).rejects.toThrow(/ventas por conciliar/i)
  })
})

describe("conciliar una venta", () => {
  it("llama a conciliar_venta con la acción y el motivo, y devuelve el resultado", async () => {
    const respuesta = { estado: "aplicada", conciliacion_id: "conc-1", venta_id: "v-1", numero_factura: "INT-1", total: 414, ajustes: [7] }
    const falso = montarDatos({ rpcsExtra: { conciliar_venta: () => ({ data: respuesta, error: null }) } })

    const r = await conciliarVenta("conc-1", "aplicar_con_ajuste", "  Faltaba registrar el traslado  ")

    expect(falso.rpc).toHaveBeenCalledWith("conciliar_venta", {
      p_conciliacion: "conc-1",
      p_accion: "aplicar_con_ajuste",
      p_motivo: "Faltaba registrar el traslado",
    })
    expect(r).toEqual(respuesta)
  })

  it("solo permite las tres acciones y exige motivo, sin llamar al servidor", async () => {
    const falso = montarDatos({ rpcsExtra: { conciliar_venta: () => ({ data: {}, error: null }) } })

    expect(ACCIONES_DE_CONCILIACION).toEqual(["aplicar", "aplicar_con_ajuste", "anular"])
    await expect(conciliarVenta("conc-1", "borrar", "x")).rejects.toThrow(/acción/i)
    await expect(conciliarVenta("conc-1", "anular", "   ")).rejects.toThrow(/motivo/i)
    expect(falso.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["CV002", "ya-resuelta"],
    ["CV003", "producto-inexistente"],
    ["CV004", "cliente-inexistente"],
    ["CV005", "falta-existencia"],
    ["CV006", "total-distinto"],
    ["CV007", "ubicacion-fiscal"],
    ["42501", "sin-permiso"],
  ])("traduce %s con el mensaje del servidor", async (codigo, motivo) => {
    montarDatos({ rpcsExtra: { conciliar_venta: () => ({ data: null, error: { code: codigo, message: "Texto del servidor" } }) } })

    const error = await conciliarVenta("conc-1", "aplicar", "motivo").catch((e) => e)

    expect(error).toBeInstanceOf(ErrorDeConciliacion)
    expect(error).toMatchObject({ motivo, codigo, message: "Texto del servidor" })
  })
})

describe("auditoría de rescates", () => {
  it("trae los intentos más recientes primero", async () => {
    montarDatos({
      tablasExtra: {
        auditoria_rescates: [
          { id: 1, lote: "lote-1", clave: "off-a", resultado: "en_conciliacion", codigo: null, detalle: "", creado_en: "2026-10-10T10:00:00Z" },
          { id: 2, lote: "lote-1", clave: "off-b", resultado: "rechazado", codigo: "OF003", detalle: "Clave usada", creado_en: "2026-10-10T11:00:00Z" },
        ],
      },
    })

    const lista = await traerAuditoriaRescates()

    expect(lista.map((r) => r.id)).toEqual([2, 1])
    expect(lista[0]).toMatchObject({ lote: "lote-1", clave: "off-b", resultado: "rechazado", codigo: "OF003", detalle: "Clave usada" })
  })
})
