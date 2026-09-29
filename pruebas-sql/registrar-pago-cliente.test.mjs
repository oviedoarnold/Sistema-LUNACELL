/*
  El reparto de un pago, probado contra PostgreSQL de verdad.

  Todo lo que aquí importa —que un CHECK rechace, que RLS aísle, que una
  transacción se deshaga entera, que dos cajeros no gasten el mismo saldo—
  es precisamente lo que un doble en memoria no puede contestar. De ahí que
  estas pruebas no usen supabaseFalso y levanten su propio motor.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, comoUsuario, comoDueno, esperarBloqueo } from "./arnes.mjs"
import {
  crearEmpresa,
  crearCliente,
  crearFactura,
  crearAbonoLegado,
  deudaDe,
  contar,
} from "./fixtures.mjs"

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

/* Monta una empresa con su cliente y las facturas que pida el caso. */
async function escenario(totales, opciones = {}) {
  const { empresa, usuario, authId } = await crearEmpresa(db)
  const clienteId = await crearCliente(db, empresa)

  const facturas = []
  let i = 0

  for (const total of totales) {
    i += 1
    facturas.push(
      await crearFactura(db, {
        empresa,
        clienteId,
        usuario,
        total,
        correlativo: i,
        fecha: `2026-0${i}-10T10:00:00Z`,
        estado: opciones.estados?.[i - 1] ?? "pendiente",
      })
    )
  }

  return { empresa, usuario, authId, clienteId, facturas }
}

/* Llama al RPC como ese usuario, sobre una conexión propia. */
async function pagar(conexion, authId, { clienteId, monto, clave = null, nota = "" }) {
  await comoUsuario(conexion, authId)

  try {
    const r = await conexion.query(
      "select registrar_pago_cliente($1, $2, $3, $4) as res",
      [clienteId, monto, clave, nota]
    )

    return r.rows[0].res
  } finally {
    await comoDueno(conexion)
  }
}

