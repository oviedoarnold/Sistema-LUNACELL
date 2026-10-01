/*
  La venta por ubicación, contra PostgreSQL de verdad.

  Nada de esto se puede comprobar con un doble en memoria. Lo que se
  afirma aquí es que el MOTOR serializa, rechaza y deshace: un doble
  serializa lo que se le programe serializar, y la prueba acabaría
  midiendo el orden en que Node despachó dos promesas.

  La mitad de los casos son sobre lo que NO debe pasar —no vender de otro
  camión, no quedar a medias, no abaratarse manipulando el payload— y ésos
  son justo los que un falso verde no delata.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import {
  levantarBase,
  comoUsuario,
  comoDueno,
  esperarBloqueo,
} from "./arnes.mjs"
import { crearEmpresa, crearCliente, contar } from "./fixtures.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

/*
  Una empresa con dos ubicaciones que venden, un almacén, dos productos y
  la existencia repartida que pida el caso.

  Las cantidades por omisión reproducen el ejemplo del encargo: lo que hay
  en el Camión 01 no se puede completar con lo del Camión 02.
*/
async function escenario({
  enCamion1 = 10,
  enCamion2 = 12,
  enBodega = 50,
  precio = 100,
  tasa = 15,
  conUbicacion = true,
  activa = true,
} = {}) {
  const { empresa, usuario, authId } = await crearEmpresa(db)

  await db.query("update empresas set tasa_isv = $1 where id = $2", [
    tasa,
    empresa,
  ])

  const ubicacion = async (nombre, tipo, act = true) =>
    (
      await db.query(
        `insert into ubicaciones (empresa_id, nombre, tipo, activa)
         values ($1, $2, $3, $4) returning id`,
        [empresa, nombre, tipo, act]
      )
    ).rows[0].id

  const camion1 = await ubicacion("Camión 01", "camion", activa)
  const camion2 = await ubicacion("Camión 02", "camion")
  const bodega = await ubicacion("Bodega", "bodega")

  const producto = async (nombre, pr) =>
    (
      await db.query(
        `insert into productos (empresa_id, codigo, nombre, precio, costo)
         values ($1, $2, $3, $4, 10) returning id`,
        [empresa, `C-${Math.random().toString(36).slice(2, 10)}`, nombre, pr]
      )
    ).rows[0].id

  const cargador = await producto("Cargador", precio)
  const cubo = await producto("Cubo Iphone", 50)

  const celda = async (u, p, c) =>
    c === null
      ? null
      : db.query(
          `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
           values ($1, $2, $3, $4)`,
          [empresa, u, p, c]
        )

  await celda(camion1, cargador, enCamion1)
  await celda(camion2, cargador, enCamion2)
  await celda(bodega, cargador, enBodega)
  await celda(camion1, cubo, 4)

  if (conUbicacion) {
    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [
      camion1,
      usuario,
    ])
  }

  const clienteId = await crearCliente(db, empresa)

  return {
    empresa,
    usuario,
    authId,
    camion1,
    camion2,
    bodega,
    cargador,
    cubo,
    clienteId,
  }
}

const renglon = (id, cantidad) => ({ producto_id: id, cantidad })

/* Llama al RPC haciéndose pasar por ese usuario y devuelve lo que responde. */
async function vender(authId, items, extra = {}) {
  await comoUsuario(db, authId)

  try {
    const r = await db.query(
      `select registrar_venta_ubicacion(
         $1::jsonb, $2, $3, $4, $5, $6, $7, $8
       ) as res`,
      [
        JSON.stringify(items),
        extra.forma || "contado",
        extra.cliente || null,
        extra.nombre || null,
        extra.rtn || "",
        extra.vencimiento || null,
        extra.nota || "",
        extra.clave || null,
      ]
    )

    return r.rows[0].res
  } finally {
    await comoDueno(db)
  }
}

const existencia = async (ubicacion, producto) => {
  const r = await db.query(
    `select cantidad from inventario_ubicacion
      where ubicacion_id = $1 and producto_id = $2`,
    [ubicacion, producto]
  )

  return r.rows[0]?.cantidad ?? null
}

// ── LA VENTA QUE FUNCIONA ─────────────────────────────────

