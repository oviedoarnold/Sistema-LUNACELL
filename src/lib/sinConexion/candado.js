/*
  Un solo envío por dispositivo.

  Dos pestañas abiertas en el mismo teléfono comparten la cola. Si las dos
  sincronizaran a la vez, enviarían las mismas ventas; el servidor no las
  duplicaría (idempotencia), pero sería trabajo doble y estados que se pisan.

  Se usa la Web Locks API cuando existe (Chrome, Edge, Safari 15.4+, Firefox
  96+): `ifAvailable` hace que la segunda pestaña no espere, se omita. Si no
  existe, un turno en el almacén local con vencimiento hace lo mismo; si una
  pestaña muere con el turno tomado, vence solo.
*/

const NOMBRE = "lunacell-sincronizacion"
const TURNO = "candado_sincronizacion"
const DURACION = 60000

export const OMITIDO = { omitido: "otra_pestana" }

export async function conCandado(almacen, trabajo, { locks = globalThis.navigator?.locks, ahora = () => new Date() } = {}) {
  if (locks?.request) {
    return locks.request(NOMBRE, { ifAvailable: true }, (candado) => (candado ? trabajo() : OMITIDO))
  }

  const mio = crypto.randomUUID()

  const tomado = await almacen.transaccion(["meta"], "readwrite", async (t) => {
    const actual = await t.leer("meta", TURNO)
    const momento = ahora().getTime()

    if (actual && actual.valor.vence > momento && actual.valor.dueno !== mio) return false

    await t.poner("meta", { clave: TURNO, valor: { dueno: mio, vence: momento + DURACION } })

    return true
  })

  if (!tomado) return OMITIDO

  try {
    return await trabajo()
  } finally {
    await almacen.transaccion(["meta"], "readwrite", async (t) => {
      const actual = await t.leer("meta", TURNO)
      if (actual?.valor.dueno === mio) await t.borrar("meta", TURNO)
    })
  }
}
