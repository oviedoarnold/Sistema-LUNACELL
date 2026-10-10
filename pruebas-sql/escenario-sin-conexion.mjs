/*
  Escenario y ayudas para las pruebas de ventas sin conexión (OFF-1.1).

  Todo se inventa aquí, en la base desechable: una empresa con su
  administrador, el Camión 01 habilitado para vender sin conexión, el
  Camión 02, una tienda fiscal, dos productos con existencia y un vendedor
  con permiso de facturar. Nada sale de producción.
*/

import { randomUUID } from "node:crypto"

import { comoUsuario, comoDueno } from "./arnes.mjs"
import { crearEmpresa, crearVendedor, crearCliente } from "./fixtures.mjs"

export async function escenarioSinConexion(
  db,
  { enCamion1 = 10, cubosEnCamion1 = 4, precio = 100, tasa = 15, habilitado = true } = {}
) {
  const admin = await crearEmpresa(db, "Empresa sin conexión")
  const { empresa } = admin

  await db.query("update empresas set tasa_isv = $1 where id = $2", [tasa, empresa])

  const ubicacion = async (nombre, tipo) =>
    (
      await db.query(
        `insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id`,
        [empresa, nombre, tipo]
      )
    ).rows[0].id

  const camion1 = await ubicacion("Camión 01", "camion")
  const camion2 = await ubicacion("Camión 02", "camion")
  const tienda = await ubicacion("Tienda", "tienda")

  await db.query("update ubicaciones set vende_sin_conexion = $1 where id = $2", [habilitado, camion1])

  const producto = async (nombre, pr) =>
    (
      await db.query(
        `insert into productos (empresa_id, codigo, nombre, precio, costo)
         values ($1, $2, $3, $4, 10) returning id, codigo, nombre`,
        [empresa, `C-${randomUUID().slice(0, 8)}`, nombre, pr]
      )
    ).rows[0]

  const cargador = await producto("Cargador", precio)
  const cubo = await producto("Cubo Iphone", 50)

  const celda = (u, p, c) =>
    db.query(
      `insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
       values ($1, $2, $3, $4)`,
      [empresa, u, p, c]
    )

  if (enCamion1 !== null) await celda(camion1, cargador.id, enCamion1)
  if (cubosEnCamion1 !== null) await celda(camion1, cubo.id, cubosEnCamion1)
  await celda(camion2, cargador.id, 20)

  const vendedor = await crearVendedor(db, { empresa, ubicacion: camion1, permisos: ["pos"] })
  const clienteId = await crearCliente(db, empresa)

  return { admin, empresa, camion1, camion2, tienda, cargador, cubo, vendedor, clienteId, tasa }
}

/* Igual que el POS y que la base: cada renglón se redondea, el ISV sobre el subtotal. */
export function totalDe(renglones, tasa) {
  const centavos = renglones.reduce((suma, r) => suma + Math.round(r.precio_unitario * 100) * r.cantidad, 0)
  const isv = Math.round((centavos * tasa) / 100)

  return (centavos + isv) / 100
}

let secuencia = 0

/*
  Una venta tal como la guardaría el teléfono. Los totales salen de los
  renglones, así que cambiar un renglón cambia el total con él.
*/
export function ventaSinConexion(esc, cambios = {}) {
  secuencia += 1

  const ahora = Date.now()
  const renglones = cambios.renglones || [
    {
      producto_id: esc.cargador.id,
      codigo: esc.cargador.codigo,
      nombre: esc.cargador.nombre,
      cantidad: 2,
      precio_unitario: 100,
    },
  ]
  const tasa = cambios.tasa_isv ?? esc.tasa

  return {
    clave_idempotencia: `off-DISP0001-${randomUUID()}`,
    usuario_auth: esc.vendedor.authId,
    ubicacion_id: esc.camion1,
    dispositivo: "DISP0001",
    numero_provisional: `PROV-DISP0001-${String(secuencia).padStart(4, "0")}`,
    registrada_en: new Date(ahora - 5 * 60000).toISOString(),
    reloj_dispositivo: new Date(ahora).toISOString(),
    tasa_isv: tasa,
    total_cobrado: totalDe(renglones, tasa),
    forma_pago: "contado",
    cliente_id: null,
    nombre_cliente: "Consumidor Final",
    rtn_comprador: "",
    fecha_vencimiento: null,
    nota: "",
    ...cambios,
    renglones,
  }
}

const PARAMETROS = `
  p_clave_idempotencia => $1, p_usuario_auth => $2, p_ubicacion_id => $3,
  p_dispositivo => $4, p_numero_provisional => $5, p_registrada_en => $6,
  p_reloj_dispositivo => $7, p_tasa_isv => $8, p_renglones => $9::jsonb,
  p_total_cobrado => $10, p_forma_pago => $11, p_cliente_id => $12,
  p_nombre_cliente => $13, p_rtn_comprador => $14, p_fecha_vencimiento => $15,
  p_nota => $16`

const valoresDe = (v) => [
  v.clave_idempotencia,
  v.usuario_auth,
  v.ubicacion_id,
  v.dispositivo,
  v.numero_provisional,
  v.registrada_en,
  v.reloj_dispositivo,
  v.tasa_isv,
  JSON.stringify(v.renglones),
  v.total_cobrado,
  v.forma_pago,
  v.cliente_id,
  v.nombre_cliente,
  v.rtn_comprador,
  v.fecha_vencimiento,
  v.nota,
]

/* La llamada, en una conexión que ya habla como el usuario que corresponda. */
export const llamarSincronizar = (conexion, venta) =>
  conexion
    .query(`select public.sincronizar_venta_sin_conexion(${PARAMETROS}) as r`, valoresDe(venta))
    .then((res) => res.rows[0].r)

export const llamarRescatar = (conexion, venta, lote = "lote-1") =>
  conexion
    .query(
      `select public.rescatar_venta_sin_conexion(${PARAMETROS}, p_lote => $17) as r`,
      [...valoresDe(venta), lote]
    )
    .then((res) => res.rows[0].r)

/* La llamada como ese usuario; la conexión vuelve a ser del dueño. */
async function comoQuien(db, authId, hacer) {
  await comoUsuario(db, authId)

  try {
    return await hacer(db)
  } finally {
    await comoDueno(db)
  }
}

export const sincronizar = (db, authId, venta) => comoQuien(db, authId, (c) => llamarSincronizar(c, venta))

export const rescatar = (db, authId, venta, lote) => comoQuien(db, authId, (c) => llamarRescatar(c, venta, lote))

export const conciliar = (db, authId, id, accion, motivo = "Revisado con el vendedor") =>
  comoQuien(db, authId, (c) =>
    c
      .query("select public.conciliar_venta($1, $2, $3) as r", [id, accion, motivo])
      .then((res) => res.rows[0].r)
  )

/* El error de una llamada que debe fallar, con su código. */
export async function fallo(promesa) {
  try {
    await promesa
  } catch (error) {
    return error
  }

  throw new Error("Se esperaba un error y la llamada salió bien")
}

export async function existencia(db, ubicacion, producto) {
  const r = await db.query(
    "select cantidad from inventario_ubicacion where ubicacion_id = $1 and producto_id = $2",
    [ubicacion, producto]
  )

  return r.rows[0] ? Number(r.rows[0].cantidad) : 0
}

export async function correlativoInterno(db, empresa) {
  const r = await db.query("select proximo_correlativo_interno as n from empresas where id = $1", [empresa])

  return Number(r.rows[0].n)
}
