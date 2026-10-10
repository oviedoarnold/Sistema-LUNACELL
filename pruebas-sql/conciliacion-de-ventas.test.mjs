/*
  OFF-1.1: conciliación administrativa de ventas sin conexión.

  La venta ya se cobró y se entregó. Conciliar es decidir cómo queda en los
  libros, nunca hacerla desaparecer ni cambiar lo cobrado:
  - aplicar: con el vendedor, la ubicación, la fecha y el precio cobrados;
  - aplicar con ajuste: un ajuste de inventario explícito y justificado, y
    después la venta, sin existencias negativas;
  - anular: el registro se conserva con su motivo.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, enDosSesiones } from "./arnes.mjs"
import { crearVendedor, contar } from "./fixtures.mjs"
import {
  escenarioSinConexion,
  ventaSinConexion,
  sincronizar,
  conciliar,
  fallo,
  existencia,
  correlativoInterno,
} from "./escenario-sin-conexion.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

const fila = async (tabla, id) => (await db.query(`select * from ${tabla} where id = $1`, [id])).rows[0]
const segundos = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 1000

/* Una venta que quedó en conciliación porque el precio cambió después de venderla. */
async function porPrecio(opciones = {}) {
  const esc = await escenarioSinConexion(db, opciones)
  const venta = ventaSinConexion(esc)
  await db.query("update productos set precio = 120 where id = $1", [esc.cargador.id])
  const r = await sincronizar(db, esc.vendedor.authId, venta)

  return { esc, venta, id: r.conciliacion_id }
}

describe("aplicar", () => {
  it("1. registra la venta con el precio cobrado, la fecha real, el vendedor y la ubicación originales", async () => {
    const { esc, venta, id } = await porPrecio()

    const r = await conciliar(db, esc.admin.authId, id, "aplicar", "El precio cambió después de la venta")
    const v = await fila("ventas", r.venta_id)
    const c = await fila("ventas_por_conciliar", id)

    expect(r.estado).toBe("aplicada")
    expect(Number(v.total)).toBe(230)
    expect(v.origen).toBe("conciliacion")
    expect(v.usuario_id).toBe(esc.vendedor.usuario)
    expect(v.ubicacion_id).toBe(esc.camion1)
    expect(v.clave_idempotencia).toBe(venta.clave_idempotencia)
    expect(v.huella_origen).toBe(c.huella)
    expect(v.es_fiscal).toBe(false)
    expect(v.numero_factura).toMatch(/^VTA-\d{6}$/)
    expect(segundos(v.fecha, venta.registrada_en)).toBeLessThan(1)
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(8)
    expect(await contar(db, "detalle_venta", "venta_id = $1 and precio = 100", [r.venta_id])).toBe(1)
    expect(c).toMatchObject({ estado: "aplicada", venta_id: r.venta_id, resuelta_por: esc.admin.usuario, resolucion_accion: "aplicar" })
    expect(c.resolucion_motivo).toBe("El precio cambió después de la venta")
  })

  it("2. sin existencia suficiente no aplica y no toca nada", async () => {
    const esc = await escenarioSinConexion(db, { enCamion1: 1 })
    const r = await sincronizar(db, esc.vendedor.authId, ventaSinConexion(esc))
    const numero = await correlativoInterno(db, esc.empresa)

    const error = await fallo(conciliar(db, esc.admin.authId, r.conciliacion_id, "aplicar"))

    expect(error.code).toBe("CV005")
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(1)
    expect(await correlativoInterno(db, esc.empresa)).toBe(numero)
    expect((await fila("ventas_por_conciliar", r.conciliacion_id)).estado).toBe("pendiente")
  })

  it("3. una venta a crédito conciliada queda pendiente de cobro", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc, { forma_pago: "credito", cliente_id: esc.clienteId, fecha_vencimiento: "2027-01-31" })
    await db.query("update productos set precio = 120 where id = $1", [esc.cargador.id])
    const r = await sincronizar(db, esc.vendedor.authId, venta)

    const aplicada = await conciliar(db, esc.admin.authId, r.conciliacion_id, "aplicar")

    expect(await fila("ventas", aplicada.venta_id)).toMatchObject({ estado: "pendiente", forma_pago: "credito", cliente_id: esc.clienteId })
  })

  it("4. aplica aunque el producto se haya desactivado después de venderlo", async () => {
    const { esc, id } = await porPrecio()
    await db.query("update productos set activo = false where id = $1", [esc.cargador.id])

    const r = await conciliar(db, esc.admin.authId, id, "aplicar")

    expect(r.estado).toBe("aplicada")
  })
})

describe("aplicar una venta con el reloj desfasado", () => {
  it("4b. la aplica con la fecha que declaró el teléfono, sin corregirla", async () => {
    const esc = await escenarioSinConexion(db)
    const desfase = 2 * 3600000
    const venta = ventaSinConexion(esc, {
      registrada_en: new Date(Date.now() - desfase - 10 * 60000).toISOString(),
      reloj_dispositivo: new Date(Date.now() - desfase).toISOString(),
    })
    const r = await sincronizar(db, esc.vendedor.authId, venta)

    const aplicada = await conciliar(db, esc.admin.authId, r.conciliacion_id, "aplicar", "El vendedor confirmó la hora")
    const v = await fila("ventas", aplicada.venta_id)

    expect(r.motivo).toBe("reloj-desfasado")
    expect(segundos(v.fecha, venta.registrada_en)).toBeLessThan(1)
    expect(Math.abs(v.desfase_segundos - 7200)).toBeLessThan(30)
  })
})

