/*
  ⚠ Este hash NO protege contraseñas. Es el hashCode de Java: 32 bits,
  trivial de colisionar. Sirve mientras el sistema es una demostración
  con datos propios.

  El ADR-1 documenta el reemplazo por la autenticación de Supabase, que
  trae hashing serio, antes de que un cliente registre a sus empleados.
*/
export function hashPassword(value = "") {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index)
  }

  return `h${(hash >>> 0).toString(36)}`
}
