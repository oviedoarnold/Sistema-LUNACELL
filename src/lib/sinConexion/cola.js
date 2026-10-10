/*
  La cola de ventas sin conexión.

  Cada venta cobrada se guarda aquí ANTES de intentar enviarla, y no se
  borra hasta que el servidor confirma que la tiene (registrada o en
  conciliación). Ni un error, ni una sesión vencida, ni una actualización de
  la aplicación la sacan de la cola.

  Estados:
  - pendiente: guardada, falta enviarla;
  - sincronizando: se está enviando (si la app se cierra aquí, al volver
    pasa a pendiente y se reenvía con la misma clave);
  - registrada: el servidor la registró como venta;
  - en_conciliacion: el servidor la guardó para que un administrador decida;
  - error: el servidor la rechazó por su contenido (OF001/OF003). Se conserva
    y solo se reintenta a mano.

  Registrada y en conciliación son finales: el servidor ya la tiene.
*/
import { codigoCorto } from "./dispositivo"
import { disponibleLocal, idDeCopia, mismoDueno } from "./copiaLocal"

export const ESTADOS = Object.freeze({
  PENDIENTE: "pendiente",
  SINCRONIZANDO: "sincronizando",
  REGISTRADA: "registrada",
  EN_CONCILIACION: "en_conciliacion",
  ERROR: "error",
})

const FINALES = new Set([ESTADOS.REGISTRADA, ESTADOS.EN_CONCILIACION])

export class ErrorDeCola extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = "ErrorDeCola"
  }
}

const SECUENCIA = "secuencia_provisional"

/*
  Guarda la venta en una sola transacción: comprueba el disponible local,
  toma el siguiente número provisional del dispositivo y la escribe. Si algo
  falla no se escribe nada y no se gasta número.
*/
export function guardarVenta(almacen, venta) {
  return almacen.transaccion(["meta", "ventas", "copias"], "readwrite", async (t) => {
    if (await t.leer("ventas", venta.clave)) throw new ErrorDeCola("Esa venta ya está guardada.")

    const copia = await t.leer("copias", idDeCopia(venta))
    if (!copia) throw new ErrorDeCola("No hay copia local de esta ubicación: conéctate para descargarla.")

    const ventas = await t.porIndice("ventas", "por_usuario", venta.usuarioAuth)
    const pedido = new Map()
    for (const r of venta.renglones) pedido.set(r.producto_id, (pedido.get(r.producto_id) || 0) + r.cantidad)

    for (const [productoId, cantidad] of pedido) {
      const disponible = disponibleLocal(copia, ventas, productoId)

      if (cantidad > disponible) {
        const nombre = venta.renglones.find((r) => r.producto_id === productoId).nombre
        throw new ErrorDeCola(`No hay suficiente «${nombre}» en esta ubicación: quedan ${Math.max(disponible, 0)}.`)
      }
    }

    const secuencia = ((await t.leer("meta", SECUENCIA))?.valor || 0) + 1
    await t.poner("meta", { clave: SECUENCIA, valor: secuencia })

    const guardada = {
      ...venta,
      numeroProvisional: `PROV-${codigoCorto(venta.dispositivo)}-${String(secuencia).padStart(6, "0")}`,
      estado: ESTADOS.PENDIENTE,
      intentos: 0,
    }

    await t.agregar("ventas", guardada)

    return guardada
  })
}

const porFecha = (a, b) => a.creadaEn.localeCompare(b.creadaEn) || a.clave.localeCompare(b.clave)

// Las ventas de un usuario en una ubicación de una empresa, de la más vieja a la más nueva.
export async function ventasDe(almacen, dueno) {
  const ventas = await almacen.transaccion(["ventas"], "readonly", (t) => t.porIndice("ventas", "por_usuario", dueno.usuarioAuth))

  return ventas.filter((v) => mismoDueno(v, dueno)).sort(porFecha)
}

// Todas las ventas de un usuario en su empresa (cualquier ubicación), para sincronizarlas.
export async function ventasDelUsuario(almacen, { empresaId, usuarioAuth }) {
  const ventas = await almacen.transaccion(["ventas"], "readonly", (t) => t.porIndice("ventas", "por_usuario", usuarioAuth))

  return ventas.filter((v) => v.empresaId === empresaId).sort(porFecha)
}

