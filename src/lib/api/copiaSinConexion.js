import { supabase } from "../supabase"

import { traerClientes, traerProductos } from "./catalogos"
import { traerExistenciasPorUbicacion } from "./existencias"

/*
  La copia local con la que el POS vende sin conexión (ver
  sinConexion/copiaLocal.js): se descarga con conexión, desde las mismas
  consultas que usa la aplicación en línea, así que el vendedor no ve nada
  que no pudiera ver ya.

  Solo se baja el catálogo, la existencia y los clientes si la ubicación
  está habilitada para vender sin conexión. Una ubicación fiscal nunca lo
  está: la base lo impide (0027) y aquí se vuelve a comprobar.

  `tomadaEn` es el momento ANTES de pedir los datos: una venta confirmada
  mientras se descargaba se descuenta de más, nunca de menos.
*/

const COLUMNAS_UBICACION = "id, nombre, activa, vende, emite_fiscal, vende_sin_conexion"
const COLUMNAS_EMPRESA = "id, nombre, direccion, telefono, moneda, tasa_isv"

async function leerUna(consulta, queHacia) {
  const { data, error } = await consulta

  if (error) {
    console.error(`No se pudo ${queHacia}:`, error)
    throw new Error(`No se pudo ${queHacia}.`)
  }

  return data
}

const aProductoDeCopia = (p) => ({
  id: p.id,
  codigo: p.code || "",
  nombre: p.name,
  precio: Number(p.price) || 0,
  categoria: p.category || "",
})

const aClienteDeCopia = (c) => ({
  id: c.id,
  nombre: c.name,
  rtn: c.rtn || "",
  telefono: c.phone || "",
  direccion: c.address || "",
})

export async function descargarCopia({ perfil, ahora = () => new Date() }) {
  const ubicacionId = perfil?.locationId || perfil?.ubicacion_id || ""

  if (!ubicacionId || !perfil?.authId || !perfil?.empresa_id) return null

  const tomadaEn = ahora().toISOString()

  const [fila, empresa] = await Promise.all([
    leerUna(
      supabase.from("ubicaciones").select(COLUMNAS_UBICACION).eq("id", ubicacionId).maybeSingle(),
      "consultar tu ubicación"
    ),
    leerUna(supabase.from("empresas").select(COLUMNAS_EMPRESA).limit(1).maybeSingle(), "consultar la empresa"),
  ])

  if (!fila) throw new Error("No se encontró tu ubicación.")

  const emiteFiscal = Boolean(fila.emite_fiscal)
  const vendeSinConexion = Boolean(fila.vende_sin_conexion) && !emiteFiscal && fila.activa !== false && fila.vende !== false

  const copia = {
    empresaId: perfil.empresa_id,
    usuarioAuth: perfil.authId,
    ubicacionId,
    ubicacion: { id: fila.id, nombre: fila.nombre, vendeSinConexion, emiteFiscal },
    empresa: {
      nombre: empresa?.nombre || "",
      direccion: empresa?.direccion || "",
      telefono: empresa?.telefono || "",
      moneda: empresa?.moneda || "L",
      tasaIsv: Number(empresa?.tasa_isv ?? 15),
    },
    productos: [],
    existencias: {},
    clientes: [],
    clientesDisponibles: false,
    tomadaEn,
  }

  if (!vendeSinConexion) return copia

  const [productos, existencias, clientes] = await Promise.all([
    traerProductos(),
    traerExistenciasPorUbicacion(),
    traerClientes().then(
      (lista) => ({ lista }),
      () => ({ fallo: true })
    ),
  ])

  copia.productos = productos.map(aProductoDeCopia)
  copia.existencias = Object.fromEntries(productos.map((p) => [p.id, 0]))

  for (const celda of existencias) {
    if (celda.locationId === ubicacionId && celda.productId in copia.existencias) {
      copia.existencias[celda.productId] = celda.quantity
    }
  }

  // Sin clientes no hay crédito sin conexión; el contado sigue funcionando.
  copia.clientesDisponibles = !clientes.fallo
  copia.clientes = clientes.fallo ? [] : clientes.lista.map(aClienteDeCopia)

  return copia
}