describe("reparto del pago", () => {
  it("1. aplica un pago parcial a una sola factura", async () => {
    const e = await escenario([1000])
    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 400 })

    expect(Number(r.monto)).toBe(400)
    expect(Number(r.saldo_anterior)).toBe(1000)
    expect(Number(r.saldo_posterior)).toBe(600)
    expect(r.aplicaciones).toHaveLength(1)
    expect(Number(r.aplicaciones[0].monto_aplicado)).toBe(400)
    expect(await deudaDe(db, e.clienteId)).toBe(600)
  })

  it("2. reparte un pago que cubre varias facturas", async () => {
    const e = await escenario([1000, 2750, 5000])
    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 4000 })

    expect(r.aplicaciones.map((a) => Number(a.monto_aplicado))).toEqual([
      1000, 2750, 250,
    ])
    expect(await deudaDe(db, e.clienteId)).toBe(4750)

    const estados = await db.query(
      "select estado from ventas where cliente_id=$1 order by correlativo",
      [e.clienteId]
    )
    expect(estados.rows.map((x) => x.estado)).toEqual([
      "pagada",
      "pagada",
      "pendiente",
    ])
  })

  it("3. deja la cuenta en cero con un pago exacto", async () => {
    const e = await escenario([300, 700])
    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 1000 })

    expect(Number(r.saldo_posterior)).toBe(0)
    expect(await deudaDe(db, e.clienteId)).toBe(0)

    const n = await contar(
      db,
      "ventas",
      "cliente_id=$1 and estado='pagada'",
      [e.clienteId]
    )
    expect(n).toBe(2)
  })

  it("4. rechaza entero un sobrepago y no deja rastro", async () => {
    const e = await escenario([2587.5])

    await expect(
      pagar(db, e.authId, { clienteId: e.clienteId, monto: 3000 })
    ).rejects.toThrow(/supera la deuda/i)

    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(0)
    expect(
      await contar(db, "abonos", "venta_id=$1", [e.facturas[0]])
    ).toBe(0)
    expect(await deudaDe(db, e.clienteId)).toBe(2587.5)
  })

  it("5. rechaza un monto de cero", async () => {
    const e = await escenario([1000])

    await expect(
      pagar(db, e.authId, { clienteId: e.clienteId, monto: 0 })
    ).rejects.toThrow(/mayor que cero/i)

    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(0)
  })

  it("6. rechaza un monto negativo", async () => {
    const e = await escenario([1000])

    await expect(
      pagar(db, e.authId, { clienteId: e.clienteId, monto: -50 })
    ).rejects.toThrow(/mayor que cero/i)

    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(0)
  })

  it("7. rechaza cobrarle a un cliente sin deuda", async () => {
    const { empresa, authId } = await crearEmpresa(db)
    const clienteId = await crearCliente(db, empresa)

    await expect(
      pagar(db, authId, { clienteId, monto: 100 })
    ).rejects.toThrow(/no tiene deuda/i)
  })

  it("8. no deja cobrarle a un cliente de otra empresa", async () => {
    const mia = await escenario([1000])
    const ajena = await escenario([1000])

    await expect(
      pagar(db, mia.authId, { clienteId: ajena.clienteId, monto: 100 })
    ).rejects.toThrow(/no existe en esta empresa/i)

    expect(await deudaDe(db, ajena.clienteId)).toBe(1000)
  })

  it("9. deja fuera de la deuda una factura anulada", async () => {
    const e = await escenario([1000, 500], { estados: ["pendiente", "anulada"] })

    expect(await deudaDe(db, e.clienteId)).toBe(1000)

    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 1000 })

    expect(r.aplicaciones).toHaveLength(1)
    expect(r.aplicaciones[0].venta_id).toBe(e.facturas[0])
    expect(Number(r.saldo_posterior)).toBe(0)

    const anulada = await db.query("select estado from ventas where id=$1", [
      e.facturas[1],
    ])
    expect(anulada.rows[0].estado).toBe("anulada")
  })

  it("10. aplica de la más antigua a la más reciente", async () => {
    const e = await escenario([500, 500, 500])
    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 750 })

    expect(r.aplicaciones.map((a) => a.venta_id)).toEqual([
      e.facturas[0],
      e.facturas[1],
    ])
    expect(r.aplicaciones.map((a) => Number(a.monto_aplicado))).toEqual([
      500, 250,
    ])
  })

  it("11. desempata por correlativo cuando la fecha es idéntica", async () => {
    const { empresa, usuario, authId } = await crearEmpresa(db)
    const clienteId = await crearCliente(db, empresa)
    const misma = "2026-03-01T12:00:00Z"

    // se insertan al revés a propósito: si mandara el orden físico, fallaría
    const segunda = await crearFactura(db, {
      empresa, clienteId, usuario, total: 100, correlativo: 77, fecha: misma,
    })
    const primera = await crearFactura(db, {
      empresa, clienteId, usuario, total: 100, correlativo: 22, fecha: misma,
    })

    const r = await pagar(db, authId, { clienteId, monto: 100 })

    expect(r.aplicaciones).toHaveLength(1)
    expect(r.aplicaciones[0].venta_id).toBe(primera)
    expect(Number(r.aplicaciones[0].correlativo)).toBe(22)
    expect(segunda).not.toBe(primera)
  })

  it("12. crea una sola cabecera de pago", async () => {
    const e = await escenario([1000, 2000])
    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 1500 })

    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(1)

    const pago = await db.query("select * from pagos where id=$1", [r.pago_id])
    expect(pago.rows[0].estado).toBe("aplicado")
    expect(pago.rows[0].usuario_id).toBe(e.usuario)
  })

  it("13. cuelga cada aplicación del pago que la creó", async () => {
    const e = await escenario([1000, 2000])
    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 1500 })

    const abonos = await db.query(
      "select pago_id, monto from abonos where pago_id=$1 order by monto desc",
      [r.pago_id]
    )

    expect(abonos.rows).toHaveLength(2)
    expect(abonos.rows.every((a) => a.pago_id === r.pago_id)).toBe(true)
    expect(abonos.rows.map((a) => Number(a.monto))).toEqual([1000, 500])
  })

  it("14. guarda el antes y el después, del pago y de cada factura", async () => {
    const e = await escenario([1000, 2000])
    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 1500 })

    expect(Number(r.saldo_anterior)).toBe(3000)
    expect(Number(r.saldo_posterior)).toBe(1500)

    expect(
      r.aplicaciones.map((a) => [
        Number(a.saldo_anterior_factura),
        Number(a.saldo_posterior_factura),
      ])
    ).toEqual([
      [1000, 0],
      [2000, 1500],
    ])
  })

  it("15. con la misma clave no cobra dos veces", async () => {
    const e = await escenario([1000])
    const clave = "intento-unico-1"

    const uno = await pagar(db, e.authId, {
      clienteId: e.clienteId, monto: 400, clave,
    })
    const dos = await pagar(db, e.authId, {
      clienteId: e.clienteId, monto: 400, clave,
    })

    expect(dos.pago_id).toBe(uno.pago_id)
    expect(uno.repetido).toBe(false)
    expect(dos.repetido).toBe(true)
    expect(dos.aplicaciones).toHaveLength(1)
    expect(Number(dos.aplicaciones[0].monto_aplicado)).toBe(400)

    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(1)
    expect(await contar(db, "abonos", "pago_id=$1", [uno.pago_id])).toBe(1)
    expect(await deudaDe(db, e.clienteId)).toBe(600)
  })

  it("16. no disfraza de reintento una clave reusada con otros datos", async () => {
    const e = await escenario([1000])
    const clave = "clave-reusada-1"

    await pagar(db, e.authId, { clienteId: e.clienteId, monto: 400, clave })

    // mismo cliente, otro monto
    await expect(
      pagar(db, e.authId, { clienteId: e.clienteId, monto: 500, clave })
    ).rejects.toThrow(/ya se usó para un pago distinto/i)

    // otro cliente de la misma empresa, mismo monto
    const otro = await crearCliente(db, e.empresa)
    await crearFactura(db, {
      empresa: e.empresa, clienteId: otro, total: 900, correlativo: 900,
      fecha: "2026-05-05T10:00:00Z",
    })

    await expect(
      pagar(db, e.authId, { clienteId: otro, monto: 400, clave })
    ).rejects.toThrow(/ya se usó para un pago distinto/i)

    expect(await contar(db, "pagos", "empresa_id=$1", [e.empresa])).toBe(1)
  })

  it("17. si algo falla a mitad, no queda nada aplicado", async () => {
    const e = await escenario([1000, 2000])

    /*
      Se provoca el fallo justo en la segunda aplicación: es el caso que
      de verdad importa, porque la primera ya se insertó y el pago ya
      existe. Si la transacción no fuera una, quedaría dinero aplicado a
      medias.
    */
    await db.query(`
      create or replace function romper_segundo_abono() returns trigger
      language plpgsql as $trg$
      begin
        if new.monto = 500 then
          raise exception 'fallo provocado por la prueba';
        end if;
        return new;
      end $trg$;
    `)
    await db.query(`
      create trigger romper_segundo_abono before insert on abonos
      for each row execute function romper_segundo_abono();
    `)

    try {
      await expect(
        pagar(db, e.authId, { clienteId: e.clienteId, monto: 1500 })
      ).rejects.toThrow(/fallo provocado/i)
    } finally {
      await db.query("drop trigger if exists romper_segundo_abono on abonos")
      await db.query("drop function if exists romper_segundo_abono()")
    }

    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(0)
    expect(
      await contar(db, "abonos", "venta_id = any($1)", [e.facturas])
    ).toBe(0)
    expect(await deudaDe(db, e.clienteId)).toBe(3000)

    const estados = await db.query(
      "select estado from ventas where cliente_id=$1",
      [e.clienteId]
    )
    expect(estados.rows.every((x) => x.estado === "pendiente")).toBe(true)
  })

  it("18. un anónimo no puede ejecutarla", async () => {
    const e = await escenario([1000])
    const anon = await base.conectar()

    try {
      await comoUsuario(anon, null)
      await expect(
        anon.query("select registrar_pago_cliente($1, $2, null, '')", [
          e.clienteId, 100,
        ])
      ).rejects.toThrow(/permission denied|permiso denegado/i)
    } finally {
      await comoDueno(anon)
      await anon.end()
    }

    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(0)
  })

  it("19. el pago de una empresa no toca la deuda de la otra", async () => {
    const a = await escenario([1000])
    const b = await escenario([1000])

    await pagar(db, a.authId, { clienteId: a.clienteId, monto: 600 })

    expect(await deudaDe(db, a.clienteId)).toBe(400)
    expect(await deudaDe(db, b.clienteId)).toBe(1000)
    expect(await contar(db, "pagos", "empresa_id=$1", [b.empresa])).toBe(0)
  })

  it("20. cuenta los abonos viejos que no tienen pago_id", async () => {
    const e = await escenario([1000])
    await crearAbonoLegado(db, {
      empresa: e.empresa, ventaId: e.facturas[0], monto: 400,
    })

    expect(await deudaDe(db, e.clienteId)).toBe(600)

    // la deuda que ve el RPC tiene que ser 600, no 1000
    await expect(
      pagar(db, e.authId, { clienteId: e.clienteId, monto: 700 })
    ).rejects.toThrow(/supera la deuda/i)

    const r = await pagar(db, e.authId, { clienteId: e.clienteId, monto: 600 })

    expect(Number(r.saldo_anterior)).toBe(600)
    expect(Number(r.saldo_posterior)).toBe(0)
    expect(Number(r.aplicaciones[0].monto_aplicado)).toBe(600)
    expect(await deudaDe(db, e.clienteId)).toBe(0)
  })
})

