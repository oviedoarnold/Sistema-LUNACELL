/*
  0056 contra PostgreSQL de verdad: la recepción de traslados.

  Bodega envía a Ruta local; Ruta local confirma lo que recibió físicamente,
  o reporta una incidencia. Se afirma quién puede recibir, que la
  mercadería entra una sola vez y solo al confirmar, que el contenido
  enviado no se puede alterar, y que cualquier rechazo deja el inventario
  como estaba. Nada sale de producción: todo se inventa aquí.
*/

import { describe, it, expect } from "vitest"

import { enDosSesiones } from "./arnes.mjs"
import { usarBaseDePrueba, falla } from "./ayudantes.mjs"
import { crearEmpresa, crearVendedor, contar } from "./fixtures.mjs"

let base
let db

const { como } = usarBaseDePrueba((levantada) => {
  base = levantada
  db = levantada.admin
})

const res = async (authId, consulta, valores) => (await como(authId, consulta, valores)).rows[0].r

async function escenario() {
  const admin = await crearEmpresa(db, "Lunacell Recepción")
  const { empresa } = admin
  const ubicacion = async (nombre, tipo) =>
    (await db.query("insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id", [empresa, nombre, tipo])).rows[0].id

  const bodega = await ubicacion("Lunacell Bodega", "bodega")
  const ruta = await ubicacion("Ruta local", "camion")
  const gira = await ubicacion("Ruta gira 1", "camion")

  await db.query("update usuarios set ubicacion_id = $1 where id = $2", [bodega, admin.usuario])

  const producto = async (nombre) =>
    (await db.query("insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, $3, 100, 10) returning id",
      [empresa, `R-${Math.random().toString(36).slice(2, 9)}`, nombre])).rows[0].id

  const cargador = await producto("Cargador")
  const cubo = await producto("Cubo Iphone")

  for (const [p, n] of [[cargador, 20], [cubo, 10]]) {
    await como(admin.authId, "select registrar_movimiento_ubicacion($1, $2, 'entrada', $3)", [p, bodega, n])
  }

  const vendedor = (ubic, permisos, extra = {}) => crearVendedor(db, { empresa, ubicacion: ubic, permisos, ...extra })

  const e = {
    admin, empresa, bodega, ruta, gira, cargador, cubo,
    bodeguero: await vendedor(bodega, ["inventory-own", "pos"]),
    rutero: await vendedor(ruta, ["inventory-own", "pos"]),
    ruteroSoloPos: await vendedor(ruta, ["pos"]),
    todasEnBodega: await vendedor(bodega, ["inventory-all"]),
    todasEnRuta: await vendedor(ruta, ["inventory-all"]),
    inactivo: await vendedor(ruta, ["inventory-own"], { activo: false }),
    debeCambiar: await vendedor(ruta, ["inventory-own"]),
    contador: await vendedor(ruta, ["inventory-own", "sales-history"]),
  }

  await db.query("update usuarios set debe_cambiar_contrasena = true where id = $1", [e.debeCambiar.usuario])
  await db.query("update usuarios set rol = 'contador' where id = $1", [e.contador.usuario])

  return e
}

const lista = (pares) => JSON.stringify(pares.map(([producto_id, cantidad]) => ({ producto_id, cantidad })))

const enviar = (quien, origen, destino, pares, nota = "") =>
  res(quien.authId, "select registrar_traslado($1, $2, $3::jsonb, $4) as r", [origen, destino, lista(pares), nota])

const confirmar = (quien, traslado, observacion = null) =>
  res(quien.authId, "select confirmar_recepcion_traslado($1, $2) as r", [traslado, observacion])

const reportar = (quien, traslado, nota) =>
  res(quien.authId, "select reportar_incidencia_traslado($1, $2) as r", [traslado, nota])

const existencia = async (ubicacion, producto) =>
  (await db.query("select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2", [ubicacion, producto])).rows[0]?.cantidad ?? null

const cabecera = async (id) => (await db.query("select * from traslados where id = $1", [id])).rows[0]