/*
  Cambia el estado u otros datos de una venta. Una venta final no vuelve
  atrás: el servidor ya la tiene y reenviarla sería mentir sobre su estado.
*/
export function marcar(almacen, clave, cambios) {
  return almacen.transaccion(["ventas"], "readwrite", async (t) => {
    const venta = await t.leer("ventas", clave)
    if (!venta) throw new ErrorDeCola("Esa venta no está en la cola.")

    if (FINALES.has(venta.estado) && cambios.estado && !FINALES.has(cambios.estado)) {
      throw new ErrorDeCola("Esa venta ya está confirmada por el servidor.")
    }

    const nueva = { ...venta, ...cambios, clave: venta.clave }
    await t.poner("ventas", nueva)

    return nueva
  })
}

/*
  Las ventas que el servidor todavía no confirmó (pendientes, enviándose o
  con error): las que van al archivo de emergencia. De un usuario, o todas
  las del teléfono si se pide sin usuario (un administrador).
*/
export async function ventasNoConfirmadas(almacen, { usuarioAuth = null } = {}) {
  const todas = await almacen.todos("ventas")

  return todas
    .filter((v) => !FINALES.has(v.estado))
    .filter((v) => !usuarioAuth || v.usuarioAuth === usuarioAuth)
    .sort(porFecha)
}

/*
  Toma una venta para enviarla: en una sola transacción comprueba que siga
  en un estado enviable y la pasa a «sincronizando». Si otra pestaña ya la
  tomó o el servidor ya la confirmó, devuelve null y no se envía.
*/
export function tomarParaEnvio(almacen, clave, { enviables, cambios = {} }) {
  return almacen.transaccion(["ventas"], "readwrite", async (t) => {
    const venta = await t.leer("ventas", clave)
    if (!venta || !enviables.includes(venta.estado)) return null

    const tomada = { ...venta, ...cambios, estado: ESTADOS.SINCRONIZANDO, intentos: (venta.intentos || 0) + 1, clave: venta.clave }
    await t.poner("ventas", tomada)

    return tomada
  })
}

/*
  Devuelve una venta que no se pudo confirmar a pendiente o a error, solo si
  sigue «sincronizando». Si mientras tanto otra pestaña la confirmó, se deja
  como está: una venta confirmada nunca retrocede.
*/
export function soltarEnvio(almacen, clave, cambios) {
  return almacen.transaccion(["ventas"], "readwrite", async (t) => {
    const venta = await t.leer("ventas", clave)
    if (!venta || venta.estado !== ESTADOS.SINCRONIZANDO) return null

    const nueva = { ...venta, ...cambios, clave: venta.clave }
    await t.poner("ventas", nueva)

    return nueva
  })
}

/*
  Lo que quedó «sincronizando» porque la app se cerró o el teléfono se
  reinició a mitad de un envío vuelve a pendiente. Se reenvía con la misma
  clave: si el servidor ya la tenía, responde «ya registrada».
*/
export function recuperarInterrumpidas(almacen) {
  return almacen.transaccion(["ventas"], "readwrite", async (t) => {
    const enviandose = await t.porIndice("ventas", "por_estado", ESTADOS.SINCRONIZANDO)

    for (const venta of enviandose) await t.poner("ventas", { ...venta, estado: ESTADOS.PENDIENTE })

    return enviandose.length
  })
}

/*
  Quita del teléfono las ventas que el servidor ya tiene y se confirmaron
  antes de `antesDe` (se guardan unos días para reimprimir). Nunca toca una
  venta pendiente, enviándose o con error.
*/
export function limpiarConfirmadas(almacen, { antesDe }) {
  const limite = antesDe.getTime()

  return almacen.transaccion(["ventas"], "readwrite", async (t) => {
    const todas = await t.todos("ventas")
    const viejas = todas.filter((v) => FINALES.has(v.estado) && v.confirmadaEn && Date.parse(v.confirmadaEn) < limite)

    for (const venta of viejas) await t.borrar("ventas", venta.clave)

    return viejas.length
  })
}