describe("la venta normal", () => {
  it("1. vende un producto y devuelve la factura", async () => {
    const e = await escenario()

    const res = await vender(e.authId, [renglon(e.cargador, 2)])

    expect(res.venta_id).toBeTruthy()
    expect(res.numero_factura).toBeTruthy()
    expect(Number(res.total)).toBe(230)
    expect(res.repetida).toBe(false)
  })

  it("2. vende varios productos en la misma factura", async () => {
    const e = await escenario()

    const res = await vender(e.authId, [
      renglon(e.cargador, 2),
      renglon(e.cubo, 1),
    ])

    /* 2×100 + 1×50 = 250, más 15% = 287.50 */
    expect(Number(res.subtotal)).toBe(250)
    expect(Number(res.total)).toBe(287.5)
    expect(await contar(db, "detalle_venta", "venta_id=$1", [res.venta_id])).toBe(2)
  })

  it("3. descuenta solo de la ubicación operativa", async () => {
    const e = await escenario()

    await vender(e.authId, [renglon(e.cargador, 4)])

    expect(await existencia(e.camion1, e.cargador)).toBe(6)
  })

  /*
    El caso del encargo: lo que hay en otro camión no es alcanzable. Si
    esta prueba falla, la venta estaría robando inventario de una ruta
    ajena.
  */
  it("4. las demás ubicaciones quedan intactas", async () => {
    const e = await escenario()

    await vender(e.authId, [renglon(e.cargador, 4)])

    expect(await existencia(e.camion2, e.cargador)).toBe(12)
    expect(await existencia(e.bodega, e.cargador)).toBe(50)
  })

  it("5. se puede vender hasta dejar la celda en cero", async () => {
    const e = await escenario({ enCamion1: 3 })

    await vender(e.authId, [renglon(e.cargador, 3)])

    expect(await existencia(e.camion1, e.cargador)).toBe(0)
  })
})

// ── LO QUE RECHAZA ────────────────────────────────────────

describe("los rechazos", () => {
  it("6. no vende más de lo que hay en su ubicación", async () => {
    const e = await escenario({ enCamion1: 3 })

    await expect(
      vender(e.authId, [renglon(e.cargador, 5)])
    ).rejects.toThrow(/no hay suficiente/i)

    expect(await existencia(e.camion1, e.cargador)).toBe(3)
  })

  /*
    El ejemplo literal del encargo: Camión 01 con 3, Camión 02 con 12,
    se piden 5 desde el Camión 01. No puede completar las 2 que faltan
    con las del otro camión: eso sería un traslado.
  */
  it("7. no completa el faltante desde otra ubicación", async () => {
    const e = await escenario({ enCamion1: 3, enCamion2: 12 })

    await expect(
      vender(e.authId, [renglon(e.cargador, 5)])
    ).rejects.toThrow(/hay 3, se piden 5/i)

    expect(await existencia(e.camion2, e.cargador)).toBe(12)
  })

  it("8. sin celda en esa ubicación, no hay existencia", async () => {
    const e = await escenario()

    /* El cubo solo está en el Camión 01; se vacía su celda. */
    await db.query(
      "delete from inventario_ubicacion where ubicacion_id=$1 and producto_id=$2",
      [e.camion1, e.cubo]
    )

    await expect(
      vender(e.authId, [renglon(e.cubo, 1)])
    ).rejects.toThrow(/hay 0, se piden 1/i)
  })

  it("9. sin ubicación operativa no se puede facturar", async () => {
    const e = await escenario({ conUbicacion: false })

    await expect(
      vender(e.authId, [renglon(e.cargador, 1)])
    ).rejects.toThrow(/ubicación operativa asignada/i)
  })

  it("10. desde una ubicación desactivada tampoco", async () => {
    const e = await escenario()

    /* Se desactiva por detrás: el disparador de la 0015 lo impediría. */
    await db.query(
      "alter table ubicaciones disable trigger ubicaciones_operativa_en_uso"
    )
    await db.query("update ubicaciones set activa = false where id = $1", [
      e.camion1,
    ])
    await db.query(
      "alter table ubicaciones enable trigger ubicaciones_operativa_en_uso"
    )

    await expect(
      vender(e.authId, [renglon(e.cargador, 1)])
    ).rejects.toThrow(/desactivada y no puede facturar/i)
  })

  it("11. un producto de otra empresa no existe para esta venta", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      vender(mia.authId, [renglon(ajena.cargador, 1)])
    ).rejects.toThrow(/no existe o está inactivo/i)

    expect(await existencia(ajena.camion1, ajena.cargador)).toBe(10)
  })

  it("12. un producto inexistente rechaza la venta", async () => {
    const e = await escenario()

    await expect(
      vender(e.authId, [
        renglon("00000000-0000-0000-0000-000000000000", 1),
      ])
    ).rejects.toThrow(/no existe o está inactivo/i)
  })

  it("13. cantidad cero se rechaza", async () => {
    const e = await escenario()

    await expect(
      vender(e.authId, [renglon(e.cargador, 0)])
    ).rejects.toThrow(/mayor que cero/i)
  })

  it("14. cantidad negativa se rechaza", async () => {
    const e = await escenario()

    await expect(
      vender(e.authId, [renglon(e.cargador, -3)])
    ).rejects.toThrow(/mayor que cero/i)
  })

  it("15. una venta sin renglones se rechaza", async () => {
    const e = await escenario()

    await expect(vender(e.authId, [])).rejects.toThrow(/sin renglones|no tiene renglones/i)
  })
})