// Todo lo que una operación rechazada no debe tocar.
const foto = async (e, traslado) => ({
  celdas: (await db.query("select ubicacion_id, producto_id, cantidad from inventario_ubicacion where empresa_id = $1 order by 1, 2", [e.empresa])).rows,
  movimientos: await contar(db, "movimientos_inventario", "empresa_id = $1", [e.empresa]),
  traslado: await cabecera(traslado),
  detalle: (await db.query("select producto_id, cantidad from traslado_detalle where traslado_id = $1 order by 1", [traslado])).rows,
})

describe("0056: enviar y recibir", () => {
  it("recepción física normal de varios productos: el destino suma solo al confirmar, con receptor y hora", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 5], [e.cubo, 3]], "Carga del lunes")

    expect(t).toMatchObject({ estado: "pendiente", repetida: false })
    expect([await existencia(e.bodega, e.cargador), await existencia(e.bodega, e.cubo)]).toEqual([15, 7])
    expect([await existencia(e.ruta, e.cargador), await existencia(e.ruta, e.cubo)]).toEqual([null, null])
    expect(await cabecera(t.traslado_id)).toMatchObject({ estado: "pendiente", unidades: 8, recibido_por: null, recibido_en: null })

    const r = await confirmar(e.rutero, t.traslado_id)

    expect(r).toMatchObject({ estado: "recibido", unidades: 8, confirmacion_administrativa: false, repetida: false })
    expect([await existencia(e.ruta, e.cargador), await existencia(e.ruta, e.cubo)]).toEqual([5, 3])
    expect(await cabecera(t.traslado_id)).toMatchObject({
      estado: "recibido", recibido_por: e.rutero.usuario, confirmacion_administrativa: false, observacion_recepcion: null,
    })
    expect((await cabecera(t.traslado_id)).recibido_por_nombre).toMatch(/^Vendedor/)
    expect(Date.now() - new Date((await cabecera(t.traslado_id)).recibido_en).getTime()).toBeLessThan(60000)
    expect(
      (await db.query("select tipo, ubicacion_id, cantidad, usuario_id from movimientos_inventario where traslado_id = $1 and tipo = 'traslado_entrada' order by cantidad", [t.traslado_id])).rows
    ).toEqual([
      { tipo: "traslado_entrada", ubicacion_id: e.ruta, cantidad: 3, usuario_id: e.rutero.usuario },
      { tipo: "traslado_entrada", ubicacion_id: e.ruta, cantidad: 5, usuario_id: e.rutero.usuario },
    ])
  })

  it("lo pendiente no se vende en el destino hasta confirmarlo", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 2]])
    const vender = () => como(e.rutero.authId, "select registrar_venta_ubicacion($1::jsonb)", [lista([[e.cargador, 1]])])

    expect((await falla(vender())).message).toMatch(/hay 0|suficiente|existencia/i)

    await confirmar(e.rutero, t.traslado_id)
    await vender()
    expect(await existencia(e.ruta, e.cargador)).toBe(1)
  })

  it("el administrador recibe normalmente en su propia ubicación, sin observación", async () => {
    const e = await escenario()
    const ida = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 4]])
    await confirmar(e.rutero, ida.traslado_id)
    const vuelta = await enviar(e.rutero, e.ruta, e.bodega, [[e.cargador, 1]])

    expect(await confirmar(e.admin, vuelta.traslado_id)).toMatchObject({ estado: "recibido", confirmacion_administrativa: false })
    expect(await cabecera(vuelta.traslado_id)).toMatchObject({ recibido_por: e.admin.usuario, observacion_recepcion: null })
  })

  it("confirmación administrativa en otra ubicación: exige observación y queda marcada por la base", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.gira, [[e.cubo, 2]])
    const antes = await foto(e, t.traslado_id)

    for (const sin of [null, "", "  ab "]) {
      expect((await falla(confirmar(e.admin, t.traslado_id, sin))).code).toBe("LT013")
    }
    expect(await foto(e, t.traslado_id)).toEqual(antes)

    const r = await confirmar(e.admin, t.traslado_id, "Ruta gira 1 no tiene usuario asignado")

    expect(r).toMatchObject({ estado: "recibido", confirmacion_administrativa: true })
    expect(await cabecera(t.traslado_id)).toMatchObject({
      confirmacion_administrativa: true, observacion_recepcion: "Ruta gira 1 no tiene usuario asignado", recibido_por: e.admin.usuario,
    })
    expect(await existencia(e.gira, e.cubo)).toBe(2)
  })

  it("confirmación administrativa de un traslado que envió el propio administrador, aunque sea su ubicación", async () => {
    const e = await escenario()
    const ida = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 3]])
    await confirmar(e.rutero, ida.traslado_id)
    const suyo = await enviar(e.admin, e.ruta, e.bodega, [[e.cargador, 2]])

    expect((await falla(confirmar(e.admin, suyo.traslado_id))).code).toBe("LT013")
    expect(await confirmar(e.admin, suyo.traslado_id, "Corrección: devuelto a bodega en persona")).toMatchObject({ confirmacion_administrativa: true })
  })

  it("una recepción normal ignora la observación: la marca no se pide ni se cambia desde el cliente", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 1]])

    expect(await confirmar(e.rutero, t.traslado_id, "Quiero que sea administrativa")).toMatchObject({ confirmacion_administrativa: false })
    expect(await cabecera(t.traslado_id)).toMatchObject({ confirmacion_administrativa: false, observacion_recepcion: null })

    expect((await falla(como(e.admin.authId, "update traslados set confirmacion_administrativa = true where id = $1", [t.traslado_id]))).code).toBe("42501")
    expect((await falla(db.query("update traslados set confirmacion_administrativa = true, observacion_recepcion = 'Cambio a mano' where id = $1", [t.traslado_id]))).code).toBe("42501")
    expect((await falla(db.query("update traslados set recibido_por = $2 where id = $1", [t.traslado_id, e.admin.usuario]))).code).toBe("42501")
  })
})

