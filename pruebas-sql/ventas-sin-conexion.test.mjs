/*
  OFF-1.1: recepción de ventas hechas sin conexión, contra PostgreSQL real.

  Lo que se afirma aquí:
  - una venta válida se aplica con la misma lógica que el POS en línea
    (registrar_venta_ubicacion, sin modificarla) y conserva su fecha real;
  - una que no se puede aplicar NO se pierde: queda en ventas_por_conciliar
    sin gastar número ni tocar existencia;
  - reenviar nunca duplica, y una clave con otro contenido se rechaza;
  - el motor serializa de verdad: dos envíos simultáneos esperan uno al otro.
*/

import { describe, it, expect, beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo, enDosSesiones } from "./arnes.mjs"
import { crearEmpresa, crearVendedor, contar } from "./fixtures.mjs"
import {
  escenarioSinConexion,
  ventaSinConexion,
  sincronizar,
  llamarSincronizar,
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

const filaDeVenta = async (id) => (await db.query("select * from ventas where id = $1", [id])).rows[0]
const filaPorConciliar = async (id) =>
  (await db.query("select * from ventas_por_conciliar where id = $1", [id])).rows[0]
const segundos = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 1000

describe("compatibilidad con la venta en línea", () => {
  it("1. registrar_venta_ubicacion queda idéntica a la de producción", async () => {
    const r = await db.query(
      "select md5(replace(prosrc, chr(13), '')) as m from pg_proc where oid = 'public.registrar_venta_ubicacion'::regproc"
    )

    expect(r.rows[0].m).toBe("bb3b1346598e079a21a9064f289a7a4e")
  })

  it("2. una venta en línea queda con origen en_linea y sin datos del modo sin conexión", async () => {
    const esc = await escenarioSinConexion(db)

    const r = await consultarComo(
      db,
      esc.vendedor.authId,
      "select registrar_venta_ubicacion($1::jsonb, 'contado') as r",
      [JSON.stringify([{ producto_id: esc.cargador.id, cantidad: 1 }])]
    )
    const venta = await filaDeVenta(r.rows[0].r.venta_id)

    expect(venta.origen).toBe("en_linea")
    expect(venta.dispositivo).toBeNull()
    expect(venta.registrada_en).toBeNull()
    expect(venta.huella_origen).toBeNull()
  })
})

describe("aplicación", () => {
  it("3. aplica una venta válida con su fecha real y su trazabilidad", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)

    const r = await sincronizar(db, esc.vendedor.authId, venta)
    const fila = await filaDeVenta(r.venta_id)

    expect(r.estado).toBe("registrada")
    expect(r.numero_factura).toMatch(/^VTA-\d{6}$/)
    expect(Number(fila.total)).toBe(230)
    expect(fila.origen).toBe("sin_conexion")
    expect(fila.dispositivo).toBe("DISP0001")
    expect(fila.numero_provisional).toBe(venta.numero_provisional)
    expect(fila.ubicacion_id).toBe(esc.camion1)
    expect(segundos(fila.fecha, venta.registrada_en)).toBeLessThan(1)
    expect(segundos(fila.registrada_en, venta.registrada_en)).toBeLessThan(1)
    expect(segundos(fila.recibida_en, new Date())).toBeLessThan(30)
    expect(fila.huella_origen).toMatch(/^[0-9a-f]{32}$/)
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(8)
    expect(await contar(db, "movimientos_inventario", "venta_id = $1", [r.venta_id])).toBe(1)
  })

  it("4. aplica una venta a crédito a un cliente registrado", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc, {
      forma_pago: "credito",
      cliente_id: esc.clienteId,
      fecha_vencimiento: "2027-01-31",
    })

    const r = await sincronizar(db, esc.vendedor.authId, venta)
    const fila = await filaDeVenta(r.venta_id)

    expect(r.estado).toBe("registrada")
    expect(fila.estado).toBe("pendiente")
    expect(fila.cliente_id).toBe(esc.clienteId)
  })
})

