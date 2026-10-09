import { supabase } from "../supabase"

/*
  Traduce entre los nombres de la base, en español, y los que ya usan las
  pantallas. Mantener el contrato del frontend evita reescribir cada
  página en la misma tanda que la migración.
*/

export const aProductoDeApp = (fila) => ({
  id: fila.id,
  code: fila.codigo || "",
  name: fila.nombre,
  category: fila.categoria || "",
  price: Number(fila.precio) || 0,
  costPrice: Number(fila.costo) || 0,
  stock: Number(fila.stock) || 0,
  minStock: Number(fila.stock_minimo) || 0,
  supplierId: fila.proveedor_id || "",
  imageUrl: fila.imagen_url || "",
})

const aProductoDeBase = (producto, empresaId) => ({
  empresa_id: empresaId,
  codigo: String(producto.code || "").trim(),
  nombre: String(producto.name || "").trim(),
  categoria: String(producto.category || "").trim(),
  precio: Number(producto.price) || 0,
  costo: Number(producto.costPrice) || 0,
  stock_minimo: Number(producto.minStock) || 0,
  proveedor_id: producto.supplierId || null,
  imagen_url: producto.imageUrl || null,
})

export const aClienteDeApp = (fila) => ({
  id: fila.id,
  name: fila.nombre,
  rtn: fila.rtn || "",
  phone: fila.telefono || "",
  address: fila.direccion || "",
  email: fila.email || "",
})

const aClienteDeBase = (cliente, empresaId) => ({
  empresa_id: empresaId,
  nombre: String(cliente.name || "").trim(),
  rtn: String(cliente.rtn || "").trim(),
  telefono: String(cliente.phone || "").trim(),
  direccion: String(cliente.address || "").trim(),
  email: String(cliente.email || "").trim(),
})

export const aProveedorDeApp = (fila) => ({
  id: fila.id,
  name: fila.nombre,
  contact: fila.contacto || "",
  phone: fila.telefono || "",
  email: fila.email || "",
  notes: fila.notas || "",
})

const aProveedorDeBase = (proveedor, empresaId) => ({
  empresa_id: empresaId,
  nombre: String(proveedor.name || "").trim(),
  contacto: String(proveedor.contact || "").trim(),
  telefono: String(proveedor.phone || "").trim(),
  email: String(proveedor.email || "").trim(),
  notas: String(proveedor.notes || "").trim(),
})

/*
  42501 es la base diciendo que falta permiso: la sección que exige quien
  escribe (SEC-3a). Reintentar no lo arregla, así que el aviso lo dice.
*/
/*
  La base rechaza por permiso con 42501. Storage traduce ese mismo rechazo
  a un 403 (AccessDenied), que según la versión llega con estado HTTP 400
  o 403 pero siempre con statusCode "403" en el cuerpo.
*/
const esFaltaDePermiso = (error) =>
  error?.code === "42501" ||
  error?.code === "AccessDenied" ||
  String(error?.statusCode) === "403"

function fallo(error, queHacia) {
  console.error(`No se pudo ${queHacia}:`, error)

  if (esFaltaDePermiso(error)) {
    throw new Error(`No tienes permiso para ${queHacia}.`)
  }

  throw new Error(`No se pudo ${queHacia}.`)
}

// ── PRODUCTOS ──────────────────────────────────────────────

export async function traerProductos() {
  const { data, error } = await supabase
    .from("productos_con_stock")
    .select("*")
    .eq("activo", true)
    .order("nombre")

  if (error) fallo(error, "cargar el inventario")

  return (data || []).map(aProductoDeApp)
}

/*
  Los códigos con los que registrar_movimiento_ubicacion() distingue sus
  rechazos. Se traducen aquí para que la pantalla no tenga que leer
  SQLSTATE, igual que hace cobros.js con los del pago.
*/
const MOTIVOS_DE_INVENTARIO = {
  LI001: "ubicacion-inactiva",
  LI002: "dato-invalido",
  LI003: "existencia-insuficiente",
  LI004: "producto-invalido",
  42501: "sin-permiso",
}

