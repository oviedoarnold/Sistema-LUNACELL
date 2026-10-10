/*
  Ayudas para las pruebas del motor sin conexión.

  Cada prueba usa su propia IndexedDB en memoria (fake-indexeddb, solo para
  pruebas): dos instancias son dos navegadores distintos, y volver a abrir
  la misma instancia es cerrar la pestaña y abrirla de nuevo.
*/
import { IDBFactory } from "fake-indexeddb"

import { abrirAlmacen } from "../almacen"

export const EMPRESA = "empresa-1"
export const UBICACION = "camion-01"
export const VENDEDOR = "auth-vendedor"
export const OTRO_VENDEDOR = "auth-otro"

export const DUENO = { empresaId: EMPRESA, usuarioAuth: VENDEDOR, ubicacionId: UBICACION }

export function nuevoNavegador() {
  const indexedDB = new IDBFactory()

  return {
    indexedDB,
    abrir: () => abrirAlmacen({ indexedDB }),
  }
}

export const CARGADOR = { id: "11111111-1111-4111-8111-111111111111", codigo: "11", nombre: "Cargador", precio: 150 }
export const CUBO = { id: "22222222-2222-4222-8222-222222222222", codigo: "12", nombre: "Cubo Iphone", precio: 50 }
export const CLIENTE = { id: "33333333-3333-4333-8333-333333333333", nombre: "Ferremax", rtn: "0801" }

export function copiaDePrueba(cambios = {}) {
  return {
    ...DUENO,
    ubicacion: { id: UBICACION, nombre: "Camión 01", vendeSinConexion: true },
    empresa: { tasaIsv: 15 },
    productos: [CARGADOR, CUBO],
    existencias: { [CARGADOR.id]: 10, [CUBO.id]: 4 },
    clientes: [CLIENTE],
    tomadaEn: "2026-10-10T10:00:00.000Z",
    ...cambios,
  }
}

export const sesionDe = (usuarioAuth = VENDEDOR, cambios = {}) => ({
  usuarioAuth,
  empresaId: EMPRESA,
  ubicacionId: UBICACION,
  ...cambios,
})

let reloj = Date.parse("2026-10-10T12:00:00.000Z")
export const ahoraDePrueba = () => new Date((reloj += 1000))
