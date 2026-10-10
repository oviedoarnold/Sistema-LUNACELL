// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

import { aParametrosDeSincronizacion, crearEnvio } from "./ventasSinConexion"

const venta = {
  clave: "off-dispositivo-1-0a0b",
  usuarioAuth: "auth-1",
  ubicacionId: "ubic-1",
  dispositivo: "dispositivo-1",
  numeroProvisional: "PROV-DISP-000001",
  registradaEn: "2026-10-10T12:00:00.000Z",
  tasaIsv: 15,
  renglones: [{ producto_id: "p-1", codigo: "11", nombre: "Cargador", cantidad: 1, precio_unitario: 150 }],
  totalCobrado: 172.5,
  formaPago: "contado",
  clienteId: null,
  nombreCliente: "Consumidor Final",
  rtnComprador: "",
  fechaVencimiento: null,
  nota: "",
}

describe("RPC sincronizar_venta_sin_conexion", () => {
  it("manda exactamente los parámetros de la RPC, con el reloj del teléfono al momento de enviar", () => {
    const enviadoEn = new Date("2026-10-10T12:05:00.000Z")

    expect(aParametrosDeSincronizacion(venta, enviadoEn)).toEqual({
      p_clave_idempotencia: venta.clave,
      p_usuario_auth: "auth-1",
      p_ubicacion_id: "ubic-1",
      p_dispositivo: "dispositivo-1",
      p_numero_provisional: "PROV-DISP-000001",
      p_registrada_en: "2026-10-10T12:00:00.000Z",
      p_reloj_dispositivo: "2026-10-10T12:05:00.000Z",
      p_tasa_isv: 15,
      p_renglones: venta.renglones,
      p_total_cobrado: 172.5,
      p_forma_pago: "contado",
      p_cliente_id: null,
      p_nombre_cliente: "Consumidor Final",
      p_rtn_comprador: "",
      p_fecha_vencimiento: null,
      p_nota: "",
    })
  })

  it("devuelve data, error y status tal como responde supabase-js", async () => {
    const rpc = vi.fn(async () => ({ data: { estado: "registrada" }, error: null, status: 200 }))
    const enviar = crearEnvio({ rpc }, () => new Date("2026-10-10T12:05:00.000Z"))

    const r = await enviar(venta)

    expect(rpc).toHaveBeenCalledWith("sincronizar_venta_sin_conexion", expect.objectContaining({ p_clave_idempotencia: venta.clave }))
    expect(r).toEqual({ data: { estado: "registrada" }, error: null, status: 200 })
  })
})