export class ErrorDeInventario extends Error {
  constructor(mensaje, motivo) {
    super(mensaje)

    this.name = "ErrorDeInventario"
    this.motivo = motivo
  }
}

/*
  Toda entrada o ajuste de existencia pasa por aquí, y siempre en una
  ubicación.

  Antes se insertaba el movimiento directamente en movimientos_inventario,
  sin ubicación: el stock global cambiaba y la existencia por ubicación
  no. El RPC mueve las dos cosas en una sola transacción, y es el único
  que puede: la escritura de inventario_ubicacion está cerrada para el
  navegador desde la 0014.
*/
async function moverExistencia({ productoId, ubicacionId, tipo, cantidad, motivo }) {
  const { error } = await supabase.rpc("registrar_movimiento_ubicacion", {
    p_producto_id: productoId,
    p_ubicacion_id: ubicacionId,
    p_tipo: tipo,
    p_cantidad: cantidad,
    p_motivo: motivo,
  })

  if (error) {
    const motivoDelRechazo = MOTIVOS_DE_INVENTARIO[error.code]

    /*
      Los rechazos de negocio llevan el mensaje del motor, que ya dice
      cuánto hay y en qué ubicación. Envolverlo en un "no se pudo"
      escondería justo el dato que hace falta para corregir el ajuste.
    */
    if (motivoDelRechazo) {
      throw new ErrorDeInventario(error.message, motivoDelRechazo)
    }

    fallo(error, "registrar el movimiento de inventario")
  }
}

/*
  Se comprueba antes de escribir nada. Crear el producto o guardar su
  nombre y fallar después por falta de ubicación dejaría la mitad de lo
  que el usuario pidió. Se exporta para que quien sube antes una imagen
  pueda comprobarlo también antes de subirla.
*/
export function exigirUbicacion(ubicacionId) {
  if (!ubicacionId) {
    throw new Error(
      "Elige en qué ubicación se registra la existencia antes de guardar."
    )
  }
}

/*
  Las existencias iniciales entran como movimiento y no como columna: el
  stock es la suma del libro, para que siempre haya rastro de cómo llegó
  a su valor actual. Y entran en una ubicación, que es la que las podrá
  vender.
*/
export async function crearProducto(producto, empresaId, { ubicacionId } = {}) {
  const existenciaInicial = Number(producto.stock) || 0

  if (existenciaInicial > 0) exigirUbicacion(ubicacionId)

  const { data, error } = await supabase
    .from("productos")
    .insert(aProductoDeBase(producto, empresaId))
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      throw new Error("Ya existe un producto con ese código.")
    }

    fallo(error, "crear el producto")
  }

  if (existenciaInicial > 0) {
    await moverExistencia({
      productoId: data.id,
      ubicacionId,
      tipo: "entrada",
      cantidad: existenciaInicial,
      motivo: "Existencia inicial",
    })
  }

  return data.id
}

/*
  Editar un producto no reescribe su stock: si el usuario cambia la
  cantidad, se registra el ajuste por la diferencia. Sobrescribir el
  número borraría el rastro de por qué cambió.

  `stockAnterior` es la existencia de la UBICACIÓN elegida, no el total
  del producto: el ajuste corrige esa ubicación y no reparte nada entre
  las demás.
*/
export async function actualizarProducto(
  id,
  producto,
  { empresaId, stockAnterior, ubicacionId }
) {
  const diferencia = (Number(producto.stock) || 0) - (Number(stockAnterior) || 0)

  if (diferencia !== 0) exigirUbicacion(ubicacionId)

  const { error } = await supabase
    .from("productos")
    .update(aProductoDeBase(producto, empresaId))
    .eq("id", id)

  if (error) {
    if (error.code === "23505") {
      throw new Error("Ya existe un producto con ese código.")
    }

    fallo(error, "actualizar el producto")
  }

  if (diferencia !== 0) {
    await moverExistencia({
      productoId: id,
      ubicacionId,
      tipo: "ajuste",
      cantidad: diferencia,
      motivo: "Ajuste manual desde inventario",
    })
  }
}

