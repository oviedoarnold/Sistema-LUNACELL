import { supabase } from "../supabase"

/*
  El cobro a un cliente.

  Todo lo que decide la operación vive en registrar_pago_cliente(): la
  empresa, el usuario, la deuda, qué facturas y en qué orden. Desde aquí
  solo viajan cuatro datos, y eso es a propósito —no una simplificación—:
  si el navegador mandara la empresa o el reparto, bastaría una llamada
  falsificada para cobrarle a otra empresa o para repartir el dinero a
  gusto. El motor no acepta que se los digan.

  Por la misma razón esta capa no calcula nada. Lo que devuelve el RPC es
  el reparto que de verdad ocurrió, y es lo que la pantalla enseña.
*/

function fallo(error, queHacia) {
  console.error(`No se pudo ${queHacia}:`, error)

  throw new Error(`No se pudo ${queHacia}.`)
}

/*
  Los códigos que la función usa para distinguir sus rechazos. Se traducen
  aquí para que la pantalla no tenga que leer SQLSTATE, y para que el
  mensaje que ve el cajero diga qué hacer.
*/
const MOTIVOS = {
  LC001: "sobrepago",
  LC002: "sin-deuda",
  LC003: "clave-reusada",
  LC004: "reparto-incompleto",
}

export class ErrorDeCobro extends Error {
  constructor(mensaje, motivo) {
    super(mensaje)

    this.name = "ErrorDeCobro"
    this.motivo = motivo
  }
}

const aAplicacionDeApp = (fila) => ({
  ventaId: fila.venta_id,
  numero: fila.numero_factura,
  correlativo: Number(fila.correlativo || 0),
  aplicado: Number(fila.monto_aplicado),
  saldoAnterior: Number(fila.saldo_anterior_factura),
  saldoPosterior: Number(fila.saldo_posterior_factura),
})

export const aPagoDeApp = (dato) => ({
  pagoId: dato.pago_id,
  clienteId: dato.cliente_id,
  monto: Number(dato.monto),
  saldoAnterior: Number(dato.saldo_anterior),
  saldoPosterior: Number(dato.saldo_posterior),
  fecha: dato.fecha,

  /*
    Verdadero cuando el motor reconoció la clave y devolvió el pago que ya
    había registrado en vez de cobrar otra vez. La pantalla lo usa para no
    felicitar dos veces por el mismo dinero.
  */
  repetido: Boolean(dato.repetido),

  aplicaciones: (dato.aplicaciones || []).map(aAplicacionDeApp),
})

/*
  Registra el pago de un cliente y devuelve cómo quedó repartido.

  La clave identifica la INTENCIÓN de pago, no el clic: si la red se cae
  sin decir si el cobro entró, reintentar con la misma clave devuelve el
  pago que ya existía en vez de cobrarle al cliente por segunda vez.
*/
export async function registrarPagoCliente(
  clienteId,
  { monto, nota = "", clave = null }
) {
  const { data, error } = await supabase.rpc("registrar_pago_cliente", {
    p_cliente_id: clienteId,
    p_monto: monto,
    p_clave_idempotencia: clave,
    p_nota: nota,
  })

  if (error) {
    const motivo = MOTIVOS[error.code]

    /*
      Los rechazos de negocio llevan el mensaje del motor, que ya dice el
      monto y la deuda. Envolverlo en un "no se pudo registrar el pago"
      escondería justo el dato que el cajero necesita para decidir.
    */
    if (motivo) {
      throw new ErrorDeCobro(error.message, motivo)
    }

    fallo(error, "registrar el pago del cliente")
  }

  return aPagoDeApp(data)
}