describe("idempotencia", () => {
  it("5. reenviar la misma venta devuelve la misma, sin duplicar nada", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)

    const primera = await sincronizar(db, esc.vendedor.authId, venta)
    const numero = await correlativoInterno(db, esc.empresa)
    const segunda = await sincronizar(db, esc.vendedor.authId, venta)

    expect(segunda.estado).toBe("ya_registrada")
    expect(segunda.venta_id).toBe(primera.venta_id)
    expect(segunda.numero_factura).toBe(primera.numero_factura)
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(1)
    expect(await contar(db, "movimientos_inventario", "venta_id = $1", [primera.venta_id])).toBe(1)
    expect(await correlativoInterno(db, esc.empresa)).toBe(numero)
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(8)
  })

  it("6. la misma clave con otro contenido sobre una venta registrada es OF003", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    await sincronizar(db, esc.vendedor.authId, venta)

    const otra = { ...venta, renglones: [{ ...venta.renglones[0], cantidad: 3 }], total_cobrado: 345 }
    const error = await fallo(sincronizar(db, esc.vendedor.authId, otra))

    expect(error.code).toBe("OF003")
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(8)
  })

  it("7. reenviar una venta en conciliación responde lo mismo; con otro contenido es OF003", async () => {
    const esc = await escenarioSinConexion(db, { enCamion1: 1 })
    const venta = ventaSinConexion(esc)

    const primera = await sincronizar(db, esc.vendedor.authId, venta)
    const segunda = await sincronizar(db, esc.vendedor.authId, venta)
    const otra = { ...venta, nota: "cambiada" }
    const error = await fallo(sincronizar(db, esc.vendedor.authId, otra))

    expect(primera.estado).toBe("en_conciliacion")
    expect(segunda.estado).toBe("ya_en_conciliacion")
    expect(segunda.conciliacion_id).toBe(primera.conciliacion_id)
    expect(error.code).toBe("OF003")
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(1)
  })
})

describe("concurrencia real", () => {
  it("8. dos envíos simultáneos de la misma venta: uno registra y el otro espera y responde ya_registrada", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    const quien = esc.vendedor.authId

    const { respuesta, error } = await enDosSesiones(base, db, {
      primera: { authId: quien, hacer: (c) => llamarSincronizar(c, venta) },
      segunda: { authId: quien, hacer: (c) => llamarSincronizar(c, venta) },
    })

    expect(error).toBeUndefined()
    expect(respuesta.estado).toBe("ya_registrada")
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(1)
  })

  it("9. la misma clave con otro contenido a la vez: la segunda recibe OF003", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc)
    const otra = { ...venta, nota: "otra" }
    const quien = esc.vendedor.authId

    const { error } = await enDosSesiones(base, db, {
      primera: { authId: quien, hacer: (c) => llamarSincronizar(c, venta) },
      segunda: { authId: quien, hacer: (c) => llamarSincronizar(c, otra) },
    })

    expect(error.code).toBe("OF003")
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(1)
  })

  it("10. dos dispositivos venden la última unidad: una venta y una conciliación, sin negativos", async () => {
    const esc = await escenarioSinConexion(db, { enCamion1: 1 })
    const otro = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion1, permisos: ["pos"] })
    const una = (authId, dispositivo) =>
      ventaSinConexion(esc, {
        usuario_auth: authId,
        dispositivo,
        renglones: [{ producto_id: esc.cargador.id, codigo: "", nombre: "Cargador", cantidad: 1, precio_unitario: 100 }],
      })

    const { respuesta, error } = await enDosSesiones(base, db, {
      primera: { authId: esc.vendedor.authId, hacer: (c) => llamarSincronizar(c, una(esc.vendedor.authId, "DISPA001")) },
      segunda: { authId: otro.authId, hacer: (c) => llamarSincronizar(c, una(otro.authId, "DISPB001")) },
    })

    expect(error).toBeUndefined()
    expect(respuesta.estado).toBe("en_conciliacion")
    expect(respuesta.motivo).toBe("existencia-insuficiente")
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(0)
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(1)
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(1)
  })
})

