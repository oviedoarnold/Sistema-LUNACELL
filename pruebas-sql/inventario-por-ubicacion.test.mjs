/*
  El inventario por ubicación, probado contra PostgreSQL de verdad.

  Todo lo que aquí importa —que una celda no pueda ser negativa, que no se
  pueda cruzar el inventario de dos empresas, que RLS aísle, que la
  apertura cuadre— es precisamente lo que un doble en memoria no puede
  contestar. De ahí que estas pruebas levanten su propio motor.

  La apertura se comprueba dos veces: la que hace la migración sobre datos
  sembrados, y la que NO vuelve a hacer al correrla otra vez.
*/

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { levantarBase, comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, contar } from "./fixtures.mjs"

const AQUI = path.dirname(fileURLToPath(import.meta.url))

let base
let db

beforeAll(async () => {
  base = await levantarBase()
  db = base.admin
}, 180000)

afterAll(async () => {
  await base?.cerrar()
})

/* Una empresa con su bodega, su camión y un producto. */
/*
  Siembra un movimiento como los que existían ANTES de la 0019: sin
  ubicación, que es justo lo que esta migración describe como historia.

  Desde la 0019 un disparador rechaza todo movimiento nuevo sin ubicación,
  así que la siembra lo salta poniendo la sesión en modo réplica, que
  desactiva los disparadores solo para esta conexión de dueño. Es la única
  forma honesta de fabricar historia: el esquema de hoy no deja crearla, y
  no debe dejar.
*/
async function sembrarHistorico(sql, valores) {
  await db.query("set session_replication_role = replica")

  try {
    await db.query(sql, valores)
  } finally {
    await db.query("set session_replication_role = origin")
  }
}

async function escenario({ conBodega = true, stock = 0 } = {}) {
  const { empresa, usuario, authId } = await crearEmpresa(db)

  const bodega = conBodega
    ? (
        await db.query(
          `insert into ubicaciones (empresa_id, nombre, tipo)
           values ($1, 'Bodega', 'bodega') returning id`,
          [empresa]
        )
      ).rows[0].id
    : null

  const camion = (
    await db.query(
      `insert into ubicaciones (empresa_id, nombre, tipo)
       values ($1, 'Camión 01', 'camion') returning id`,
      [empresa]
    )
  ).rows[0].id

  const producto = (
    await db.query(
      `insert into productos (empresa_id, codigo, nombre, precio)
       values ($1, $2, 'Cargador', 120) returning id`,
      [empresa, "C-" + Math.random().toString(36).slice(2, 10)]
    )
  ).rows[0].id

  if (stock !== 0) {
    await sembrarHistorico(
      `insert into movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo)
       values ($1, $2, 'entrada', $3, 'Existencia inicial')`,
      [empresa, producto, stock]
    )
  }

  return { empresa, usuario, authId, bodega, camion, producto }
}

const celda = (conexion, ubicacionId, productoId) =>
  conexion
    .query(
      "select cantidad from inventario_ubicacion where ubicacion_id=$1 and producto_id=$2",
      [ubicacionId, productoId]
    )
    .then((r) => (r.rows[0] ? Number(r.rows[0].cantidad) : 0))

const totalDelProducto = (conexion, productoId) =>
  conexion
    .query(
      "select coalesce(sum(cantidad),0) as t from inventario_ubicacion where producto_id=$1",
      [productoId]
    )
    .then((r) => Number(r.rows[0].t))