/*
  No se borra: se desactiva. Las facturas ya emitidas apuntan al producto
  y deben seguir mostrando qué se vendió.
*/
export async function desactivarProducto(id) {
  const { error } = await supabase
    .from("productos")
    .update({ activo: false })
    .eq("id", id)

  if (error) fallo(error, "eliminar el producto")
}

/*
  Aquí había registrarMovimiento(), que insertaba en movimientos_inventario
  sin ubicación. Se retira y no se deja por si acaso: sin consumidores
  seguía siendo llamable, y llamarla es exactamente cómo el stock global y
  la existencia por ubicación se separan en silencio.
*/

// ── CLIENTES ───────────────────────────────────────────────

export async function traerClientes() {
  const { data, error } = await supabase
    .from("clientes")
    .select("*")
    .order("nombre")

  if (error) fallo(error, "cargar los clientes")

  return (data || []).map(aClienteDeApp)
}

export async function crearCliente(cliente, empresaId) {
  const { data, error } = await supabase
    .from("clientes")
    .insert(aClienteDeBase(cliente, empresaId))
    .select("*")
    .single()

  if (error) fallo(error, "crear el cliente")

  return aClienteDeApp(data)
}

export async function actualizarCliente(id, cliente, empresaId) {
  const { error } = await supabase
    .from("clientes")
    .update(aClienteDeBase(cliente, empresaId))
    .eq("id", id)

  if (error) fallo(error, "actualizar el cliente")
}

/*
  Un cliente no se borra: sus ventas, facturas y cuentas por cobrar lo
  necesitan, y la base no lo permite a nadie (0025).
*/

// ── PROVEEDORES ────────────────────────────────────────────

export async function traerProveedores() {
  const { data, error } = await supabase
    .from("proveedores")
    .select("*")
    .order("nombre")

  if (error) fallo(error, "cargar los proveedores")

  return (data || []).map(aProveedorDeApp)
}

export async function crearProveedor(proveedor, empresaId) {
  const { data, error } = await supabase
    .from("proveedores")
    .insert(aProveedorDeBase(proveedor, empresaId))
    .select("*")
    .single()

  if (error) fallo(error, "crear el proveedor")

  return aProveedorDeApp(data)
}

export async function actualizarProveedor(id, proveedor, empresaId) {
  const { error } = await supabase
    .from("proveedores")
    .update(aProveedorDeBase(proveedor, empresaId))
    .eq("id", id)

  if (error) fallo(error, "actualizar el proveedor")
}

/*
  Sin el permiso, la base no alcanza la fila y responde sin error. Se pide
  de vuelta lo borrado para no dar por hecho lo que no pasó.
*/
export async function eliminarProveedor(id) {
  const { data, error } = await supabase
    .from("proveedores")
    .delete()
    .eq("id", id)
    .select("id")

  if (error) fallo(error, "eliminar el proveedor")
  if (!data?.length) throw new Error("No tienes permiso para eliminar el proveedor.")
}

// ── EMPRESA ────────────────────────────────────────────────

export const aEmpresaDeApp = (fila) => ({
  id: fila.id,
  name: fila.nombre,
  address: fila.direccion || "",
  phone: fila.telefono || "",
  currency: fila.moneda || "L",
  taxRate: Number(fila.tasa_isv) || 0,
  nextInvoice: Number(fila.proximo_correlativo_factura) || 1,
  nextQuote: Number(fila.proximo_correlativo_cotizacion) || 1,
  fiscal: {
    rtn: fila.rtn || "",
    cai: fila.cai || "",
    establecimiento: fila.establecimiento || "000",
    puntoEmision: fila.punto_emision || "001",
    tipoDocumento: fila.tipo_documento || "01",
    rangoDesde: fila.rango_desde ?? "",
    rangoHasta: fila.rango_hasta ?? "",
    fechaLimiteEmision: fila.fecha_limite_emision || "",
  },
})