describe("0056: quién puede recibir", () => {
  it("se rechaza a quien no corresponde, y el rechazo no toca nada", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 2]])
    const otra = await crearEmpresa(db, "Otra empresa")
    const antes = await foto(e, t.traslado_id)

    for (const [quien, codigo] of [
      [e.bodeguero, "42501"], // el remitente, y además de otra ubicación
      [e.ruteroSoloPos, "42501"], // del destino pero sin permiso de inventario
      [e.todasEnBodega, "42501"], // «inventario de todas» no recibe en otra ubicación
      [e.inactivo, "LT010"], // sin sesión válida no tiene empresa: ni lo encuentra
      [e.debeCambiar, "LT010"],
      [e.contador, "42501"],
      [otra, "LT010"], // otra empresa ni lo encuentra
    ]) {
      expect([quien.usuario, (await falla(confirmar(quien, t.traslado_id))).code]).toEqual([quien.usuario, codigo])
      expect([quien.usuario, (await falla(reportar(quien, t.traslado_id, "Faltan dos unidades"))).code]).toEqual([quien.usuario, codigo])
    }

    expect((await falla(como(null, "select confirmar_recepcion_traslado($1) as r", [t.traslado_id]))).code).toBe("42501")
    expect(await foto(e, t.traslado_id)).toEqual(antes)
  })

  it("con «inventario de todas» en el destino sí recibe, pero no lo que él mismo envió", async () => {
    const e = await escenario()
    const suyo = await enviar(e.todasEnRuta, e.bodega, e.ruta, [[e.cargador, 1]])
    const ajeno = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 1]])

    expect((await falla(confirmar(e.todasEnRuta, suyo.traslado_id))).message).toMatch(/Quien envía/)
    expect(await confirmar(e.todasEnRuta, ajeno.traslado_id)).toMatchObject({ estado: "recibido" })
    expect(await confirmar(e.rutero, suyo.traslado_id)).toMatchObject({ estado: "recibido" })
  })

  it("la identidad del receptor sale de la sesión: la función no acepta otro usuario", async () => {
    const argumentos = (await db.query(
      "select pg_get_function_identity_arguments('public.confirmar_recepcion_traslado(uuid, text)'::regprocedure) as a"
    )).rows[0].a

    expect(argumentos).toBe("p_traslado uuid, p_observacion text")
  })

  it("permisos de las funciones: solo usuarios con sesión; las internas, nadie de la API", async () => {
    const r = (await db.query(`select
      has_function_privilege('anon', 'public.confirmar_recepcion_traslado(uuid, text)', 'EXECUTE') as anon_confirma,
      has_function_privilege('anon', 'public.reportar_incidencia_traslado(uuid, text)', 'EXECUTE') as anon_reporta,
      has_function_privilege('authenticated', 'public.confirmar_recepcion_traslado(uuid, text)', 'EXECUTE') as confirma,
      has_function_privilege('authenticated', 'public.reportar_incidencia_traslado(uuid, text)', 'EXECUTE') as reporta,
      has_function_privilege('authenticated', 'public.receptor_de_traslado(public.traslados)', 'EXECUTE') as interna1,
      has_function_privilege('authenticated', 'public.contenido_de_traslado(uuid)', 'EXECUTE') as interna2,
      has_table_privilege('authenticated', 'public.traslados', 'UPDATE') as escribe`)).rows[0]

    expect(r).toEqual({ anon_confirma: false, anon_reporta: false, confirma: true, reporta: true, interna1: false, interna2: false, escribe: false })
  })
})