// ── EL PRODUCTO REPETIDO ──────────────────────────────────

describe("el mismo producto en dos renglones", () => {
  /*
    Dos líneas de 3 no son dos ventas de 3: son una de 6. Tratarlas por
    separado comprobaría 3 contra la existencia dos veces y con 4 unidades
    pasarían las dos, vendiendo 6 de 4.
  */
  it("16. se suman antes de comprobar la existencia", async () => {
    const e = await escenario({ enCamion1: 4 })

    await expect(
      vender(e.authId, [renglon(e.cargador, 3), renglon(e.cargador, 3)])
    ).rejects.toThrow(/hay 4, se piden 6/i)

    expect(await existencia(e.camion1, e.cargador)).toBe(4)
  })

  it("17. y cuando alcanzan, se descuentan juntas una sola vez", async () => {
    const e = await escenario({ enCamion1: 10 })

    const res = await vender(e.authId, [
      renglon(e.cargador, 3),
      renglon(e.cargador, 2),
    ])

    expect(await existencia(e.camion1, e.cargador)).toBe(5)
    expect(await contar(db, "detalle_venta", "venta_id=$1", [res.venta_id])).toBe(1)
    expect(Number(res.subtotal)).toBe(500)
  })
})

// ── EL DINERO LO DECIDE EL MOTOR ──────────────────────────

describe("los importes no llegan del navegador", () => {
  /*
    El precio no viaja en el payload: se lee de productos dentro de la
    transacción. Estas tres pruebas mandan basura en campos que la
    función no debería ni mirar, y comprueban que el resultado es el
    mismo.
  */
  it("18. un precio enviado por el cliente no abarata la venta", async () => {
    const e = await escenario({ precio: 100 })

    const res = await vender(e.authId, [
      { producto_id: e.cargador, cantidad: 2, precio: 1 },
    ])

    expect(Number(res.subtotal)).toBe(200)
    expect(Number(res.total)).toBe(230)
  })

  it("19. un total enviado por el cliente se ignora", async () => {
    const e = await escenario()

    const res = await vender(e.authId, [
      { producto_id: e.cargador, cantidad: 2, total: 1, subtotal: 1 },
    ])

    expect(Number(res.total)).toBe(230)

    const v = await db.query("select total, subtotal from ventas where id=$1", [
      res.venta_id,
    ])

    expect(Number(v.rows[0].total)).toBe(230)
  })

  it("20. el ISV sale de la empresa, no del payload", async () => {
    const e = await escenario({ tasa: 18 })

    const res = await vender(e.authId, [
      { producto_id: e.cargador, cantidad: 1, isv: 0, tasa_isv: 0 },
    ])

    expect(Number(res.isv)).toBe(18)
    expect(Number(res.total)).toBe(118)
  })

  it("21. el precio guardado en el detalle es el del catálogo", async () => {
    const e = await escenario({ precio: 100 })

    const res = await vender(e.authId, [
      { producto_id: e.cargador, cantidad: 1, precio: 1 },
    ])

    const d = await db.query(
      "select precio, subtotal from detalle_venta where venta_id=$1",
      [res.venta_id]
    )

    expect(Number(d.rows[0].precio)).toBe(100)
    expect(Number(d.rows[0].subtotal)).toBe(100)
  })
})

// ── CONTADO Y CRÉDITO ─────────────────────────────────────