export async function traerEmpresa() {
  const { data, error } = await supabase
    .from("empresas")
    .select("*")
    .limit(1)
    .maybeSingle()

  if (error) fallo(error, "cargar los datos de la empresa")

  return data ? aEmpresaDeApp(data) : null
}

export async function actualizarEmpresa(id, empresa) {
  const fiscal = empresa.fiscal || {}

  const { error } = await supabase
    .from("empresas")
    .update({
      nombre: String(empresa.name || "").trim(),
      direccion: String(empresa.address || "").trim(),
      telefono: String(empresa.phone || "").trim(),
      moneda: String(empresa.currency || "L").trim(),
      tasa_isv: Number(empresa.taxRate) || 0,
      rtn: String(fiscal.rtn || "").trim(),
      cai: String(fiscal.cai || "").trim(),
      establecimiento: fiscal.establecimiento || "000",
      punto_emision: fiscal.puntoEmision || "001",
      tipo_documento: fiscal.tipoDocumento || "01",
      rango_desde: fiscal.rangoDesde === "" ? null : Number(fiscal.rangoDesde),
      rango_hasta: fiscal.rangoHasta === "" ? null : Number(fiscal.rangoHasta),
      fecha_limite_emision: fiscal.fechaLimiteEmision || null,
    })
    .eq("id", id)

  if (error) fallo(error, "guardar los datos de la empresa")
}

// ── IMÁGENES DE PRODUCTO ───────────────────────────────────

const CUBETA = "productos"

export const TAMANO_MAXIMO_IMAGEN = 2 * 1024 * 1024

export const FORMATOS_DE_IMAGEN = ["image/jpeg", "image/png", "image/webp"]

/*
  Revisa el archivo antes de subirlo. El bucket aplica los mismos límites,
  porque esto es comodidad para el usuario y no una defensa: cualquiera
  puede llamar a la API sin pasar por el formulario.
*/
export function revisarImagen(archivo) {
  if (!FORMATOS_DE_IMAGEN.includes(archivo.type)) {
    throw new Error("La imagen debe ser JPG, PNG o WebP.")
  }

  if (archivo.size > TAMANO_MAXIMO_IMAGEN) {
    const megas = (archivo.size / 1024 / 1024).toFixed(1)

    throw new Error(`La imagen pesa ${megas} MB y el máximo es 2 MB.`)
  }
}

const extensionDe = (archivo) =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[archivo.type]

/*
  El archivo va en una carpeta con el id de la empresa: de ahí sale el
  aislamiento entre empresas, porque las políticas del bucket comparan
  esa carpeta contra la empresa de quien sube.

  Al nombre se le agrega la marca de tiempo para que el navegador no siga
  mostrando la foto anterior desde su caché al reemplazarla.
*/
export async function subirImagenDeProducto(archivo, productoId, empresaId) {
  revisarImagen(archivo)

  const ruta = `${empresaId}/${productoId}-${Date.now()}.${extensionDe(archivo)}`

  const { error } = await supabase.storage
    .from(CUBETA)
    .upload(ruta, archivo, { contentType: archivo.type, upsert: true })

  if (error) fallo(error, "subir la imagen del producto")

  const { data } = supabase.storage.from(CUBETA).getPublicUrl(ruta)

  return data.publicUrl
}

const rutaDentroDelBucket = (url) => {
  const marca = `/${CUBETA}/`
  const corte = String(url || "").indexOf(marca)

  return corte === -1 ? null : url.slice(corte + marca.length)
}

/*
  Borrar la imagen vieja no puede tumbar la operación: si falla, queda un
  archivo huérfano ocupando espacio, que es mucho menos grave que impedirle
  al usuario cambiar la foto de un producto.
*/
export async function borrarImagenDeProducto(url) {
  const ruta = rutaDentroDelBucket(url)

  if (!ruta) return

  const { error } = await supabase.storage.from(CUBETA).remove([ruta])

  if (error) console.error("No se pudo borrar la imagen anterior:", error)
}
