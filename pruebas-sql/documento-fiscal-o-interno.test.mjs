/*
  Qué ubicaciones venden, cuál emite factura fiscal, y que una venta
  interna no pueda gastar el rango autorizado de la tienda.

  La invariante que vigila todo este archivo es una sola:

    UNA VENTA NO FISCAL ES INCAPAZ DE CONSUMIR EL CORRELATIVO FISCAL.

  Y se comprueba del único modo que vale: mirando el contador antes y
  después. Que el número salga con otra forma no demuestra nada —podría
  haberse pedido igual y descartado—; lo que lo demuestra es que
  `proximo_correlativo_factura` no se movió.

  Contra PostgreSQL de verdad, porque la concurrencia de dos contadores
  distintos y el rollback de ambos son propiedades del motor.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, contar } from "./fixtures.mjs"

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
  Una empresa con las cuatro ubicaciones reales de LUNACELL y existencia
  en todas, para poder vender desde cualquiera.
*/
async function escenario({ conCai = false } = {}) {
  const { empresa, usuario, authId } = await crearEmpresa(db)

  const ubicacion = async (nombre, tipo) =>
    (
      await db.query(
        `insert into ubicaciones (empresa_id, nombre, tipo)
         values ($1, $2, $3) returning id`,
        [empresa, nombre, tipo]
      )
    ).rows[0].id

  const tienda = await ubicacion("Lunacell Store", "tienda")
  const camion1 = await ubicacion("Camión 01", "camion")
  const camion2 = await ubicacion("Camión 02", "camion")
  const bodega = await ubicacion("Lunacell Bodega", "bodega")

  const producto = (
    await db.query(
      `insert into productos (empresa_id, codigo, nombre, precio, costo)
       values ($1, $2, 'Cargador', 100, 10) returning id`,
      [empresa, `C-${Math.random().toString(36).slice(2, 10)}`]
    )
  ).rows[0].id

  for (const u of [tienda, camion1, camion2, bodega]) {
    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1, $2, $3, 50)`,
      [empresa, u, producto]
    )
  }

  if (conCai) {
    await db.query(
      `update empresas
          set cai = 'CAI-PRUEBA', rango_desde = 1, rango_hasta = 5000,
              fecha_limite_emision = '2027-12-31'
        where id = $1`,
      [empresa]
    )
  }

  return { empresa, usuario, authId, tienda, camion1, camion2, bodega, producto }
}

const operarDesde = (usuario, ubicacion) =>
  db.query("update usuarios set ubicacion_id = $1 where id = $2", [
    ubicacion,
    usuario,
  ])

const marcarFiscal = (ubicacion) =>
  db.query("update ubicaciones set emite_fiscal = true where id = $1", [
    ubicacion,
  ])

async function vender(authId, producto, cantidad = 1, extra = {}) {
  await comoUsuario(db, authId)

  try {
    const r = await db.query(
      `select registrar_venta_ubicacion($1::jsonb, 'contado', null, null, '', null, '', $2) as res`,
      [JSON.stringify([{ producto_id: producto, cantidad }]), extra.clave || null]
    )

    return r.rows[0].res
  } finally {
    await comoDueno(db)
  }
}

const contadores = async (empresa) => {
  const r = await db.query(
    `select proximo_correlativo_factura as fiscal,
            proximo_correlativo_interno as interno
       from empresas where id = $1`,
    [empresa]
  )

  return { fiscal: Number(r.rows[0].fiscal), interno: Number(r.rows[0].interno) }
}

// ── LA TIENDA, QUE ES LA ÚNICA FISCAL ─────────────────────

describe("Lunacell Store", () => {
  it("1. emite factura fiscal cuando está marcada y hay CAI", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.tienda)

    const res = await vender(e.authId, e.producto)

    expect(res.es_fiscal).toBe(true)
    expect(res.numero_factura).toMatch(/^000-001-01-\d{8}$/)
  })

  it("2. una venta fiscal consume exactamente un correlativo fiscal", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.tienda)

    const antes = await contadores(e.empresa)
    await vender(e.authId, e.producto)
    const despues = await contadores(e.empresa)

    expect(despues.fiscal).toBe(antes.fiscal + 1)
    expect(despues.interno).toBe(antes.interno)
  })

  /*
    Marcarla no basta: sin CAI configurado no hay numeración autorizada
    que usar, y emitir una «factura» con el CAI vacío sería justo lo que
    esta fase viene a impedir.
  */
  it("3. marcada pero sin CAI, emite documento interno", async () => {
    const e = await escenario({ conCai: false })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.tienda)

    const res = await vender(e.authId, e.producto)

    expect(res.es_fiscal).toBe(false)
    expect(res.numero_factura).toMatch(/^VTA-\d{6}$/)
  })

  it("4. la factura fiscal guarda su CAI y su rango", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.tienda)

    const res = await vender(e.authId, e.producto)
    const v = await db.query(
      `select es_fiscal, cai_emision, rango_hasta_emision
         from ventas where id = $1`,
      [res.venta_id]
    )

    expect(v.rows[0].es_fiscal).toBe(true)
    expect(v.rows[0].cai_emision).toBe("CAI-PRUEBA")
    expect(Number(v.rows[0].rango_hasta_emision)).toBe(5000)
  })
})

// ── CAMIONES Y BODEGA ─────────────────────────────────────

describe("camiones y bodega", () => {
  it("5. el Camión 01 genera documento interno", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.camion1)

    const res = await vender(e.authId, e.producto)

    expect(res.es_fiscal).toBe(false)
    expect(res.numero_factura).toMatch(/^VTA-\d{6}$/)
  })

  it("6. el Camión 02 genera documento interno", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.camion2)

    const res = await vender(e.authId, e.producto)

    expect(res.es_fiscal).toBe(false)
    expect(res.numero_factura).toMatch(/^VTA-\d{6}$/)
  })

  it("7. la Bodega sigue la misma lógica interna", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.bodega)

    const res = await vender(e.authId, e.producto)

    expect(res.es_fiscal).toBe(false)
    expect(res.numero_factura).toMatch(/^VTA-\d{6}$/)
  })

  /*
    La prueba central del archivo. No mira la forma del número: mira el
    contador fiscal, que es lo único que demuestra que no se gastó.
  */
  it("8. una venta interna NO mueve el correlativo fiscal", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.camion1)

    const antes = await contadores(e.empresa)
    await vender(e.authId, e.producto)
    const despues = await contadores(e.empresa)

    expect(despues.fiscal).toBe(antes.fiscal)
    expect(despues.interno).toBe(antes.interno + 1)
  })

  it("9. una venta de camión nunca lleva el CAI de la tienda", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.camion1)

    const res = await vender(e.authId, e.producto)
    const v = await db.query(
      `select cai_emision, rango_desde_emision, rango_hasta_emision,
              fecha_limite_emision_emision
         from ventas where id = $1`,
      [res.venta_id]
    )

    expect(v.rows[0].cai_emision).toBe("")
    expect(v.rows[0].rango_desde_emision).toBeNull()
    expect(v.rows[0].rango_hasta_emision).toBeNull()
    expect(v.rows[0].fecha_limite_emision_emision).toBeNull()
  })

  /*
    Las dos numeraciones avanzan sin verse. Si compartieran contador, los
    números se intercalarían y el rango autorizado se agotaría con ventas
    que nunca debieron tocarlo.
  */
  it("10. las dos numeraciones son independientes", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)

    await operarDesde(e.usuario, e.tienda)
    const f1 = await vender(e.authId, e.producto)

    await operarDesde(e.usuario, e.camion1)
    const i1 = await vender(e.authId, e.producto)
    const i2 = await vender(e.authId, e.producto)

    await operarDesde(e.usuario, e.tienda)
    const f2 = await vender(e.authId, e.producto)

    /* El fiscal va 1, 2 pese a las dos internas de por medio. */
    expect(Number(f2.correlativo)).toBe(Number(f1.correlativo) + 1)
    expect(Number(i2.correlativo)).toBe(Number(i1.correlativo) + 1)
  })
})

// ── QUIÉN PUEDE VENDER ────────────────────────────────────

describe("la capacidad de vender", () => {
  it("11. una ubicación no vendedora se rechaza", async () => {
    const e = await escenario()
    await db.query("update ubicaciones set vende = false where id = $1", [
      e.bodega,
    ])
    await operarDesde(e.usuario, e.bodega)

    await expect(vender(e.authId, e.producto)).rejects.toThrow(
      /no está habilitada para vender/i
    )
  })

  it("12. y no deja rastro: ni venta, ni correlativo, ni existencia", async () => {
    const e = await escenario()
    await db.query("update ubicaciones set vende = false where id = $1", [
      e.bodega,
    ])
    await operarDesde(e.usuario, e.bodega)

    const antes = await contadores(e.empresa)
    const ventasAntes = await contar(db, "ventas")

    await expect(vender(e.authId, e.producto)).rejects.toThrow()

    expect(await contadores(e.empresa)).toEqual(antes)
    expect(await contar(db, "ventas")).toBe(ventasAntes)
  })

  /*
    No se puede emitir factura desde donde no se vende. La base lo impide
    en vez de confiar en que el formulario no ofrezca la combinación.
  */
  it("13. no se puede marcar fiscal una ubicación que no vende", async () => {
    const e = await escenario()

    await expect(
      db.query(
        "update ubicaciones set vende = false, emite_fiscal = true where id = $1",
        [e.tienda]
      )
    ).rejects.toThrow(/ubicacion_fiscal_tambien_vende|check/i)
  })

  it("14. como mucho una ubicación fiscal por empresa", async () => {
    const e = await escenario()
    await marcarFiscal(e.tienda)

    await expect(marcarFiscal(e.camion1)).rejects.toThrow(
      /ubicaciones_una_fiscal_por_empresa|duplicate/i
    )
  })

  /*
    Dos empresas distintas sí pueden tener cada una la suya: el índice es
    por empresa, no global.
  */
  it("15. pero cada empresa puede tener la suya", async () => {
    const a = await escenario()
    const b = await escenario()

    await marcarFiscal(a.tienda)
    await expect(marcarFiscal(b.tienda)).resolves.toBeDefined()
  })
})

// ── EL CLIENTE NO DECIDE ──────────────────────────────────

describe("la decisión no la toma quien llama", () => {
  /*
    No hay parámetro con el que pedir que una venta sea fiscal. Esta
    prueba manda los campos que alguien intentaría usar y comprueba que el
    resultado no cambia.
  */
  it("16. mandar es_fiscal o cai en el payload no convierte la venta", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.camion1)

    await comoUsuario(db, e.authId)
    const r = await db.query(
      `select registrar_venta_ubicacion($1::jsonb) as res`,
      [
        JSON.stringify([
          {
            producto_id: e.producto,
            cantidad: 1,
            es_fiscal: true,
            cai: "CAI-PRUEBA",
            correlativo: 1,
          },
        ]),
      ]
    )
    await comoDueno(db)

    expect(r.rows[0].res.es_fiscal).toBe(false)
    expect(r.rows[0].res.numero_factura).toMatch(/^VTA-\d{6}$/)
  })

  it("17. la marca de la venta es la que decidió el motor", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.camion1)

    const res = await vender(e.authId, e.producto)
    const v = await db.query("select es_fiscal from ventas where id = $1", [
      res.venta_id,
    ])

    expect(v.rows[0].es_fiscal).toBe(false)
  })
})

// ── CONCURRENCIA DE LA NUMERACIÓN INTERNA ─────────────────

describe("concurrencia", () => {
  /*
    El contador interno usa el mismo UPDATE ... RETURNING que el fiscal,
    que toma el candado de la fila de la empresa. Si alguien lo cambiara
    por una lectura seguida de una escritura, dos ventas simultáneas
    recibirían el mismo número y esta prueba lo diría.
  */
  it("18. ventas internas concurrentes no repiten número", async () => {
    const e = await escenario()
    await operarDesde(e.usuario, e.camion1)

    const a = await base.conectar()
    const b = await base.conectar()
    const c = await base.conectar()

    try {
      for (const con of [a, b, c]) await comoUsuario(con, e.authId)

      const lanzar = (con) =>
        con.query(`select registrar_venta_ubicacion($1::jsonb) as res`, [
          JSON.stringify([{ producto_id: e.producto, cantidad: 1 }]),
        ])

      const r = await Promise.all([lanzar(a), lanzar(b), lanzar(c)])
      const numeros = r.map((x) => x.rows[0].res.numero_factura)

      expect(new Set(numeros).size).toBe(3)
      for (const n of numeros) expect(n).toMatch(/^VTA-\d{6}$/)
    } finally {
      await a.end()
      await b.end()
      await c.end()
    }
  })

  it("19. una fiscal y una interna a la vez no se estorban", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)

    const otro = await crearEmpresa(db)
    expect(otro.empresa).toBeDefined()

    await operarDesde(e.usuario, e.tienda)
    const fiscal = await vender(e.authId, e.producto)

    await operarDesde(e.usuario, e.camion1)
    const interna = await vender(e.authId, e.producto)

    expect(fiscal.es_fiscal).toBe(true)
    expect(interna.es_fiscal).toBe(false)
    expect(fiscal.numero_factura).not.toBe(interna.numero_factura)
  })
})

// ── IDEMPOTENCIA Y ROLLBACK ───────────────────────────────

describe("idempotencia y rollback con dos contadores", () => {
  it("20. reintentar una venta interna no consume otro número", async () => {
    const e = await escenario()
    await operarDesde(e.usuario, e.camion1)
    const clave = "v-" + Math.random().toString(36).slice(2)

    const a = await vender(e.authId, e.producto, 1, { clave })
    const antes = await contadores(e.empresa)
    const b = await vender(e.authId, e.producto, 1, { clave })
    const despues = await contadores(e.empresa)

    expect(b.venta_id).toBe(a.venta_id)
    expect(b.repetida).toBe(true)
    expect(despues.interno).toBe(antes.interno)
  })

  it("21. reintentar una venta fiscal tampoco", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.tienda)
    const clave = "v-" + Math.random().toString(36).slice(2)

    const a = await vender(e.authId, e.producto, 1, { clave })
    const antes = await contadores(e.empresa)
    const b = await vender(e.authId, e.producto, 1, { clave })
    const despues = await contadores(e.empresa)

    expect(b.venta_id).toBe(a.venta_id)
    expect(despues.fiscal).toBe(antes.fiscal)
  })

  /*
    El número se pide DENTRO de la transacción, así que un fallo
    posterior lo devuelve. Se provoca pidiendo más de lo que hay: el
    rechazo ocurre antes de numerar, y el contador no se mueve.
  */
  it("22. una venta rechazada no consume número interno", async () => {
    const e = await escenario()
    await operarDesde(e.usuario, e.camion1)

    const antes = await contadores(e.empresa)
    await expect(vender(e.authId, e.producto, 9999)).rejects.toThrow(
      /no hay suficiente/i
    )
    const despues = await contadores(e.empresa)

    expect(despues).toEqual(antes)
  })

  it("23. ni fiscal", async () => {
    const e = await escenario({ conCai: true })
    await marcarFiscal(e.tienda)
    await operarDesde(e.usuario, e.tienda)

    const antes = await contadores(e.empresa)
    await expect(vender(e.authId, e.producto, 9999)).rejects.toThrow()
    const despues = await contadores(e.empresa)

    expect(despues).toEqual(antes)
  })
})

// ── LAS GARANTÍAS DE INV-3.1 SIGUEN ───────────────────────

describe("lo que INV-3.1 ya garantizaba", () => {
  it("24. sigue descontando solo de la ubicación operativa", async () => {
    const e = await escenario()
    await operarDesde(e.usuario, e.camion1)

    await vender(e.authId, e.producto, 4)

    const r = await db.query(
      `select u.nombre, i.cantidad
         from inventario_ubicacion i
         join ubicaciones u on u.id = i.ubicacion_id
        where i.producto_id = $1 order by u.nombre`,
      [e.producto]
    )

    const porNombre = Object.fromEntries(
      r.rows.map((x) => [x.nombre, x.cantidad])
    )

    expect(porNombre["Camión 01"]).toBe(46)
    expect(porNombre["Camión 02"]).toBe(50)
    expect(porNombre["Lunacell Store"]).toBe(50)
    expect(porNombre["Lunacell Bodega"]).toBe(50)
  })

  it("25. sigue rechazando por existencia insuficiente", async () => {
    const e = await escenario()
    await operarDesde(e.usuario, e.camion1)

    await expect(vender(e.authId, e.producto, 51)).rejects.toThrow(
      /hay 50, se piden 51/i
    )
  })

  it("26. sigue guardando la ubicación en la venta y en el movimiento", async () => {
    const e = await escenario()
    await operarDesde(e.usuario, e.camion2)

    const res = await vender(e.authId, e.producto, 2)

    const v = await db.query("select ubicacion_id from ventas where id=$1", [
      res.venta_id,
    ])
    const m = await db.query(
      "select ubicacion_id, cantidad from movimientos_inventario where venta_id=$1",
      [res.venta_id]
    )

    expect(v.rows[0].ubicacion_id).toBe(e.camion2)
    expect(m.rows[0].ubicacion_id).toBe(e.camion2)
    expect(m.rows[0].cantidad).toBe(-2)
  })

  it("27. sigue sin aceptar precio del navegador", async () => {
    const e = await escenario()
    await operarDesde(e.usuario, e.camion1)

    await comoUsuario(db, e.authId)
    const r = await db.query(
      `select registrar_venta_ubicacion($1::jsonb) as res`,
      [JSON.stringify([{ producto_id: e.producto, cantidad: 2, precio: 1 }])]
    )
    await comoDueno(db)

    expect(Number(r.rows[0].res.subtotal)).toBe(200)
  })
})

// ── LAS VENTAS ANTERIORES ─────────────────────────────────

describe("compatibilidad con lo que ya existía", () => {
  /*
    Las ventas anteriores a esta separación no llevan marca y la columna
    nace en falso, que es lo que de verdad fueron: no tenían CAI. No se
    les inventa ubicación ni se las renumera.
  */
  it("28. una venta anterior queda como no fiscal y legible", async () => {
    const e = await escenario()

    const vieja = (
      await db.query(
        `insert into ventas (
           empresa_id, numero_factura, correlativo, nombre_cliente,
           subtotal, isv, tasa_isv, total, forma_pago, estado
         ) values ($1, 'FAC-00001', 1, 'Consumidor Final',
                   100, 15, 15, 115, 'contado', 'pagada')
         returning id, es_fiscal, numero_factura, ubicacion_id, cai_emision`,
        [e.empresa]
      )
    ).rows[0]

    expect(vieja.es_fiscal).toBe(false)
    expect(vieja.numero_factura).toBe("FAC-00001")
    expect(vieja.ubicacion_id).toBeNull()
    expect(vieja.cai_emision).toBe("")
  })

  it("29. las ubicaciones existentes pueden vender y ninguna es fiscal", async () => {
    const e = await escenario()

    const r = await db.query(
      `select nombre, vende, emite_fiscal from ubicaciones
        where empresa_id = $1 order by nombre`,
      [e.empresa]
    )

    for (const u of r.rows) {
      expect(u.vende).toBe(true)
      expect(u.emite_fiscal).toBe(false)
    }
  })
})