describe("0056: una sola vez", () => {
  it("confirmar dos veces (un reintento tras perder la conexión) suma una sola vez", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 4]])

    await confirmar(e.rutero, t.traslado_id)
    const otra = await confirmar(e.rutero, t.traslado_id)

    expect(otra).toMatchObject({ estado: "recibido", repetida: true })
    expect(await existencia(e.ruta, e.cargador)).toBe(4)
    expect(await contar(db, "movimientos_inventario", "traslado_id = $1 and tipo = 'traslado_entrada'", [t.traslado_id])).toBe(1)
  })

  it("dos confirmaciones simultáneas: la segunda espera, ve el traslado recibido y no vuelve a sumar", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 4], [e.cubo, 2]])
    const sql = "select confirmar_recepcion_traslado($1, $2) as r"

    const { respuesta, error, espera } = await enDosSesiones(base, db, {
      primera: { authId: e.rutero.authId, hacer: (s) => s.query(sql, [t.traslado_id, null]) },
      segunda: { authId: e.admin.authId, hacer: (s) => s.query(sql, [t.traslado_id, "Confirmo por si acaso desde bodega"]) },
    })

    expect(espera).toMatch(/^Lock\//)
    expect(error).toBeUndefined()
    expect(respuesta.rows[0].r).toMatchObject({ repetida: true, confirmacion_administrativa: false })
    expect([await existencia(e.ruta, e.cargador), await existencia(e.ruta, e.cubo)]).toEqual([4, 2])
    expect(await contar(db, "movimientos_inventario", "traslado_id = $1 and tipo = 'traslado_entrada'", [t.traslado_id])).toBe(2)
    expect(await cabecera(t.traslado_id)).toMatchObject({ recibido_por: e.rutero.usuario })
  })

  it("recibir en una ubicación mientras se envía desde ella se ordena, sin bloquearse para siempre", async () => {
    const e = await escenario()
    const primero = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 5]])
    await confirmar(e.rutero, primero.traslado_id)
    const segundo = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 2]])

    const { error, espera } = await enDosSesiones(base, db, {
      primera: { authId: e.rutero.authId, hacer: (s) => s.query("select confirmar_recepcion_traslado($1) as r", [segundo.traslado_id]) },
      segunda: { authId: e.rutero.authId, hacer: (s) => s.query("select registrar_traslado($1, $2, $3::jsonb) as r", [e.ruta, e.bodega, lista([[e.cargador, 7]])]) },
    })

    expect(espera).toMatch(/^Lock\//)
    expect(error).toBeUndefined()
    expect(await existencia(e.ruta, e.cargador)).toBe(0)
  })

  it("si falla la entrada en el destino no se recibe nada", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 3], [e.cubo, 1]])
    const antes = await foto(e, t.traslado_id)

    await db.query("alter table movimientos_inventario add constraint prueba_sin_recepcion check (tipo <> 'traslado_entrada') not valid")
    try {
      expect((await falla(confirmar(e.rutero, t.traslado_id))).message).toMatch(/prueba_sin_recepcion/)
    } finally {
      await db.query("alter table movimientos_inventario drop constraint prueba_sin_recepcion")
    }

    expect(await foto(e, t.traslado_id)).toEqual(antes)
  })
})

