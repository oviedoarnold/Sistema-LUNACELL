import { supabase } from "../supabase"
import { clasificarError } from "../sinConexion/clasificar"

/*
  Acceso a facturas y abonos.

  La factura guarda su propia copia de los datos fiscales y del nombre de
  cada producto: lo emitido no puede cambiar porque después se renueve el
  CAI o se corrija el catálogo.
*/

const COLUMNAS_VENTA = `
  *,
  detalle_venta (*),
  abonos (*)
`

function fallo(error, queHacia) {
  console.error(`No se pudo ${queHacia}:`, error)

  throw new Error(`No se pudo ${queHacia}.`)
}

const aFechaLocal = (iso) =>
  new Date(iso).toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })

const aRenglonDeApp = (fila) => ({
  productId: fila.producto_id,
  id: fila.producto_id,
  code: fila.codigo || "",
  name: fila.nombre,
  category: "",
  qty: Number(fila.cantidad),
  quantity: Number(fila.cantidad),
  price: Number(fila.precio),
  subtotal: Number(fila.subtotal),
})

const aAbonoDeApp = (fila) => ({
  id: fila.id,
  amount: Number(fila.monto),
  date: aFechaLocal(fila.fecha),
  isoDate: fila.fecha,
  timestamp: new Date(fila.fecha).getTime(),
  note: fila.nota || "",
})

export function aVentaDeApp(fila, empresa) {
  const nombreCliente = fila.nombre_cliente || "Consumidor Final"

  return {
    id: fila.id,
    invoiceNumber: fila.numero_factura,
    correlativo: Number(fila.correlativo),

    date: aFechaLocal(fila.fecha),
    isoDate: fila.fecha,
    timestamp: new Date(fila.fecha).getTime(),

    clientId: fila.cliente_id,
    clientName: nombreCliente,
    customerName: nombreCliente,
    customer: nombreCliente,
    rtn: fila.rtn_comprador || "",

    items: (fila.detalle_venta || []).map(aRenglonDeApp),
    payments: (fila.abonos || [])
      .map(aAbonoDeApp)
      .sort((a, b) => a.timestamp - b.timestamp),

    subtotal: Number(fila.subtotal),
    tax: Number(fila.isv),
    taxRate: Number(fila.tasa_isv),
    total: Number(fila.total),

    paymentType: fila.forma_pago,
    type: fila.forma_pago,
    dueDate: fila.fecha_vencimiento,
    status: fila.estado,
    note: fila.nota || "",

    /*
      Si la venta no es fiscal, NO lleva bloque fiscal.

      Antes se construía siempre, aunque cai_emision viniera vacío, y la
      plantilla lo pintaba con `{sale.fiscal && …}`: un documento que no es
      una factura autorizada acababa imprimiendo un «CAI» en blanco, que es
      peor que no imprimir nada porque aparenta serlo.

      Se mira la marca Y el CAI, no solo la marca, porque durante la
      transición conviven dos caminos: el RPC de INV-3.2 escribe es_fiscal,
      y el camino anterior —que el punto de venta sigue usando hasta
      INV-3.3— sella cai_emision sin escribir la marca. Mirar solo una de
      las dos dejaría fuera las facturas del otro.
    */
    isFiscal:
      Boolean(fila.es_fiscal) ||
      Boolean(String(fila.cai_emision || "").trim()),

    fiscal:
      Boolean(fila.es_fiscal) ||
      Boolean(String(fila.cai_emision || "").trim())
        ? {
            cai: fila.cai_emision || "",
            rangoDesde: fila.rango_desde_emision ?? "",
            rangoHasta: fila.rango_hasta_emision ?? "",
            fechaLimiteEmision: fila.fecha_limite_emision_emision || "",
            correlativo: Number(fila.correlativo),
            numero: fila.numero_factura,
          }
        : null,

    company: {
      name: empresa?.name || "",
      address: empresa?.address || "",
      phone: empresa?.phone || "",
      currency: empresa?.currency || "L",
      taxRate: Number(fila.tasa_isv),
    },
  }
}

/*
  Devuelve las filas tal como vienen. Darles la forma que espera la
  pantalla necesita los datos de la empresa, y ese es un dato de
  presentación: mezclarlo aquí obligaría a recargar el historial completo
  cada vez que cambia el encabezado de la factura.
*/
export async function traerVentas() {
  const { data, error } = await supabase
    .from("ventas")
    .select(COLUMNAS_VENTA)
    .order("fecha", { ascending: false })

  if (error) fallo(error, "cargar el historial de facturas")

  return data || []
}

export const conFormaDeApp = (filas, empresa) =>
  filas
    .map((fila) => aVentaDeApp(fila, empresa))
    .sort((a, b) => b.timestamp - a.timestamp)

/*
  El número de las COTIZACIONES. Las ventas ya no lo piden: lo asigna
  registrar_venta_ubicacion() dentro de su transacción.
*/
export async function pedirCorrelativo(tipo) {
  const { data, error } = await supabase.rpc("siguiente_correlativo", {
    p_tipo: tipo,
  })

  if (error) fallo(error, "obtener el número de documento")

  return Number(data)
}

