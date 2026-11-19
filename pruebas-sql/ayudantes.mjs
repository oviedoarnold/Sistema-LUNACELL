/*
  Lo que repetían las pruebas de pedidos y liquidaciones contra PostgreSQL:
  una base propia por archivo, consultar como un usuario, el error de una
  operación que debe fallar y la empresa con Bodega, Ruta local y Camión 01.
  No cambia ninguna prueba: solo las escribe una vez.
*/

import { randomUUID } from "node:crypto"
import { beforeAll, afterAll } from "vitest"

import { levantarBase, consultarComo } from "./arnes.mjs"
import { crearEmpresa, crearCliente, crearVendedor } from "./fixtures.mjs"

/*
  Levanta la base del archivo antes de sus pruebas y la apaga al terminar.
  `alLevantar` recibe la base, para quien necesite `base` (dos sesiones) y
  `db` (el dueño). Devuelve `como` y `fila`, que consultan como un usuario.
*/
export function usarBaseDePrueba(alLevantar) {
  let base = null
  let db = null

  beforeAll(async () => {
    base = await levantarBase()
    db = base.admin
    alLevantar(base)
  }, 180000)

  afterAll(() => base?.cerrar())

  const como = (authId, consulta, valores = []) => consultarComo(db, authId, consulta, valores)
  const fila = async (authId, consulta, valores) => (await como(authId, consulta, valores)).rows[0]?.r

  return { como, fila }
}

export const num = (valor) => (valor === null || valor === undefined ? valor : Number(valor))

// El error de una operación que debe fallar; si pasa, la prueba falla.
export async function falla(promesa) {
  try {
    await promesa
  } catch (error) {
    return { code: error.code, message: error.message }
  }

  throw new Error("Se esperaba un error y la operación pasó")
}

/*
  Una empresa con Bodega (origen), Ruta local (destino) y Camión 01 (una
  tercera ubicación), el cargador de 100 con existencia en Bodega, un cliente
  y cómo crear vendedores. El administrador queda sin ubicación.
*/
export async function empresaConTresUbicaciones(db, { nombre, tasaIsv, existencia, nombreCliente }) {
  const admin = await crearEmpresa(db, nombre)
  const { empresa } = admin

  await db.query("update empresas set tasa_isv = $2, tasa_cargo_tarjeta = 1.7, tasa_cargo_enlace = 1.7 where id = $1", [empresa, tasaIsv])
  await db.query("update usuarios set ubicacion_id = null where id = $1", [admin.usuario])

  const ubicacion = async (nombreDeUbicacion, tipo) =>
    (await db.query(`insert into ubicaciones (empresa_id, nombre, tipo) values ($1, $2, $3) returning id`, [empresa, nombreDeUbicacion, tipo])).rows[0].id

  const bodega = await ubicacion("Bodega", "bodega")
  const ruta = await ubicacion("Ruta local", "camion")
  const camion1 = await ubicacion("Camión 01", "camion")

  const cargador = (
    await db.query(`insert into productos (empresa_id, codigo, nombre, precio, costo) values ($1, $2, 'Cargador', 100, 37) returning id`, [
      empresa,
      `C-${randomUUID().slice(0, 8)}`,
    ])
  ).rows[0].id

  await db.query(`insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad) values ($1, $2, $3, $4)`, [empresa, bodega, cargador, existencia])

  const cliente = await crearCliente(db, empresa, nombreCliente)
  const vendedor = (u, permisos) => crearVendedor(db, { empresa, ubicacion: u, permisos })

  return { admin, empresa, bodega, ruta, camion1, cargador, cliente, vendedor }
}
