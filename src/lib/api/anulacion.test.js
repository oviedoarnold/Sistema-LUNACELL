import { describe, it, expect, vi, beforeEach } from "vitest"

import { anularVenta, aVentaDeApp, ErrorDeAnulacion } from "./ventas"

/*
  El contrato con anular_venta(): solo viajan la venta, el motivo, el
  dinero y la clave del intento; todo lo demás lo decide la base. Y la
  venta que vuelve del historial trae su anulación para mostrarla.
*/

const rpc = vi.fn()

vi.mock("../supabase", () => ({
  get supabase() {
    return { rpc }
  },
  hayConexionConfigurada: true,
}))

beforeEach(() => {
  rpc.mockReset()
})

describe("anularVenta", () => {
  it("llama una vez a anular_venta con solo cuatro datos y devuelve su respuesta", async () => {
    rpc.mockResolvedValue({ data: { estado: "anulada", venta_id: "v-1" }, error: null, status: 200 })

    const r = await anularVenta("v-1", { motivo: "Se registró dos veces", tratamientoDinero: "no_cobrado", clave: "anular-v-1" })

    expect(r).toEqual({ estado: "anulada", venta_id: "v-1" })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("anular_venta", {
      p_venta_id: "v-1",
      p_motivo: "Se registró dos veces",
      p_tratamiento_dinero: "no_cobrado",
      p_clave_idempotencia: "anular-v-1",
    })
  })

  it.each([
    ["AV003", "fuera-de-plazo"],
    ["AV004", "fiscal"],
    ["AV005", "con-abonos"],
    ["AV008", "conciliacion"],
    ["42501", "sin-permiso"],
  ])("un rechazo %s llega como %s con el mensaje de la base", async (codigo, motivo) => {
    rpc.mockResolvedValue({ data: null, error: { code: codigo, message: "Mensaje de la base" }, status: 400 })

    const error = await anularVenta("v-1", { motivo: "Se registró dos veces" }).catch((e) => e)

    expect(error).toBeInstanceOf(ErrorDeAnulacion)
    expect(error).toMatchObject({ motivo, codigo, message: "Mensaje de la base" })
  })

  it("sin respuesta del servidor no dice que se anuló ni que no", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch" }, status: 0 })

    const error = await anularVenta("v-1", { motivo: "Se registró dos veces" }).catch((e) => e)

    expect(error).toMatchObject({ motivo: "sin-respuesta" })
  })
})

describe("la venta trae su anulación", () => {
  const fila = (extra = {}) => ({
    id: "v-1",
    numero_factura: "VTA-000009",
    correlativo: 9,
    fecha: "2026-10-24T15:00:00Z",
    subtotal: 200,
    isv: 30,
    tasa_isv: 15,
    total: 230,
    forma_pago: "contado",
    estado: "anulada",
    ubicacion_id: "camion-1",
    origen: "sin_conexion",
    ...extra,
  })

  const registro = {
    id: "an-1",
    anulada_en: "2026-10-24T16:00:00Z",
    motivo: "Se registró dos veces",
    usuario_nombre: "Chofer",
    usuario_rol: "vendedor",
    tratamiento_dinero: "reembolso_pendiente",
    estado_anterior: "pagada",
  }

  it.each([
    ["como objeto (PostgREST, uno a uno)", registro],
    ["como lista de uno", [registro]],
  ])("la lee %s", (_, embebido) => {
    const venta = aVentaDeApp(fila({ anulaciones_venta: embebido }))

    expect(venta.anulacion).toMatchObject({
      motivo: "Se registró dos veces",
      usuarioNombre: "Chofer",
      usuarioRol: "vendedor",
      tratamientoDinero: "reembolso_pendiente",
      isoDate: "2026-10-24T16:00:00Z",
    })
    expect(venta).toMatchObject({ status: "anulada", locationId: "camion-1", origin: "sin_conexion", invoiceNumber: "VTA-000009" })
  })

  it("una venta vigente no trae anulación", () => {
    expect(aVentaDeApp(fila({ estado: "pagada", anulaciones_venta: null })).anulacion).toBeNull()
    expect(aVentaDeApp(fila({ estado: "pagada", anulaciones_venta: [] })).anulacion).toBeNull()
  })
})