describe("aplicar con ajuste", () => {
  it("5. ajusta exactamente lo que falta, con la justificación, y nunca deja negativos", async () => {
    const esc = await escenarioSinConexion(db, { enCamion1: 1 })
    const r = await sincronizar(db, esc.vendedor.authId, ventaSinConexion(esc))

    const aplicada = await conciliar(db, esc.admin.authId, r.conciliacion_id, "aplicar_con_ajuste", "Conteo físico: había 2")
    const ajustes = (
      await db.query("select * from movimientos_inventario where id = any($1::bigint[])", [aplicada.ajustes])
    ).rows

    expect(aplicada.estado).toBe("aplicada")
    expect(ajustes).toHaveLength(1)
    expect(ajustes[0]).toMatchObject({ tipo: "ajuste", cantidad: 1, ubicacion_id: esc.camion1 })
    expect(ajustes[0].motivo).toMatch(/conciliación.*Conteo físico: había 2/i)
    expect(ajustes[0].usuario_id).toBe(esc.admin.usuario)
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(0)
    expect((await fila("ventas_por_conciliar", r.conciliacion_id)).ajuste_movimientos).toEqual(aplicada.ajustes)
  })

  it("6. si no falta nada, no inventa ajustes", async () => {
    const { esc, id } = await porPrecio()

    const r = await conciliar(db, esc.admin.authId, id, "aplicar_con_ajuste")

    expect(r.ajustes).toEqual([])
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(8)
  })
})

describe("anular", () => {
  it("7. conserva el registro con su motivo y no crea venta", async () => {
    const { esc, id } = await porPrecio()

    const r = await conciliar(db, esc.admin.authId, id, "anular", "Venta duplicada en el cuaderno")
    const c = await fila("ventas_por_conciliar", id)

    expect(r.estado).toBe("anulada")
    expect(c).toMatchObject({ estado: "anulada", resolucion_accion: "anular", resolucion_motivo: "Venta duplicada en el cuaderno" })
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(0)
  })
})

describe("reglas", () => {
  it("8. el motivo es obligatorio", async () => {
    const { esc, id } = await porPrecio()

    const error = await fallo(conciliar(db, esc.admin.authId, id, "aplicar", "   "))

    expect(error.code).toBe("CV001")
  })

  it("9. un vendedor no puede conciliar", async () => {
    const { esc, id } = await porPrecio()

    const error = await fallo(conciliar(db, esc.vendedor.authId, id, "anular"))

    expect(error.code).toBe("42501")
  })

  it("10. el administrador de otra empresa no la encuentra", async () => {
    const { id } = await porPrecio()
    const otra = await escenarioSinConexion(db)

    const error = await fallo(conciliar(db, otra.admin.authId, id, "anular"))

    expect(error.code).toBe("42501")
  })

  it("11. aplicar dos veces responde lo mismo; anular algo aplicado se rechaza", async () => {
    const { esc, id } = await porPrecio()

    const primera = await conciliar(db, esc.admin.authId, id, "aplicar")
    const segunda = await conciliar(db, esc.admin.authId, id, "aplicar")
    const error = await fallo(conciliar(db, esc.admin.authId, id, "anular"))

    expect(segunda).toMatchObject({ estado: "ya_aplicada", venta_id: primera.venta_id })
    expect(error.code).toBe("CV002")
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(1)
  })

  it("12. una acción desconocida se rechaza", async () => {
    const { esc, id } = await porPrecio()

    const error = await fallo(conciliar(db, esc.admin.authId, id, "borrar"))

    expect(error.code).toBe("CV001")
  })

  it("13. dos administradores a la vez: una sola venta", async () => {
    const { esc, id } = await porPrecio()
    const otro = await crearVendedor(db, { empresa: esc.empresa })
    await db.query("update usuarios set rol = 'admin' where id = $1", [otro.usuario])
    const aplicar = (c) => c.query("select public.conciliar_venta($1, 'aplicar', 'ok') as r", [id]).then((x) => x.rows[0].r)

    const { respuesta, error } = await enDosSesiones(base, db, {
      primera: { authId: esc.admin.authId, hacer: aplicar },
      segunda: { authId: otro.authId, hacer: aplicar },
    })

    expect(error).toBeUndefined()
    expect(respuesta.estado).toBe("ya_aplicada")
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(1)
  })
})

describe("el teléfono reenvía después de conciliar", () => {
  it("14. reenviar una venta ya aplicada responde ya_registrada con la venta", async () => {
    const { esc, venta, id } = await porPrecio()
    const aplicada = await conciliar(db, esc.admin.authId, id, "aplicar")

    const r = await sincronizar(db, esc.vendedor.authId, venta)

    expect(r).toMatchObject({ estado: "ya_registrada", venta_id: aplicada.venta_id })
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(1)
  })

  it("15. reenviar con otro contenido después de aplicar es OF003", async () => {
    const { esc, venta, id } = await porPrecio()
    await conciliar(db, esc.admin.authId, id, "aplicar")

    const error = await fallo(sincronizar(db, esc.vendedor.authId, { ...venta, nota: "otra" }))

    expect(error.code).toBe("OF003")
  })

  it("16. reenviar una venta anulada responde ya_en_conciliacion y no la resucita", async () => {
    const { esc, venta, id } = await porPrecio()
    await conciliar(db, esc.admin.authId, id, "anular")

    const r = await sincronizar(db, esc.vendedor.authId, venta)

    expect(r).toMatchObject({ estado: "ya_en_conciliacion", conciliacion_id: id, conciliacion_estado: "anulada" })
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(0)
  })
})