describe("lo que no se puede aplicar queda en conciliación, sin perderse", () => {
  async function enConciliacion(esc, venta, motivo) {
    const numero = await correlativoInterno(db, esc.empresa)
    const r = await sincronizar(db, esc.vendedor.authId, venta)
    const fila = await filaPorConciliar(r.conciliacion_id)

    expect(r.estado).toBe("en_conciliacion")
    expect(r.motivo).toBe(motivo)
    expect(fila.motivo).toBe(motivo)
    expect(fila.estado).toBe("pendiente")
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(0)
    expect(await correlativoInterno(db, esc.empresa)).toBe(numero)

    return fila
  }

  it("11. guarda la venta completa: renglones, total cobrado, fechas, dispositivo y huella", async () => {
    const esc = await escenarioSinConexion(db, { enCamion1: 1 })
    const venta = ventaSinConexion(esc)

    const fila = await enConciliacion(esc, venta, "existencia-insuficiente")

    expect(fila.codigo).toBe("LV007")
    expect(fila.renglones).toEqual(venta.renglones)
    expect(Number(fila.total_cobrado)).toBe(230)
    expect(Number(fila.tasa_isv)).toBe(15)
    expect(fila.usuario_id).toBe(esc.vendedor.usuario)
    expect(fila.ubicacion_id).toBe(esc.camion1)
    expect(fila.dispositivo).toBe("DISP0001")
    expect(fila.numero_provisional).toBe(venta.numero_provisional)
    expect(segundos(fila.registrada_en, venta.registrada_en)).toBeLessThan(1)
    expect(fila.recibida_por).toBe("vendedor")
    expect(fila.huella).toMatch(/^[0-9a-f]{32}$/)
    expect(await existencia(db, esc.camion1, esc.cargador.id)).toBe(1)
  })

  it("12. vendedor desactivado", async () => {
    const esc = await escenarioSinConexion(db)
    await db.query("update usuarios set activo = false where id = $1", [esc.vendedor.usuario])

    await enConciliacion(esc, ventaSinConexion(esc), "usuario-inactivo")
  })

  it("13. vendedor con cambio de contraseña pendiente", async () => {
    const esc = await escenarioSinConexion(db)
    await db.query("update usuarios set debe_cambiar_contrasena = true where id = $1", [esc.vendedor.usuario])

    await enConciliacion(esc, ventaSinConexion(esc), "usuario-inactivo")
  })

  it("14. sin permiso de facturar", async () => {
    const esc = await escenarioSinConexion(db)
    await db.query("delete from permisos_usuario where usuario_id = $1", [esc.vendedor.usuario])

    await enConciliacion(esc, ventaSinConexion(esc), "sin-permiso")
  })

  it("15. al vendedor le cambiaron la ubicación: no descuenta de la nueva", async () => {
    const esc = await escenarioSinConexion(db)
    await db.query("update usuarios set ubicacion_id = $1 where id = $2", [esc.camion2, esc.vendedor.usuario])

    await enConciliacion(esc, ventaSinConexion(esc), "ubicacion-cambiada")
    expect(await existencia(db, esc.camion2, esc.cargador.id)).toBe(20)
  })

  it("16. ubicación sin el modo sin conexión habilitado", async () => {
    const esc = await escenarioSinConexion(db, { habilitado: false })

    await enConciliacion(esc, ventaSinConexion(esc), "ubicacion-no-habilitada")
  })

  it("17. fecha de hace más de 7 días", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc, { registrada_en: new Date(Date.now() - 8 * 86400000).toISOString() })

    await enConciliacion(esc, venta, "fecha-fuera-de-rango")
  })

  it("18. una venta posterior al reloj del propio teléfono", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc, {
      registrada_en: new Date(Date.now() + 5 * 60000).toISOString(),
      reloj_dispositivo: new Date().toISOString(),
    })

    await enConciliacion(esc, venta, "fecha-fuera-de-rango")
  })

  it("19. el precio cambió: conserva el precio y el total cobrados", async () => {
    const esc = await escenarioSinConexion(db)
    await db.query("update productos set precio = 120 where id = $1", [esc.cargador.id])

    const fila = await enConciliacion(esc, ventaSinConexion(esc), "precio-distinto")

    expect(Number(fila.renglones[0].precio_unitario)).toBe(100)
    expect(Number(fila.total_cobrado)).toBe(230)
  })

  it("20. la tasa de ISV cambió", async () => {
    const esc = await escenarioSinConexion(db)
    await db.query("update empresas set tasa_isv = 18 where id = $1", [esc.empresa])

    await enConciliacion(esc, ventaSinConexion(esc), "precio-distinto")
  })

  it("21. crédito a un cliente que no existe", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc, {
      forma_pago: "credito",
      cliente_id: "00000000-0000-0000-0000-000000000001",
      fecha_vencimiento: "2027-01-31",
    })

    await enConciliacion(esc, venta, "cliente-invalido")
  })

  it("22. un producto que no es de la empresa", async () => {
    const esc = await escenarioSinConexion(db)
    const venta = ventaSinConexion(esc, {
      renglones: [{ producto_id: "00000000-0000-0000-0000-000000000002", codigo: "", nombre: "Fantasma", cantidad: 1, precio_unitario: 10 }],
    })

    await enConciliacion(esc, venta, "producto-invalido")
  })
})