describe("contado y crédito", () => {
  it("22. una venta al contado queda pagada", async () => {
    const e = await escenario()

    const res = await vender(e.authId, [renglon(e.cargador, 1)])
    const v = await db.query(
      "select estado, forma_pago, fecha_vencimiento from ventas where id=$1",
      [res.venta_id]
    )

    expect(v.rows[0].estado).toBe("pagada")
    expect(v.rows[0].forma_pago).toBe("contado")
    expect(v.rows[0].fecha_vencimiento).toBeNull()
  })

  it("23. una venta a crédito queda pendiente y con vencimiento", async () => {
    const e = await escenario()

    const res = await vender(e.authId, [renglon(e.cargador, 1)], {
      forma: "credito",
      cliente: e.clienteId,
      vencimiento: "2027-01-31",
    })

    const v = await db.query(
      "select estado, forma_pago, cliente_id, fecha_vencimiento from ventas where id=$1",
      [res.venta_id]
    )

    expect(v.rows[0].estado).toBe("pendiente")
    expect(v.rows[0].cliente_id).toBe(e.clienteId)
    expect(v.rows[0].fecha_vencimiento).toBeTruthy()
  })

  it("24. a crédito sin cliente se rechaza", async () => {
    const e = await escenario()

    await expect(
      vender(e.authId, [renglon(e.cargador, 1)], { forma: "credito" })
    ).rejects.toThrow(/cliente registrado/i)
  })

  it("25. un cliente de otra empresa se rechaza", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      vender(mia.authId, [renglon(mia.cargador, 1)], {
        forma: "credito",
        cliente: ajena.clienteId,
      })
    ).rejects.toThrow(/no existe en esta empresa/i)
  })

  it("26. sin nombre de cliente queda Consumidor Final", async () => {
    const e = await escenario()

    const res = await vender(e.authId, [renglon(e.cargador, 1)])
    const v = await db.query("select nombre_cliente from ventas where id=$1", [
      res.venta_id,
    ])

    expect(v.rows[0].nombre_cliente).toBe("Consumidor Final")
  })
})

// ── ATOMICIDAD ────────────────────────────────────────────

describe("o entra todo o no entra nada", () => {
  /*
    El caso obligatorio: un producto alcanza y el otro no. No puede
    venderse el primero «mientras tanto».
  */
  it("27. un producto insuficiente deshace toda la venta", async () => {
    const e = await escenario({ enCamion1: 10 })

    const ventasAntes = await contar(db, "ventas")

    await expect(
      vender(e.authId, [renglon(e.cargador, 2), renglon(e.cubo, 99)])
    ).rejects.toThrow(/no hay suficiente/i)

    expect(await contar(db, "ventas")).toBe(ventasAntes)
    expect(await existencia(e.camion1, e.cargador)).toBe(10)
    expect(await existencia(e.camion1, e.cubo)).toBe(4)
  })

  it("28. un rechazo no deja detalle ni movimientos huérfanos", async () => {
    const e = await escenario({ enCamion1: 1 })

    const detalleAntes = await contar(db, "detalle_venta")
    const movAntes = await contar(db, "movimientos_inventario")

    await expect(
      vender(e.authId, [renglon(e.cargador, 99)])
    ).rejects.toThrow()

    expect(await contar(db, "detalle_venta")).toBe(detalleAntes)
    expect(await contar(db, "movimientos_inventario")).toBe(movAntes)
  })

  /*
    El correlativo se pide DENTRO de la transacción, así que una venta
    rechazada no quema un número de la numeración autorizada. En el flujo
    anterior sí lo quemaba.
  */
  it("29. una venta rechazada no consume correlativo", async () => {
    const e = await escenario({ enCamion1: 1 })

    const antes = (
      await db.query(
        "select proximo_correlativo_factura as n from empresas where id=$1",
        [e.empresa]
      )
    ).rows[0].n

    await expect(vender(e.authId, [renglon(e.cargador, 99)])).rejects.toThrow()

    const despues = (
      await db.query(
        "select proximo_correlativo_factura as n from empresas where id=$1",
        [e.empresa]
      )
    ).rows[0].n

    expect(despues).toBe(antes)
  })
})

// ── IDEMPOTENCIA ──────────────────────────────────────────

