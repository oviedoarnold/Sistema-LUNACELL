/*
  Ayudantes de las pruebas que aplican una migración sobre una base que ya tiene
  operaciones, como en producción: base, escenario, una venta con la versión publicada
  y el código de las funciones para comparar lo que cambió.
*/

import { beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo } from "./arnes.mjs"
import { escenarioSinConexion } from "./escenario-sin-conexion.mjs"

// Levanta la base hasta `hasta` y arma el escenario; el contexto se llena en beforeAll.
export function baseConOperaciones(hasta) {
  const contexto = {}

  beforeAll(async () => {
    contexto.base = await levantarBase({ hasta })
    contexto.db = contexto.base.admin
    contexto.e = await escenarioSinConexion(contexto.db, { enCamion1: 100 })
  }, 180000)

  afterAll(async () => {
    await contexto.base?.cerrar()
  })

  return contexto
}

// Una venta tal como la manda la versión publicada del POS.
export async function venderComoLaVersionPublicada({ db, e }, cobros, clave = null) {
  const { rows } = await consultarComo(
    db,
    e.vendedor.authId,
    `select public.registrar_venta_con_medios(
       p_items => $1::jsonb, p_forma_pago => 'contado', p_cobros => $2::jsonb,
       p_cliente_id => $3, p_clave_idempotencia => $4) as r`,
    [JSON.stringify([{ producto_id: e.cargador.id, cantidad: 1 }]), JSON.stringify(cobros), e.clienteId, clave]
  )

  return rows[0].r
}

export const firmaDe = async (db, nombre) =>
  (await db.query("select oid::regprocedure::text as firma from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [nombre])).rows[0].firma

export const cuerpoDe = async (db, firma) =>
  (await db.query("select replace(prosrc, chr(13), '') as cuerpo from pg_proc where oid = $1::regprocedure", [firma])).rows[0].cuerpo

// Sin comentarios ni espacios de más: lo que se compara es el código.
export const soloCodigo = (cuerpo) =>
  cuerpo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()

// Un reintento de la venta guardada antes de migrar, y una nueva: las dos como siempre.
export async function siguenVendiendoIgual(contexto, clave) {
  const tarjeta = [{ medio: "tarjeta", monto: 115, referencia: "", cargo: 8.05 }]
  const repetida = await venderComoLaVersionPublicada(contexto, tarjeta, clave)
  const nueva = await venderComoLaVersionPublicada(contexto, [{ medio: "efectivo", monto: 115 }])

  return { repetida, nueva }
}

// Lo que una migración no debe cambiar. `detalle` elige las columnas que ya existían.
export async function fotoDeDatos({ db, e }, { detalle = "*", tablas = [] } = {}) {
  const filas = async (consulta, valores) => (await db.query(consulta, valores)).rows
  const foto = {
    ventas: await filas("select * from ventas order by id"),
    detalle: await filas(`select ${detalle} from detalle_venta order by id`),
    correlativos: await filas("select proximo_correlativo_factura, proximo_correlativo_interno from empresas where id = $1", [e.empresa]),
    inventario: await filas("select * from inventario_ubicacion order by ubicacion_id, producto_id"),
  }

  for (const tabla of ["cobros_por_medio", "clientes", "productos", ...tablas]) {
    foto[tabla] = await filas(`select * from ${tabla} order by id`)
  }

  return foto
}
