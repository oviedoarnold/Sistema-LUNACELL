import { crearSupabaseFalso } from "./supabaseFalso"

export const EMPRESA_PRUEBA = "empresa-prueba"

/*
  Deja un doble de Supabase disponible para el mock del módulo.

  Cada archivo de prueba declara su propio vi.mock apuntando a
  globalThis.__supabaseFalso, porque vi.mock se eleva al inicio del
  archivo y no puede recibir valores calculados aquí.
*/
export function montarSupabaseFalso({
  usuarios = [],
  permisos = [],
  cuentas = [],
  sesionInicial = null,
  tablasExtra = {},
} = {}) {
  const falso = crearSupabaseFalso({
    tablas: {
      usuarios,
      permisos_usuario: permisos,
      ...tablasExtra,
    },
    cuentas,
    sesionInicial,
  })

  globalThis.__supabaseFalso = falso

  return falso
}

export function usuarioDePrueba({
  id = "u-1",
  authId = "auth-1",
  email = "persona@ferreteria.test",
  nombre = "Persona de prueba",
  rol = "vendedor",
  activo = true,
} = {}) {
  return {
    id,
    auth_id: authId,
    empresa_id: EMPRESA_PRUEBA,
    email,
    nombre,
    rol,
    activo,
    entro_en: "2026-01-01",
  }
}

export function permisosDe(usuarioId, secciones) {
  return secciones.map((seccion) => ({
    usuario_id: usuarioId,
    empresa_id: EMPRESA_PRUEBA,
    seccion,
  }))
}

export const sesionDe = (authId) => ({ user: { id: authId } })