describe("0056: la incidencia", () => {
  it("una por traslado, con observación de 5 a 500 caracteres; no toca el inventario y después se confirma", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 5]])
    const antes = await foto(e, t.traslado_id)

    expect((await falla(reportar(e.rutero, t.traslado_id, "   ab "))).code).toBe("LT016")
    expect((await falla(reportar(e.rutero, t.traslado_id, "x".repeat(501)))).code).toBe("LT016")

    const r = await reportar(e.rutero, t.traslado_id, "  Llegaron 4, falta 1  ")
    expect(r).toMatchObject({ estado: "con_incidencia", incidencia: "Llegaron 4, falta 1", repetida: false })
    expect(await reportar(e.rutero, t.traslado_id, "Llegaron 4, falta 1")).toMatchObject({ repetida: true })
    expect((await falla(reportar(e.rutero, t.traslado_id, "Otra observación distinta"))).code).toBe("LT015")
    expect((await falla(reportar(e.admin, t.traslado_id, "El administrador también quiere reportar"))).code).toBe("LT015")

    const despues = await foto(e, t.traslado_id)
    expect([despues.celdas, despues.movimientos, despues.detalle]).toEqual([antes.celdas, antes.movimientos, antes.detalle])
    expect(despues.traslado).toMatchObject({ estado: "con_incidencia", incidencia_por: e.rutero.usuario })

    expect(await confirmar(e.rutero, t.traslado_id)).toMatchObject({ estado: "recibido" })
    expect(await cabecera(t.traslado_id)).toMatchObject({ estado: "recibido", incidencia: "Llegaron 4, falta 1" })
    expect(await existencia(e.ruta, e.cargador)).toBe(5)
  })

  it("no se reporta sobre lo ya recibido, y el administrador puede reportar en cualquier destino", async () => {
    const e = await escenario()
    const recibido = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 1]])
    await confirmar(e.rutero, recibido.traslado_id)
    expect((await falla(reportar(e.rutero, recibido.traslado_id, "Tarde para reportar"))).code).toBe("LT011")

    const otro = await enviar(e.bodeguero, e.bodega, e.gira, [[e.cargador, 1]])
    expect(await reportar(e.admin, otro.traslado_id, "Destino equivocado: era para Ruta local")).toMatchObject({ estado: "con_incidencia" })
  })
})

describe("0056: destino y producto desactivados", () => {
  /*
    Una ubicación que es la operativa de algún usuario no se puede
    desactivar (regla anterior a la 0056); por eso el caso es Ruta gira 1,
    sin usuarios, donde recibe el administrador.
  */
  it("un destino desactivado no recibe hasta reactivarlo, y no se pierde nada", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.gira, [[e.cargador, 2]])
    const antes = await foto(e, t.traslado_id)
    const motivo = "Ruta gira 1 no tiene usuario asignado"

    await db.query("update ubicaciones set activa = false where id = $1", [e.gira])
    const rechazo = await falla(confirmar(e.admin, t.traslado_id, motivo))
    expect(rechazo.code).toBe("LT012")
    expect(rechazo.message).toMatch(/reactívala/)
    expect(await foto(e, t.traslado_id)).toEqual(antes)

    await db.query("update ubicaciones set activa = true where id = $1", [e.gira])
    expect(await confirmar(e.admin, t.traslado_id, motivo)).toMatchObject({ estado: "recibido" })
    expect(await existencia(e.gira, e.cargador)).toBe(2)
  })

  it("un producto desactivado después de enviarlo se recibe", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cubo, 2]])

    await db.query("update productos set activo = false where id = $1", [e.cubo])
    expect(await confirmar(e.rutero, t.traslado_id)).toMatchObject({ estado: "recibido" })
    expect(await existencia(e.ruta, e.cubo)).toBe(2)
  })
})