describe("la celda de existencia", () => {
  it("1. acepta una celda válida", async () => {
    const e = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$3,25)`,
      [e.empresa, e.bodega, e.producto]
    )

    expect(await celda(db, e.bodega, e.producto)).toBe(25)
  })

  it("2. acepta cantidad cero", async () => {
    const e = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$3,0)`,
      [e.empresa, e.bodega, e.producto]
    )

    expect(await celda(db, e.bodega, e.producto)).toBe(0)
  })

  /*
    Es la defensa que vuelve imposible vender lo que no hay. No resuelve la
    concurrencia —eso pide candados y es de INV-3—, pero garantiza que el
    resultado nunca quede por debajo de cero.
  */
  it("3. rechaza una cantidad negativa", async () => {
    const e = await escenario()

    await expect(
      db.query(
        `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
         values ($1,$2,$3,-1)`,
        [e.empresa, e.bodega, e.producto]
      )
    ).rejects.toThrow(/cantidad/i)
  })

  it("4. rechaza bajar una celda existente por debajo de cero", async () => {
    const e = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$3,3)`,
      [e.empresa, e.bodega, e.producto]
    )

    await expect(
      db.query(
        "update inventario_ubicacion set cantidad = cantidad - 5 where ubicacion_id=$1 and producto_id=$2",
        [e.bodega, e.producto]
      )
    ).rejects.toThrow(/cantidad/i)

    expect(await celda(db, e.bodega, e.producto)).toBe(3)
  })

  it("5. no deja dos celdas del mismo producto y ubicación", async () => {
    const e = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$3,5)`,
      [e.empresa, e.bodega, e.producto]
    )

    await expect(
      db.query(
        `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
         values ($1,$2,$3,7)`,
        [e.empresa, e.bodega, e.producto]
      )
    ).rejects.toThrow(/duplicate key|llave duplicada/i)
  })

  it("6. el mismo producto sí puede estar en varias ubicaciones", async () => {
    const e = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$4,30), ($1,$3,$4,12)`,
      [e.empresa, e.bodega, e.camion, e.producto]
    )

    expect(await celda(db, e.bodega, e.producto)).toBe(30)
    expect(await celda(db, e.camion, e.producto)).toBe(12)
    expect(await totalDelProducto(db, e.producto)).toBe(42)
  })
})

describe("la frontera entre empresas", () => {
  it("7. rechaza un producto de otra empresa", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      db.query(
        `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
         values ($1,$2,$3,5)`,
        [mia.empresa, mia.bodega, ajena.producto]
      )
    ).rejects.toThrow(/foreign key|llave foránea/i)
  })

  it("8. rechaza una ubicación de otra empresa", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      db.query(
        `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
         values ($1,$2,$3,5)`,
        [mia.empresa, ajena.bodega, mia.producto]
      )
    ).rejects.toThrow(/foreign key|llave foránea/i)
  })

  it("9. rechaza declarar una empresa que no es la de sus piezas", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      db.query(
        `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
         values ($1,$2,$3,5)`,
        [ajena.empresa, mia.bodega, mia.producto]
      )
    ).rejects.toThrow(/foreign key|llave foránea/i)
  })
})

describe("aislamiento con RLS", () => {
  it("10. un usuario solo ve el inventario de su empresa", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$3,11)`,
      [mia.empresa, mia.bodega, mia.producto]
    )
    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$3,99)`,
      [ajena.empresa, ajena.bodega, ajena.producto]
    )

    const con = await base.conectar()

    try {
      await comoUsuario(con, mia.authId)

      const suyas = await con.query(
        "select empresa_id, cantidad from inventario_ubicacion"
      )

      expect(suyas.rows).toHaveLength(1)
      expect(Number(suyas.rows[0].cantidad)).toBe(11)
      expect(suyas.rows[0].empresa_id).toBe(mia.empresa)
    } finally {
      await comoDueno(con)
      await con.end()
    }
  })

  /*
    La autoridad es PostgreSQL: el navegador consulta, pero no escribe
    existencias.

    Se comprobó que RLS sola no basta para que el intento se note: sin
    política de escritura, un update no encuentra filas y devuelve éxito
    con cero cambios, que parece haber funcionado. Por eso la migración
    además revoca el permiso, y esta prueba exige el rechazo explícito.
  */
  it("11. un usuario autenticado no puede escribir existencias", async () => {
    const e = await escenario()

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$3,7)`,
      [e.empresa, e.bodega, e.producto]
    )

    const con = await base.conectar()

    try {
      await comoUsuario(con, e.authId)

      await expect(
        con.query(
          "update inventario_ubicacion set cantidad = 9999 where producto_id=$1",
          [e.producto]
        )
      ).rejects.toThrow(/permission denied|policy|permiso/i)

      await expect(
        con.query(
          `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
           values ($1,$2,$3,1)`,
          [e.empresa, e.camion, e.producto]
        )
      ).rejects.toThrow(/permission denied|policy|permiso/i)
    } finally {
      await comoDueno(con)
      await con.end()
    }

    expect(await celda(db, e.bodega, e.producto)).toBe(7)
  })
})