/*
  La fecha oficial es la que declaró el teléfono, nunca una calculada. Un
  desfase importante del reloj no se corrige solo: la venta va a
  conciliación y un administrador decide. Siempre se guarda el desfase
  medido al recibirla.
*/
describe("reloj del teléfono", () => {
  it("23. con el reloj desfasado 2 horas no corrige nada: va a conciliación con la fecha declarada", async () => {
    const esc = await escenarioSinConexion(db)
    const desfase = 2 * 3600000
    const venta = ventaSinConexion(esc, {
      registrada_en: new Date(Date.now() - desfase - 10 * 60000).toISOString(),
      reloj_dispositivo: new Date(Date.now() - desfase).toISOString(),
    })

    const r = await sincronizar(db, esc.vendedor.authId, venta)
    const fila = await filaPorConciliar(r.conciliacion_id)

    expect(r).toMatchObject({ estado: "en_conciliacion", motivo: "reloj-desfasado" })
    expect(segundos(fila.registrada_en, venta.registrada_en)).toBeLessThan(1)
    expect(Math.abs(fila.desfase_segundos - 7200)).toBeLessThan(30)
    expect(await contar(db, "ventas", "empresa_id = $1", [esc.empresa])).toBe(0)
  })

  it("24. con un desfase pequeño aplica con la fecha declarada, sin tocarla, y guarda el desfase", async () => {
    const esc = await escenarioSinConexion(db)
    const desfase = 4 * 60000
    const venta = ventaSinConexion(esc, {
      registrada_en: new Date(Date.now() - desfase - 10 * 60000).toISOString(),
      reloj_dispositivo: new Date(Date.now() - desfase).toISOString(),
    })

    const r = await sincronizar(db, esc.vendedor.authId, venta)
    const fila = await filaDeVenta(r.venta_id)

    expect(r.estado).toBe("registrada")
    expect(segundos(fila.fecha, venta.registrada_en)).toBeLessThan(1)
    expect(segundos(fila.registrada_en, venta.registrada_en)).toBeLessThan(1)
    expect(Math.abs(fila.desfase_segundos - 240)).toBeLessThan(30)
  })
})

describe("errores que no se guardan: el teléfono conserva la venta", () => {
  it("25. un anónimo no puede ejecutarla", async () => {
    const esc = await escenarioSinConexion(db)

    const error = await fallo(sincronizar(db, null, ventaSinConexion(esc)))

    expect(error.code).toBe("42501")
  })

  it("26. con la sesión de otro usuario es OF002 y no guarda nada", async () => {
    const esc = await escenarioSinConexion(db)
    const otro = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion1, permisos: ["pos"] })

    const error = await fallo(sincronizar(db, otro.authId, ventaSinConexion(esc)))

    expect(error.code).toBe("OF002")
    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(0)
  })

  it("27. contenido mal formado es OF001: cantidad cero, total incoherente o clave inválida", async () => {
    const esc = await escenarioSinConexion(db)
    const base = ventaSinConexion(esc)
    const malas = [
      { ...base, renglones: [{ ...base.renglones[0], cantidad: 0 }], total_cobrado: 0 },
      { ...base, total_cobrado: 999 },
      { ...base, clave_idempotencia: "sin-prefijo" },
      { ...base, renglones: [] },
    ]

    for (const mala of malas) {
      const error = await fallo(sincronizar(db, esc.vendedor.authId, mala))
      expect(error.code).toBe("OF001")
    }

    expect(await contar(db, "ventas_por_conciliar", "empresa_id = $1", [esc.empresa])).toBe(0)
  })

  it("28. una ubicación de otra empresa es OF001", async () => {
    const esc = await escenarioSinConexion(db)
    const ajena = await escenarioSinConexion(db)

    const error = await fallo(sincronizar(db, esc.vendedor.authId, ventaSinConexion(esc, { ubicacion_id: ajena.camion1 })))

    expect(error.code).toBe("OF001")
  })

  it("29. una identidad sin fila en usuarios es 42501", async () => {
    const esc = await escenarioSinConexion(db)
    const huerfano = (await db.query("insert into auth.users (email) values ('huerfano-off@prueba.local') returning id")).rows[0].id

    const error = await fallo(sincronizar(db, huerfano, ventaSinConexion(esc, { usuario_auth: huerfano })))

    expect(error.code).toBe("42501")
  })
})

