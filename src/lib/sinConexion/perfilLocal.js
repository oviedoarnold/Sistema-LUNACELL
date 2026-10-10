/*
  El perfil con el que un vendedor entra al POS sin conexión.

  Sin red, Supabase no puede renovar el token y la sesión se ve vacía; sin
  esto el vendedor quedaría afuera justo cuando más lo necesita. Cada vez
  que el servidor confirma quién es, se guarda aquí lo mínimo para facturar
  sin conexión: quién es, de qué empresa, desde qué ubicación y sus
  permisos. Nada de correo ni datos que no hagan falta.

  Ese perfil solo abre el POS sin conexión (AuthContext lo marca con
  `sinConexion`). Para que una venta llegue al servidor hace falta una
  sesión real: el servidor comprueba quién la envía.

  Vence a los VIGENCIA_DEL_PERFIL_HORAS de la última confirmación (el mismo
  margen de 7 días con que el servidor acepta ventas atrasadas) y se borra
  al cerrar sesión.
*/

const LLAVE = "perfil_sin_conexion"
export const VIGENCIA_DEL_PERFIL_HORAS = 168

const HORA = 3600000

export async function guardarPerfilLocal(almacen, perfil, { ahora = () => new Date() } = {}) {
  // Con la contraseña temporal pendiente, la base no le deja operar: tampoco sin conexión.
  if (!perfil?.authId || perfil.debeCambiar) return borrarPerfilLocal(almacen)

  const valor = {
    id: perfil.id,
    empresa_id: perfil.empresa_id,
    nombre: perfil.nombre ?? perfil.name ?? "",
    nombre_usuario: perfil.nombre_usuario ?? perfil.username ?? "",
    rol: perfil.rol ?? perfil.role,
    ubicacion_id: perfil.ubicacion_id ?? perfil.locationId ?? "",
    authId: perfil.authId,
    permissions: Array.isArray(perfil.permissions) ? [...perfil.permissions] : [],
    guardadoEn: ahora().toISOString(),
  }

  await almacen.transaccion(["meta"], "readwrite", (t) => t.poner("meta", { clave: LLAVE, valor }))
}

export async function leerPerfilLocal(almacen, authId, { ahora = () => new Date() } = {}) {
  const fila = await almacen.leer("meta", LLAVE)
  const valor = fila?.valor

  if (!valor || !authId || valor.authId !== authId) return null

  const edad = ahora().getTime() - Date.parse(valor.guardadoEn)
  if (!(edad >= 0 && edad <= VIGENCIA_DEL_PERFIL_HORAS * HORA)) return null

  return {
    id: valor.id,
    empresa_id: valor.empresa_id,
    nombre: valor.nombre,
    name: valor.nombre,
    nombre_usuario: valor.nombre_usuario,
    username: valor.nombre_usuario,
    rol: valor.rol,
    role: valor.rol,
    ubicacion_id: valor.ubicacion_id,
    locationId: valor.ubicacion_id,
    authId: valor.authId,
    permissions: valor.permissions,
    debeCambiar: false,
    sinConexion: true,
    confirmadoEn: valor.guardadoEn,
  }
}

export function borrarPerfilLocal(almacen) {
  return almacen.transaccion(["meta"], "readwrite", (t) => t.borrar("meta", LLAVE))
}