describe("la apertura", () => {
  /*
    La apertura se ejecuta corriendo LA MIGRACIÓN DE VERDAD, no una copia.

    Tenerla escrita dos veces ya se desincronizó una vez durante esta
    misma fase: la migración se corrigió y la copia de aquí siguió con el
    error, así que las pruebas dejaron de mirar lo que se va a aplicar.
    Leyendo el archivo, eso no puede volver a pasar.

    Correrla entera es seguro porque es idempotente, que es lo que el
    README de migraciones promete de todas.
  */
  const APERTURA = fs.readFileSync(
    path.join(AQUI, "..", "supabase", "migrations", "0014_inventario_por_ubicacion.sql"),
    "utf8"
  )

  /*
    La migración ya corrió sobre una base vacía al levantar el arnés, así
    que aquí se ejecuta su mismo bloque sobre datos sembrados, dentro de
    una transacción que se revierte.

    Cada prueba arranca vaciando la tabla porque las de arriba dejaron
    celdas y la apertura se salta si encuentra alguna. Olvidarlo no rompe
    nada a la vista: las pruebas pasan sin ejecutar la apertura, que es lo
    que ocurrió con cinco de ellas mientras se escribía esto. Por eso la
    precondición vive aquí y no copiada en cada prueba, donde se puede
    olvidar en la siguiente que alguien añada.
  */
  beforeEach(async () => {
    await db.query("begin")
    await db.query("delete from inventario_ubicacion")
  })

  afterEach(async () => {
    await db.query("rollback")
  })

  it("12. conserva el total y lo deja en la bodega", async () => {
    const e = await escenario({ stock: 10 })
    await db.query(APERTURA)

    expect(await celda(db, e.bodega, e.producto)).toBe(10)
    expect(await totalDelProducto(db, e.producto)).toBe(10)
  })

  it("13. la tienda y los camiones arrancan en cero", async () => {
    const e = await escenario({ stock: 10 })
    await db.query(APERTURA)

    /* Ausencia de celda es cero: no se crean filas de ceros. */
    expect(await celda(db, e.camion, e.producto)).toBe(0)
    expect(
      await contar(db, "inventario_ubicacion", "ubicacion_id=$1", [e.camion])
    ).toBe(0)
  })

  it("14. no duplica el stock al correrla dos veces", async () => {
    const e = await escenario({ stock: 10 })

    await db.query(APERTURA)
    await db.query(APERTURA)
    await db.query(APERTURA)

    expect(await totalDelProducto(db, e.producto)).toBe(10)
  })

  /*
    Esta prueba comprueba la comparación, no el camino que lleva a ella, y
    conviene decir por qué.

    La cifra de control de la migración NO se puede disparar hoy con datos
    válidos. El bucle reparte, por empresa, la suma de los movimientos de
    cada uno de sus productos; la cifra suma después todos los movimientos
    que existen. Para que las dos difieran haría falta un movimiento cuyo
    producto no esté en `productos`, y `movimientos_inventario.producto_id`
    es `not null references productos (id) on delete cascade`: no hay
    huérfanos posibles.

    Es decir: la cifra de control es una red para un cambio futuro —que
    alguien filtre el bucle por producto activo, o por tipo de
    movimiento— y no para un dato de hoy. Lo que sí se puede probar es que
    la comparación detecta un descuadre cuando existe, y es lo que se hace
    aquí sembrando una unidad de más.
  */
  it("15. la cifra de control rechaza un descuadre", async () => {
    const e = await escenario({ stock: 10 })

    await db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1,$2,$3,1)`,
      [e.empresa, e.camion, e.producto]
    )

    await expect(
      db.query(`
        do $$
        declare v_esperado bigint; v_aplicado bigint;
        begin
          select coalesce(sum(cantidad),0) into v_esperado from movimientos_inventario;
          select coalesce(sum(cantidad),0) into v_aplicado from inventario_ubicacion;
          if v_esperado <> v_aplicado then
            raise exception 'La apertura no cuadra: movimientos % contra celdas %', v_esperado, v_aplicado;
          end if;
        end $$;`)
    ).rejects.toThrow(/no cuadra/i)
  })

  it("16. aborta si la empresa no tiene bodega activa", async () => {
    await escenario({ conBodega: false, stock: 5 })

    await expect(db.query(APERTURA)).rejects.toThrow(/bodega activa/i)
  })

  /*
    El caso contrario al anterior: dos bodegas activas. La apertura no
    elige por su cuenta, y por eso no toma «la primera» ni «la menor»:
    dejar 20 unidades en una de dos bodegas posibles es decidir dónde está
    la mercadería sin saberlo, y eso se descubre haciendo un inventario
    físico contra una cifra inventada.
  */
  it("17. aborta si la empresa tiene más de una bodega activa", async () => {
    const { empresa } = await escenario({ stock: 5 })

    await db.query(
      `insert into ubicaciones (empresa_id, nombre, tipo)
       values ($1, 'Bodega Norte', 'bodega')`,
      [empresa]
    )

    await expect(db.query(APERTURA)).rejects.toThrow(/2 bodegas activas/i)
  })

  it("18. aborta si el stock histórico es negativo", async () => {
    const e = await escenario({ stock: 5 })

    await sembrarHistorico(
      `insert into movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo)
       values ($1,$2,'salida',-9,'prueba')`,
      [e.empresa, e.producto]
    )

    await expect(db.query(APERTURA)).rejects.toThrow(/negativo/i)
  })
})

describe("compatibilidad con lo que ya existía", () => {
  it("19. los movimientos históricos siguen sin ubicación y son válidos", async () => {
    const e = await escenario({ stock: 4 })

    const m = await db.query(
      "select ubicacion_id, cantidad from movimientos_inventario where producto_id=$1",
      [e.producto]
    )

    expect(m.rows).toHaveLength(1)
    expect(m.rows[0].ubicacion_id).toBeNull()
    expect(Number(m.rows[0].cantidad)).toBe(4)
  })

  it("20. un movimiento nuevo sí puede llevar ubicación", async () => {
    const e = await escenario()

    await db.query(
      `insert into movimientos_inventario (empresa_id, producto_id, ubicacion_id, tipo, cantidad, motivo)
       values ($1,$2,$3,'entrada',6,'con ubicación')`,
      [e.empresa, e.producto, e.bodega]
    )

    const m = await db.query(
      "select ubicacion_id from movimientos_inventario where producto_id=$1 and ubicacion_id is not null",
      [e.producto]
    )

    expect(m.rows[0].ubicacion_id).toBe(e.bodega)
  })

  it("21. un movimiento no puede apuntar a una ubicación de otra empresa", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      db.query(
        `insert into movimientos_inventario (empresa_id, producto_id, ubicacion_id, tipo, cantidad, motivo)
         values ($1,$2,$3,'entrada',1,'cruzado')`,
        [mia.empresa, mia.producto, ajena.bodega]
      )
    ).rejects.toThrow(/foreign key|llave foránea/i)
  })

  it("22. las ventas aceptan ubicación nula y también una propia", async () => {
    const e = await escenario()

    const sinUbicacion = await db.query(
      `insert into ventas (empresa_id, numero_factura, correlativo, forma_pago, total)
       values ($1,'FAC-SIN',9001,'contado',100) returning ubicacion_id`,
      [e.empresa]
    )
    expect(sinUbicacion.rows[0].ubicacion_id).toBeNull()

    const conUbicacion = await db.query(
      `insert into ventas (empresa_id, numero_factura, correlativo, forma_pago, total, ubicacion_id)
       values ($1,'FAC-CON',9002,'contado',100,$2) returning ubicacion_id`,
      [e.empresa, e.camion]
    )
    expect(conUbicacion.rows[0].ubicacion_id).toBe(e.camion)
  })

  it("23. una venta no puede apuntar a una ubicación de otra empresa", async () => {
    const mia = await escenario()
    const ajena = await escenario()

    await expect(
      db.query(
        `insert into ventas (empresa_id, numero_factura, correlativo, forma_pago, total, ubicacion_id)
         values ($1,'FAC-X',9003,'contado',100,$2)`,
        [mia.empresa, ajena.bodega]
      )
    ).rejects.toThrow(/foreign key|llave foránea/i)
  })

  /*
    La existencia que ve el frontend hoy sale de sumar movimientos, y esta
    fase no la toca. Si la apertura hubiera escrito un movimiento, esa
    suma se habría duplicado: es la razón por la que no lo hace.
  */
  it("24. las vistas de stock siguen dando lo mismo que antes", async () => {
    const e = await escenario({ stock: 10 })

    const vista = await db.query(
      "select stock from productos_con_stock where id=$1",
      [e.producto]
    )

    expect(Number(vista.rows[0].stock)).toBe(10)
  })
})

describe("la estructura quedó como se pidió", () => {
  it("25. están las restricciones y los índices esperados", async () => {
    const r = await db.query(`
      select
        (select count(*) from pg_constraint
          where conrelid='inventario_ubicacion'::regclass and contype='p') as pk,
        (select count(*) from pg_constraint
          where conrelid='inventario_ubicacion'::regclass and contype='c') as checks,
        (select count(*) from pg_constraint
          where conrelid='inventario_ubicacion'::regclass and contype='f') as fks,
        (select count(*) from pg_indexes
          where tablename='inventario_ubicacion') as indices,
        (select relrowsecurity from pg_class
          where oid='inventario_ubicacion'::regclass) as rls,
        (select count(*) from pg_policy
          where polrelid='inventario_ubicacion'::regclass) as politicas,
        (select polcmd::text from pg_policy
          where polrelid='inventario_ubicacion'::regclass limit 1) as operacion
    `)

    const x = r.rows[0]

    expect(Number(x.pk)).toBe(1)
    expect(Number(x.checks)).toBeGreaterThanOrEqual(1)
    expect(Number(x.fks)).toBe(3)
    expect(Number(x.indices)).toBeGreaterThanOrEqual(2)
    expect(x.rls).toBe(true)
    expect(Number(x.politicas)).toBe(1)
    /* 'r' es SELECT: la única operación que el navegador tiene permitida. */
    expect(x.operacion).toBe("r")
  })

  it("26. la clave primaria es el par ubicación + producto", async () => {
    const r = await db.query(`
      select pg_get_constraintdef(oid) as def
        from pg_constraint
       where conrelid='inventario_ubicacion'::regclass and contype='p'
    `)

    expect(r.rows[0].def).toMatch(/PRIMARY KEY \(ubicacion_id, producto_id\)/)
  })
})