describe("ventas_por_conciliar es inmutable", () => {
  async function unaEnConciliacion() {
    const esc = await escenarioSinConexion(db, { enCamion1: 0 })
    const r = await sincronizar(db, esc.vendedor.authId, ventaSinConexion(esc))

    return { esc, id: r.conciliacion_id }
  }

  it("30. nadie la borra, ni siquiera el dueño de la base", async () => {
    const { id } = await unaEnConciliacion()

    const error = await fallo(db.query("delete from ventas_por_conciliar where id = $1", [id]))

    expect(error.message).toMatch(/no se borran/i)
  })

  it("31. los datos de la venta no se pueden cambiar", async () => {
    const { id } = await unaEnConciliacion()

    const error = await fallo(db.query("update ventas_por_conciliar set total_cobrado = 1 where id = $1", [id]))

    expect(error.message).toMatch(/no se pueden modificar/i)
  })

  it("32. la aplicación no escribe en ella directamente", async () => {
    const { esc, id } = await unaEnConciliacion()

    const borrar = await fallo(consultarComo(db, esc.admin.authId, "delete from ventas_por_conciliar where id = $1", [id]))
    const cambiar = await fallo(
      consultarComo(db, esc.admin.authId, "update ventas_por_conciliar set estado = 'anulada' where id = $1", [id])
    )

    expect(borrar.code).toBe("42501")
    expect(cambiar.code).toBe("42501")
  })

  it("33. el vendedor ve sus filas, otro vendedor no, el administrador todas", async () => {
    const { esc, id } = await unaEnConciliacion()
    const otro = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion1, permisos: ["pos"] })
    const ver = (authId) => consultarComo(db, authId, "select id from ventas_por_conciliar where id = $1", [id])

    expect((await ver(esc.vendedor.authId)).rowCount).toBe(1)
    expect((await ver(otro.authId)).rowCount).toBe(0)
    expect((await ver(esc.admin.authId)).rowCount).toBe(1)
  })
})

describe("la marca vende_sin_conexion", () => {
  it("34. nace apagada", async () => {
    const { empresa } = await crearEmpresa(db)
    const r = await db.query(
      "insert into ubicaciones (empresa_id, nombre, tipo) values ($1, 'Nueva', 'camion') returning vende_sin_conexion",
      [empresa]
    )

    expect(r.rows[0].vende_sin_conexion).toBe(false)
  })

  it("35. solo el administrador la cambia", async () => {
    const esc = await escenarioSinConexion(db)
    const encargado = await crearVendedor(db, { empresa: esc.empresa, ubicacion: esc.camion2, permisos: ["locations"] })
    const cambiar = (authId) =>
      consultarComo(db, authId, "update ubicaciones set vende_sin_conexion = true where id = $1", [esc.camion2])

    const error = await fallo(cambiar(encargado.authId))
    await cambiar(esc.admin.authId)

    expect(error.code).toBe("42501")
    expect((await db.query("select vende_sin_conexion from ubicaciones where id = $1", [esc.camion2])).rows[0].vende_sin_conexion).toBe(true)
  })

  it("36. una ubicación fiscal no puede vender sin conexión", async () => {
    const esc = await escenarioSinConexion(db)
    await db.query("update ubicaciones set emite_fiscal = true where id = $1", [esc.tienda])

    const error = await fallo(db.query("update ubicaciones set vende_sin_conexion = true where id = $1", [esc.tienda]))

    expect(error.code).toBe("23514")
  })
})
