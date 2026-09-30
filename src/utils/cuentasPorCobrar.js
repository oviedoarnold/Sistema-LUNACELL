/*
  La cuenta por cobrar de un cliente.

  Un cliente que debe cuatro facturas no tiene cuatro deudas: tiene una. El
  historial las muestra sueltas porque ahí lo que importa es cada documento;
  aquí lo que importa es a quién hay que cobrarle y cuánto.

  No hay nada que guardar: la deuda se calcula. Una columna con el saldo
  acumulado del cliente se desincroniza el día que alguien anule una
  factura, y entonces habría dos respuestas distintas a la misma pregunta.

  El saldo de cada factura sale de getSaleBalance, el mismo que usan el
  historial y el panel, para que las tres pantallas no puedan contradecirse.
*/

import { getSaleBalance, getSalePaid, isCreditSale } from "./salesUtils"

/*
  Una factura anulada no se debe.

  getSaleBalance no lo mira —solo distingue crédito de contado— porque nació
  cuando el historial no tenía anulaciones, y cambiarlo hoy tocaría también
  el panel. Así que el filtro va aquí, que es donde se decide qué entra en
  una cuenta por cobrar. Queda anotado como deuda: el «Saldo por cobrar» del
  historial y el panel sí contarían una anulada a crédito.
*/
function cuentaParaLaDeuda(venta) {
  return (
    isCreditSale(venta) &&
    venta?.status !== "anulada" &&
    getSaleBalance(venta) > 0
  )
}

/*
  Las facturas que forman la deuda, de la más antigua a la más reciente.

  Es el mismo orden en que el motor las va a cobrar, así que la pantalla
  enseña el reparto en el orden en que va a ocurrir sin tener que
  calcularlo: la primera de la lista es la primera que se paga.
*/
function porAntiguedad(una, otra) {
  if (una.timestamp !== otra.timestamp) {
    return una.timestamp - otra.timestamp
  }

  return Number(una.correlativo || 0) - Number(otra.correlativo || 0)
}

function aFacturaPendiente(venta) {
  return {
    ventaId: venta.id,
    numero: venta.invoiceNumber,
    correlativo: Number(venta.correlativo || 0),
    fecha: venta.date,
    isoDate: venta.isoDate,
    timestamp: venta.timestamp,
    vencimiento: venta.dueDate || null,
    total: Number(venta.total || 0),
    abonado: getSalePaid(venta),
    saldo: getSaleBalance(venta),
  }
}

/*
  Agrupa por cliente y devuelve una cuenta por cada uno que deba algo.

  Se agrupa por clientId y no por nombre: dos clientes pueden llamarse
  igual, y cobrarle a uno el saldo del otro no es un error de presentación.
  Toda venta a crédito tiene cliente —la base lo exige con un check—, así
  que no hace falta un grupo para los que no lo tengan.
*/
export function cuentasPorCobrar(ventas = [], clientes = []) {
  const porCliente = new Map()

  for (const venta of ventas) {
    if (!cuentaParaLaDeuda(venta)) continue

    const clienteId = venta.clientId

    if (!clienteId) continue

    if (!porCliente.has(clienteId)) {
      porCliente.set(clienteId, [])
    }

    porCliente.get(clienteId).push(venta)
  }

  const fichaDe = new Map(
    clientes.map((cliente) => [cliente.id, cliente])
  )

  const cuentas = []

  for (const [clienteId, suyas] of porCliente) {
    const facturas = suyas.sort(porAntiguedad).map(aFacturaPendiente)
    const ficha = fichaDe.get(clienteId)

    cuentas.push({
      clienteId,

      /*
        El nombre sale de la ficha del cliente cuando existe, y si no, del
        que quedó copiado dentro de la factura. Ese segundo es el que se
        imprimió, así que sirve de respaldo aunque la ficha se haya
        renombrado después.
      */
      nombre: ficha?.name || suyas[0]?.clientName || "Cliente",
      rtn: ficha?.rtn || suyas[0]?.rtn || "",
      telefono: ficha?.phone || "",

      deudaTotal: redondear(
        facturas.reduce((suma, factura) => suma + factura.saldo, 0)
      ),

      facturasPendientes: facturas.length,

      /* La más antigua es la que el reparto va a cobrar primero. */
      masAntigua: facturas[0] || null,

      facturas,
    })
  }

  /*
    Primero quien más debe. Es el orden en que alguien que cobra quiere
    verlas, y con el nombre como desempate la lista no baila entre recargas
    cuando dos clientes deben lo mismo.
  */
  return cuentas.sort((una, otra) => {
    if (otra.deudaTotal !== una.deudaTotal) {
      return otra.deudaTotal - una.deudaTotal
    }

    return una.nombre.localeCompare(otra.nombre, "es")
  })
}

function redondear(valor) {
  return Math.round(Number(valor || 0) * 100) / 100
}

export function deudaTotalDeLasCuentas(cuentas = []) {
  return redondear(
    cuentas.reduce((suma, cuenta) => suma + cuenta.deudaTotal, 0)
  )
}

/*
  Lo que se le aplicaría a cada factura si el pago entrara ahora.

  Es la misma regla que corre en el motor —la más vieja primero, hasta
  donde alcance—, pero calculada aquí solo para enseñarla antes de
  confirmar. No decide nada: el reparto que vale es el que devuelve
  registrar_pago_cliente(), y la pantalla muestra ese cuando llega.

  Se llama "previa" a propósito, para que nadie la confunda con el reparto.
*/
export function previaDelReparto(facturas = [], monto) {
  let restante = redondear(monto)

  if (!Number.isFinite(restante) || restante <= 0) {
    return []
  }

  const previa = []

  for (const factura of facturas) {
    if (restante <= 0) break

    const aplicado = Math.min(restante, factura.saldo)

    if (aplicado <= 0) continue

    previa.push({
      ventaId: factura.ventaId,
      numero: factura.numero,
      aplicado: redondear(aplicado),
      saldoAnterior: factura.saldo,
      saldoPosterior: redondear(factura.saldo - aplicado),
    })

    restante = redondear(restante - aplicado)
  }

  return previa
}