describe("idempotencia", () => {
  it("30. el mismo intento repetido no vende dos veces", async () => {
    const e = await escenario({ enCamion1: 10 })
    const clave = "venta-" + Math.random().toString(36).slice(2)

    const a = await vender(e.authId, [renglon(e.cargador, 2)], { clave })
    const b = await vender(e.authId, [renglon(e.cargador, 2)], { clave })

    expect(b.venta_id).toBe(a.venta_id)
    expect(b.repetida).toBe(true)
    expect(await existencia(e.camion1, e.cargador)).toBe(8)
  })

  it("31. tampoco duplica el detalle ni los movimientos", async () => {
    const e = await escenario()
    const clave = "venta-" + Math.random().toString(36).slice(2)

    const a = await vender(e.authId, [renglon(e.cargador, 1)], { clave })
    await vender(e.authId, [renglon(e.cargador, 1)], { clave })

    expect(await contar(db, "detalle_venta", "venta_id=$1", [a.venta_id])).toBe(1)
    expect(
      await contar(db, "movimientos_inventario", "venta_id=$1", [a.venta_id])
    ).toBe(1)
  })

  /*
    Reutilizar la clave con otra intención no es un reintento: es un error
    de quien llama. Devolverle la venta vieja se lo disfrazaría de éxito y
    el cliente se quedaría sin la mercadería que pidió.
  */
  it("32. la misma clave con otros productos se rechaza", async () => {
    const e = await escenario()
    const clave = "venta-" + Math.random().toString(36).slice(2)

    await vender(e.authId, [renglon(e.cargador, 1)], { clave })

    await expect(
      vender(e.authId, [renglon(e.cubo, 1)], { clave })
    ).rejects.toThrow(/ya se usó para una venta distinta/i)
  })

  it("33. la misma clave con otra cantidad se rechaza", async () => {
    const e = await escenario()
    const clave = "venta-" + Math.random().toString(36).slice(2)

    await vender(e.authId, [renglon(e.cargador, 1)], { clave })

    await expect(
      vender(e.authId, [renglon(e.cargador, 2)], { clave })
    ).rejects.toThrow(/ya se usó para una venta distinta/i)
  })

  it("34. la misma clave cambiando a crédito se rechaza", async () => {
    const e = await escenario()
    const clave = "venta-" + Math.random().toString(36).slice(2)

    await vender(e.authId, [renglon(e.cargador, 1)], { clave })

    await expect(
      vender(e.authId, [renglon(e.cargador, 1)], {
        clave,
        forma: "credito",
        cliente: e.clienteId,
      })
    ).rejects.toThrow(/ya se usó para una venta distinta/i)
  })
})

// ── TRAZABILIDAD ──────────────────────────────────────────

describe("de dónde salió la mercadería", () => {
  it("35. la venta guarda su ubicación", async () => {
    const e = await escenario()

    const res = await vender(e.authId, [renglon(e.cargador, 1)])
    const v = await db.query(
      "select ubicacion_id, usuario_id from ventas where id=$1",
      [res.venta_id]
    )

    expect(v.rows[0].ubicacion_id).toBe(e.camion1)
    expect(v.rows[0].usuario_id).toBe(e.usuario)
  })

  it("36. cada movimiento guarda su ubicación y su venta", async () => {
    const e = await escenario()

    const res = await vender(e.authId, [renglon(e.cargador, 2)])
    const m = await db.query(
      `select ubicacion_id, cantidad, tipo, motivo, producto_id, usuario_id
         from movimientos_inventario where venta_id = $1`,
      [res.venta_id]
    )

    expect(m.rows).toHaveLength(1)
    expect(m.rows[0].ubicacion_id).toBe(e.camion1)
    expect(m.rows[0].cantidad).toBe(-2)
    expect(m.rows[0].tipo).toBe("salida")
    expect(m.rows[0].usuario_id).toBe(e.usuario)
  })
})

// ── EL NÚMERO DE FACTURA ──────────────────────────────────

