/*
  Un solo envío por dispositivo.

  Dos pestañas abiertas en el mismo teléfono comparten la cola. Si las dos
  sincronizaran a la vez, enviarían las mismas ventas; el servidor no las
  duplicaría (idempotencia), pero sería trabajo doble y estados que se pisan.

  Se usa la Web Locks API cuando existe (Chrome, Edge, Safari 15.4+, Firefox
  96+): `ifAvailable` hace que la segunda pestaña no espere, se omita. Si no
  existe, un turno en el almacén local con vencimiento hace lo mismo; si una
  pestaña muere con el turno tomado, vence solo.

  El turno dura DURACION desde la última renovación: el trabajo llama a
  `renovar()` antes de cada envío. Si al renovar resulta que otra pestaña ya
  lo tomó (venció), `renovar()` devuelve false y el trabajo debe parar. Con
  Web Locks, `renovar()` siempre devuelve true: el candado dura lo que dure
  el trabajo.
*/

const NOMBRE = "lunacell-sincronizacion"
const TURNO = "candado_sincronizacion"
export const DURACION_DEL_TURNO = 60000

export const OMITIDO = { omitido: "otra_pestana" }

export async function conCandado(almacen, trabajo, { locks = globalThis.navigator?.locks, ahora = () => new Date() } = {}) {
  if (locks?.request) {
    return locks.request(NOMBRE, { ifAvailable: true }, (candado) => (candado ? trabajo({ renovar: async () => true }) : OMITIDO))
  }

  const mio = crypto.randomUUID()

  /*
    Tomar: solo si nadie lo tiene o el turno de otra pestaña venció.
    Renovar: solo si sigue siendo de esta ronda; si otra pestaña lo tomó
    (porque venció), esta ronda lo perdió y debe parar.
  */
  const turno = (renovando) =>
    almacen.transaccion(["meta"], "readwrite", async (t) => {
      const actual = await t.leer("meta", TURNO)
      const momento = ahora().getTime()
      const esMio = actual?.valor.dueno === mio
      const libre = !actual || esMio || actual.valor.vence <= momento

      if (!(renovando ? esMio : libre)) return false

      await t.poner("meta", { clave: TURNO, valor: { dueno: mio, vence: momento + DURACION_DEL_TURNO } })

      return true
    })

  if (!(await turno(false))) return OMITIDO

  const renovar = () => turno(true)

  try {
    return await trabajo({ renovar })
  } finally {
    await almacen.transaccion(["meta"], "readwrite", async (t) => {
      const actual = await t.leer("meta", TURNO)
      if (actual?.valor.dueno === mio) await t.borrar("meta", TURNO)
    })
  }
}