/*
  Los códigos con los que registrar_venta_ubicacion() distingue sus
  rechazos. Se traducen aquí para que la pantalla no tenga que leer
  SQLSTATE, igual que cobros.js con los del pago.
*/
const MOTIVOS_DE_VENTA = {
  LV001: "sin-ubicacion",
  LV002: "ubicacion-inactiva",
  LV003: "venta-invalida",
  LV004: "credito-sin-cliente",
  LV005: "clave-reusada",
  LV006: "producto-invalido",
  LV007: "existencia-insuficiente",
  LV008: "ubicacion-no-vende",
  42501: "sin-permiso",
}

export class ErrorDeVenta extends Error {
  constructor(mensaje, motivo, codigo) {
    super(mensaje)

    this.name = "ErrorDeVenta"
    this.motivo = motivo
    this.codigo = codigo
  }
}

/*
  Registra la venta y devuelve su id.

  Es UNA llamada a registrar_venta_ubicacion(), que hace en una sola
  transacción lo que antes orquestaba el navegador en cuatro pasos: pide
  el número, guarda la cabecera y los renglones, descuenta la existencia
  de la ubicación del usuario y anota la salida en el libro. Si algo falla
  no queda nada, y no hay cabecera que borrar a mano.

  Solo viaja lo que eligió el cajero: qué productos y cuántos, cómo paga y
  a quién. Empresa, usuario, ubicación, precios, importes, número y si el
  documento es fiscal los decide la base; mandarlos sería invitar a
  manipularlos.

  La clave identifica el intento de cobro. Si la red se cae sin respuesta
  y el cajero reintenta con la misma, el servidor devuelve la venta que ya
  existía —con `repetida`— en vez de emitir otra.
*/
export async function crearVenta(venta, { clave = null } = {}) {
  const esCredito = venta.paymentType === "credito"

  const { data, error, status } = await supabase.rpc("registrar_venta_ubicacion", {
    p_items: (venta.items || []).map((item) => ({
      producto_id: item.productId ?? item.id,
      cantidad: Number(item.qty ?? item.quantity),
    })),
    p_forma_pago: venta.paymentType,
    p_cliente_id: venta.clientId || null,
    p_nombre_cliente: venta.customerName || null,
    p_rtn_comprador: venta.rtn || "",
    p_fecha_vencimiento: esCredito ? venta.dueDate || null : null,
    p_nota: venta.note || "",
    p_clave_idempotencia: clave,
  })

  if (error) {
    const motivo = MOTIVOS_DE_VENTA[error.code]

    /*
      Los rechazos de negocio llevan el mensaje del motor, que ya dice qué
      hacer: cuánto hay y en qué ubicación, o que falta asignarla. El
      código viaja también, para poder diagnosticar sin adivinar.
    */
    if (motivo) {
      throw new ErrorDeVenta(error.message, motivo, error.code)
    }

    /*
      Sin respuesta no se sabe si la venta quedó registrada: no es lo mismo
      que un rechazo. Reintentar con la misma clave es seguro; registrarla
      de otra forma no, hasta saber qué pasó.
    */
    if (clasificarError(error, status) === "red") {
      throw new ErrorDeVenta(
        "No hubo respuesta del servidor: la venta pudo haberse registrado o no.",
        "sin-respuesta",
        error.code || ""
      )
    }

    fallo(error, "registrar la venta")
  }

  return data.venta_id
}

/*
  Aquí estaban ventaConClave(), guardarRenglones() y descargarInventario(),
  y el borrado de compensación de crearVenta(). Se retiran y no se dejan
  por si acaso: escribir la venta por partes desde el navegador es lo que
  permitía una factura sin renglones, una salida sin ubicación o un número
  gastado en una venta que no llegó a existir.
*/

/*
  Escribir un abono ya no se hace desde aquí.

  Existían crearAbono(), eliminarAbono() y ajustarEstadoPorSaldo(): un abono
  contra una factura concreta, y después, en otra llamada, el estado de esa
  factura. Entre las dos cabía que se cayera la red y dejara el dinero
  cobrado con la factura abierta, y ninguna tomaba un candado, así que dos
  cajeros podían gastar el mismo saldo.

  Ahora el dinero entra por registrar_pago_cliente(), que reparte el pago
  entre las facturas del cliente dentro de una sola transacción y con la
  cuenta bloqueada. Vive en lib/api/cobros.js.

  Se retiran y no se dejan por si acaso: sin consumidores seguían siendo
  llamables, y eliminarAbono() en particular ya no era solo insegura sino
  incorrecta —borrar un abono que pertenece a un pago dejaría al pago
  diciendo que repartió un dinero que ya no está en ningún renglón—.

  Leer abonos sigue igual: aAbonoDeApp los traduce dentro de cada venta,
  porque son parte de su historia y se siguen mostrando.
*/