describe("el número de factura", () => {
  it("37. sin numeración autorizada sale como FAC-00001", async () => {
    const e = await escenario()

    await db.query(
      "update empresas set cai = '', rango_hasta = null, fecha_limite_emision = null where id = $1",
      [e.empresa]
    )

    const res = await vender(e.authId, [renglon(e.cargador, 1)])

    expect(res.numero_factura).toMatch(/^FAC-\d{5}$/)
  })

  /*
    Con CAI, rango y fecha límite, el número toma la forma fiscal
    establecimiento-punto-tipo-correlativo, con el correlativo a ocho
    dígitos. Es el mismo formato que arma utils/fiscal.js.
  */
  it("38. con numeración autorizada toma la forma fiscal", async () => {
    const e = await escenario()

    await db.query(
      `update empresas
          set cai = 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-12',
              rango_desde = 1, rango_hasta = 5000,
              fecha_limite_emision = '2027-12-31',
              establecimiento = '7', punto_emision = '25',
              tipo_documento = '1'
        where id = $1`,
      [e.empresa]
    )

    const res = await vender(e.authId, [renglon(e.cargador, 1)])

    /* soloDigitos rellena con ceros a la izquierda: 7 → 007, 25 → 025. */
    expect(res.numero_factura).toMatch(/^007-025-01-\d{8}$/)
  })

  it("39. la factura guarda el CAI y el rango vigentes", async () => {
    const e = await escenario()

    await db.query(
      `update empresas set cai = 'CAI-PRUEBA', rango_desde = 1,
              rango_hasta = 5000, fecha_limite_emision = '2027-12-31'
        where id = $1`,
      [e.empresa]
    )

    const res = await vender(e.authId, [renglon(e.cargador, 1)])
    const v = await db.query(
      "select cai_emision, rango_hasta_emision from ventas where id=$1",
      [res.venta_id]
    )

    expect(v.rows[0].cai_emision).toBe("CAI-PRUEBA")
    expect(Number(v.rows[0].rango_hasta_emision)).toBe(5000)
  })
})

// ── PERMISOS ──────────────────────────────────────────────

describe("quién puede ejecutarla", () => {
  it("40. anon no puede facturar", async () => {
    const r = await db.query(
      `select has_function_privilege('anon',
         'registrar_venta_ubicacion(jsonb,text,uuid,text,text,date,text,text)',
         'EXECUTE') as puede`
    )

    expect(r.rows[0].puede).toBe(false)
  })

  it("41. authenticated sí, y service_role también", async () => {
    const r = await db.query(
      `select
         has_function_privilege('authenticated',
           'registrar_venta_ubicacion(jsonb,text,uuid,text,text,date,text,text)',
           'EXECUTE') as autenticado,
         has_function_privilege('service_role',
           'registrar_venta_ubicacion(jsonb,text,uuid,text,text,date,text,text)',
           'EXECUTE') as servicio`
    )

    expect(r.rows[0].autenticado).toBe(true)
    expect(r.rows[0].servicio).toBe(true)
  })

  it("42. sin sesión no hay empresa y no se puede facturar", async () => {
    const e = await escenario()

    await comoUsuario(db, null)

    await expect(
      db.query(
        `select registrar_venta_ubicacion($1::jsonb) as res`,
        [JSON.stringify([renglon(e.cargador, 1)])]
      )
    ).rejects.toThrow()

    await comoDueno(db)
  })
})

// ── CONCURRENCIA REAL ─────────────────────────────────────