describe("0056: el contenido enviado no cambia", () => {
  it("ni las cantidades, ni los renglones, ni la huella, ni lo enviado de la cabecera", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 3], [e.cubo, 1]])
    const antes = await foto(e, t.traslado_id)

    for (const sql of [
      "update traslado_detalle set cantidad = 30 where traslado_id = $1",
      "delete from traslado_detalle where traslado_id = $1",
      "update traslados set contenido_huella = md5('otra') where id = $1",
      "update traslados set unidades = 1 where id = $1",
      "update traslados set destino_id = origen_id where id = $1",
    ]) {
      expect([sql, (await falla(db.query(sql, [t.traslado_id]))).code]).toEqual([sql, "42501"])
    }

    // Marcarlo recibido a mano, sin receptor ni fecha, lo impide la restricción de coherencia.
    expect((await falla(db.query("update traslados set estado = 'recibido' where id = $1", [t.traslado_id]))).code).toBe("23514")

    // Borrar el producto (solo podría el dueño de la base) se rechaza mientras el traslado no se recibe.
    expect((await falla(db.query("delete from productos where id = $1", [e.cubo]))).code).toBe("42501")
    expect(await foto(e, t.traslado_id)).toEqual(antes)
  })

  it("si el contenido cambió por fuera, no se confirma ni se reporta, y nada se mueve", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 3], [e.cubo, 1]])

    // Simula una alteración que esquivara los disparadores.
    await db.query("alter table traslado_detalle disable trigger traslado_detalle_protegido")
    await db.query("update traslado_detalle set cantidad = 30 where traslado_id = $1 and producto_id = $2", [t.traslado_id, e.cargador])
    await db.query("alter table traslado_detalle enable trigger traslado_detalle_protegido")

    const antes = await foto(e, t.traslado_id)
    const confirmacion = await falla(confirmar(e.rutero, t.traslado_id))

    expect(confirmacion.code).toBe("LT014")
    expect(confirmacion.message).toMatch(/Comunícate con el administrador/)
    expect((await falla(confirmar(e.admin, t.traslado_id, "Intento administrativo"))).code).toBe("LT014")
    expect((await falla(reportar(e.rutero, t.traslado_id, "Faltan unidades"))).code).toBe("LT014")
    expect(await foto(e, t.traslado_id)).toEqual(antes)
    expect(antes.traslado.estado).toBe("pendiente")
  })

  it("un renglón agregado por fuera también se detecta; y a lo recibido no se le agregan renglones", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 1]])

    await db.query("insert into traslado_detalle (traslado_id, empresa_id, producto_id, cantidad) values ($1, $2, $3, 5)", [t.traslado_id, e.empresa, e.cubo])
    expect((await falla(confirmar(e.rutero, t.traslado_id))).code).toBe("LT014")

    const recibido = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 1]])
    await confirmar(e.rutero, recibido.traslado_id)
    expect((await falla(db.query("insert into traslado_detalle (traslado_id, empresa_id, producto_id, cantidad) values ($1, $2, $3, 5)", [recibido.traslado_id, e.empresa, e.cubo]))).code).toBe("42501")
  })

  it("lo recibido sigue como antes: un producto que el dueño borra se lleva sus renglones recibidos", async () => {
    const e = await escenario()
    const efimero = (await db.query("insert into productos (empresa_id, codigo, nombre, precio) values ($1, 'EF-1', 'Efímero', 1) returning id", [e.empresa])).rows[0].id
    await como(e.admin.authId, "select registrar_movimiento_ubicacion($1, $2, 'entrada', 2)", [efimero, e.bodega])
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[efimero, 2]])
    await confirmar(e.rutero, t.traslado_id)

    await db.query("delete from productos where id = $1", [efimero])
    expect(await contar(db, "traslado_detalle", "traslado_id = $1", [t.traslado_id])).toBe(0)
  })

  it("enviar sigue funcionando igual: crea su cabecera pendiente y sus renglones", async () => {
    const e = await escenario()
    const t = await enviar(e.bodeguero, e.bodega, e.ruta, [[e.cargador, 2], [e.cubo, 2]])

    expect(await contar(db, "traslado_detalle", "traslado_id = $1", [t.traslado_id])).toBe(2)
    expect(await cabecera(t.traslado_id)).toMatchObject({ estado: "pendiente", unidades: 4 })
  })
})