describe("concurrencia", () => {
  it("21. dos pagos de 700 sobre una deuda de 1000: solo uno entra", async () => {
    const e = await escenario([1000])
    expect(await deudaDe(db, e.clienteId)).toBe(1000)

    const a = await base.conectar()
    const b = await base.conectar()

    try {
      await comoUsuario(a, e.authId)
      await comoUsuario(b, e.authId)

      const pidB = (await b.query("select pg_backend_pid() as pid")).rows[0].pid

      await a.query("begin")
      await b.query("begin")

      /*
        A entra primero, toma el candado de la cuenta y reparte sus 700,
        pero todavía NO confirma: sigue con la transacción abierta y los
        candados puestos.
      */
      const ra = await a.query(
        "select registrar_pago_cliente($1, 700, null, '') as res",
        [e.clienteId]
      )
      expect(Number(ra.rows[0].res.monto)).toBe(700)

      // B sale ahora, con A todavía sin confirmar.
      const pb = b.query(
        "select registrar_pago_cliente($1, 700, null, '') as res",
        [e.clienteId]
      )

      /*
        Y aquí está el punto de la prueba: no se sigue hasta comprobar en
        pg_stat_activity que B está de verdad detenida esperando un
        candado. Si la función no serializara, B no se detendría, esta
        llamada agotaría su tiempo y el caso fallaría.
      */
      const espera = await esperarBloqueo(db, pidB)
      expect(espera).toMatch(/^Lock\//)

      await a.query("commit")

      /*
        Liberado el candado, B recalcula: la deuda ya no es 1000 sino 300,
        y sus 700 no caben. Rechaza entera la operación.
      */
      let errorB = null
      try {
        await pb
        await b.query("commit")
      } catch (problema) {
        errorB = problema
        await b.query("rollback")
      }

      expect(errorB).not.toBeNull()
      expect(errorB.message).toMatch(/supera la deuda/i)
    } finally {
      await comoDueno(a)
      await comoDueno(b)
      await a.end()
      await b.end()
    }

    // y la cuenta quedó con un solo pago
    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(1)
    expect(await deudaDe(db, e.clienteId)).toBe(300)
  })

  it("22. dos reintentos simultáneos con la misma clave dejan un solo pago", async () => {
    const e = await escenario([1000])
    const clave = "reintento-simultaneo-1"

    const a = await base.conectar()
    const b = await base.conectar()

    try {
      await comoUsuario(a, e.authId)
      await comoUsuario(b, e.authId)

      const pidB = (await b.query("select pg_backend_pid() as pid")).rows[0].pid

      await a.query("begin")
      await b.query("begin")

      /*
        Este es el caso que justifica bloquear la cuenta y no solo las
        facturas: la comprobación de la clave y la inserción del pago
        ocurren antes de tocar ninguna venta. Sin el candado del cliente,
        las dos transacciones pasarían la comprobación a la vez —ninguna ve
        el pago de la otra, que aún no se confirmó— y las dos intentarían
        insertar.
      */
      const ra = await a.query(
        "select registrar_pago_cliente($1, 400, $2, '') as res",
        [e.clienteId, clave]
      )

      const pb = b.query(
        "select registrar_pago_cliente($1, 400, $2, '') as res",
        [e.clienteId, clave]
      )

      expect(await esperarBloqueo(db, pidB)).toMatch(/^Lock\//)

      await a.query("commit")

      const rb = await pb
      await b.query("commit")

      // B no cobró de nuevo: reconoció el intento de A y devolvió el suyo.
      expect(rb.rows[0].res.pago_id).toBe(ra.rows[0].res.pago_id)
      expect(rb.rows[0].res.repetido).toBe(true)
      expect(ra.rows[0].res.repetido).toBe(false)
    } finally {
      await comoDueno(a)
      await comoDueno(b)
      await a.end()
      await b.end()
    }

    expect(await contar(db, "pagos", "cliente_id=$1", [e.clienteId])).toBe(1)
    expect(await deudaDe(db, e.clienteId)).toBe(600)
  })
})