describe("concurrencia", () => {
  /*
    El caso del encargo: 10 en el camión, dos ventas de 7 a la vez.

    La prueba no mira el resultado y confía: espera a que PostgreSQL
    confirme, en pg_stat_activity, que la segunda sesión está DETENIDA
    esperando un candado. Si la función no serializara, B no se detendría,
    esa espera agotaría su tiempo y el caso fallaría.
  */
  it("43. dos ventas de 7 sobre 10: solo una entra", async () => {
    const e = await escenario({ enCamion1: 10 })

    const a = await base.conectar()
    const b = await base.conectar()

    try {
      await comoUsuario(a, e.authId)
      await comoUsuario(b, e.authId)

      const pidB = (await b.query("select pg_backend_pid() as pid")).rows[0].pid

      await a.query("begin")
      await b.query("begin")

      /* A toma el candado de la celda y descuenta, pero NO confirma. */
      const ra = await a.query(
        "select registrar_venta_ubicacion($1::jsonb) as res",
        [JSON.stringify([renglon(e.cargador, 7)])]
      )
      expect(Number(ra.rows[0].res.total)).toBe(805)

      /* B sale ahora, con A todavía sin confirmar. */
      const pb = b.query(
        "select registrar_venta_ubicacion($1::jsonb) as res",
        [JSON.stringify([renglon(e.cargador, 7)])]
      )

      /*
        La observadora es `db`, la conexión del dueño, y no `a`: `a` está
        bajo `set role authenticated`, y un rol sin privilegios no ve el
        estado ni el wait_event de las sesiones ajenas en
        pg_stat_activity —los recibe en NULL—, así que la espera nunca se
        daría por cumplida aunque B estuviera detenida de verdad.
      */
      const espera = await esperarBloqueo(db, pidB)
      expect(espera).toMatch(/^Lock\//)

      await a.query("commit")

      /*
        Al soltarse el candado, B relee la celda —ahora 3— y rechaza.
        Si leyera el valor viejo, vendería 7 de 3.
      */
      await expect(pb).rejects.toThrow(/hay 3, se piden 7/i)

      await b.query("rollback")
    } finally {
      await a.end()
      await b.end()
    }

    expect(await existencia(e.camion1, e.cargador)).toBe(3)
    expect(
      await contar(db, "inventario_ubicacion", "cantidad < 0")
    ).toBe(0)
  })

  it("44. dos reintentos simultáneos con la misma clave crean una sola venta", async () => {
    const e = await escenario({ enCamion1: 10 })
    const clave = "venta-" + Math.random().toString(36).slice(2)

    const a = await base.conectar()
    const b = await base.conectar()

    try {
      await comoUsuario(a, e.authId)
      await comoUsuario(b, e.authId)

      const resultados = await Promise.allSettled([
        a.query(
          "select registrar_venta_ubicacion($1::jsonb, 'contado', null, null, '', null, '', $2) as res",
          [JSON.stringify([renglon(e.cargador, 2)]), clave]
        ),
        b.query(
          "select registrar_venta_ubicacion($1::jsonb, 'contado', null, null, '', null, '', $2) as res",
          [JSON.stringify([renglon(e.cargador, 2)]), clave]
        ),
      ])

      const ok = resultados.filter((r) => r.status === "fulfilled")

      /*
        O las dos devuelven la misma venta —la segunda como repetida— o
        una choca contra el índice único. Lo que no puede pasar es que
        haya dos ventas o que se descuente dos veces.
      */
      expect(ok.length).toBeGreaterThanOrEqual(1)
    } finally {
      await a.end()
      await b.end()
    }

    expect(
      await contar(db, "ventas", "empresa_id=$1 and clave_idempotencia=$2", [
        e.empresa,
        clave,
      ])
    ).toBe(1)

    expect(await existencia(e.camion1, e.cargador)).toBe(8)
  })

  /*
    El correlativo ya se protegía solo: siguiente_correlativo() avanza el
    contador con un UPDATE ... RETURNING, que toma el candado de la fila de
    la empresa. Esta prueba lo fija para que nadie lo sustituya por una
    lectura seguida de una escritura.
  */
  it("45. dos ventas concurrentes no reciben el mismo número", async () => {
    const e = await escenario({ enCamion1: 10 })

    const a = await base.conectar()
    const b = await base.conectar()

    try {
      await comoUsuario(a, e.authId)
      await comoUsuario(b, e.authId)

      const [ra, rb] = await Promise.all([
        a.query("select registrar_venta_ubicacion($1::jsonb) as res", [
          JSON.stringify([renglon(e.cargador, 1)]),
        ]),
        b.query("select registrar_venta_ubicacion($1::jsonb) as res", [
          JSON.stringify([renglon(e.cargador, 1)]),
        ]),
      ])

      expect(ra.rows[0].res.correlativo).not.toBe(rb.rows[0].res.correlativo)
      expect(ra.rows[0].res.numero_factura).not.toBe(
        rb.rows[0].res.numero_factura
      )
    } finally {
      await a.end()
      await b.end()
    }
  })
})

// ── AISLAMIENTO ENTRE EMPRESAS ────────────────────────────

describe("aislamiento entre empresas", () => {
  it("46. la venta se registra siempre en la empresa del que vende", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    const res = await vender(mia.authId, [renglon(mia.cargador, 1)])
    const v = await db.query("select empresa_id from ventas where id=$1", [
      res.venta_id,
    ])

    expect(v.rows[0].empresa_id).toBe(mia.empresa)
    expect(v.rows[0].empresa_id).not.toBe(ajena.empresa)
  })

  it("47. vender no toca el inventario de la otra empresa", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await vender(mia.authId, [renglon(mia.cargador, 3)])

    expect(await existencia(ajena.camion1, ajena.cargador)).toBe(10)
    expect(await existencia(ajena.camion2, ajena.cargador)).toBe(12)
  })
})
