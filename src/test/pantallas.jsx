import { act, render, waitFor } from "@testing-library/react"
import { expect } from "vitest"

import { crearSupabaseFalso } from "./supabaseFalso"

/*
  Monta una pantalla completa sobre el doble de Supabase.

  Las pruebas describen los datos con los nombres que usa la aplicación
  (name, price, stock) y aquí se traducen a las columnas de la base. Así
  las fixtures siguen leyéndose igual que antes de la migración y el
  cambio de nombres vive en un solo lugar.

  Cada archivo de prueba debe declarar su propio mock del cliente:

    vi.mock("../lib/supabase", () => ({
      get supabase() { return globalThis.__supabaseFalso },
      hayConexionConfigurada: true,
    }))
*/

export const EMPRESA = "empresa-prueba"
export const AUTH_ID = "auth-prueba"

export const EMPRESA_PRUEBA = {
  id: EMPRESA,
  nombre: "Ferretería de prueba",
  direccion: "Barrio El Centro",
  telefono: "2222-0000",
  moneda: "L",
  tasa_isv: 15,
  rtn: "08011999123456",
  cai: "A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-12",
  establecimiento: "000",
  punto_emision: "001",
  tipo_documento: "01",
  rango_desde: 1,
  rango_hasta: 5000,
  fecha_limite_emision: "2027-12-31",
  proximo_correlativo_factura: 1000,
  proximo_correlativo_cotizacion: 2000,
}

const USUARIO_PRUEBA = {
  id: "u-prueba",
  auth_id: AUTH_ID,
  empresa_id: EMPRESA,
  email: "admin@ferreteria.test",
  nombre: "Administradora",
  rol: "admin",
  activo: true,
  entro_en: "2026-01-01",
}

/*
  Traduce una ferretería descrita como la ve la aplicación a la fila que
  guarda la base, para las pruebas que parten de datos de empresa.
*/
export function aFilaDeEmpresa(empresa, { correlativoFactura = 1000 } = {}) {
  const fiscal = empresa.fiscal || {}

  return {
    id: EMPRESA,
    nombre: empresa.name,
    direccion: empresa.address || "",
    telefono: empresa.phone || "",
    moneda: empresa.currency || "L",
    tasa_isv: empresa.taxRate ?? 15,
    rtn: fiscal.rtn || "",
    cai: fiscal.cai || "",
    establecimiento: fiscal.establecimiento || "000",
    punto_emision: fiscal.puntoEmision || "001",
    tipo_documento: fiscal.tipoDocumento || "01",
    rango_desde: fiscal.rangoDesde ?? null,
    rango_hasta: fiscal.rangoHasta ?? null,
    fecha_limite_emision: fiscal.fechaLimiteEmision || null,
    proximo_correlativo_factura: correlativoFactura,
    proximo_correlativo_cotizacion: 2000,
  }
}

const aFilaDeProducto = (producto) => ({
  id: producto.id,
  empresa_id: EMPRESA,
  proveedor_id: producto.supplierId || null,
  codigo: producto.code || "",
  nombre: producto.name,
  categoria: producto.category || "",
  precio: producto.price ?? 0,
  costo: producto.costPrice ?? 0,
  stock_minimo: producto.minStock ?? 0,
  activo: true,
  creado_en: "2026-01-01",
})

/*
  El stock no es una columna: entra como movimiento, igual que en la base.
*/
const aMovimientoInicial = (producto, indice) => ({
  id: `mov-${indice}`,
  empresa_id: EMPRESA,
  producto_id: producto.id,
  usuario_id: USUARIO_PRUEBA.id,
  venta_id: null,
  tipo: "entrada",
  cantidad: producto.stock ?? 0,
  motivo: "Existencia inicial",
})

const aFilaDeCliente = (cliente) => ({
  id: cliente.id,
  empresa_id: EMPRESA,
  nombre: cliente.name,
  rtn: cliente.rtn || "",
  telefono: cliente.phone || "",
  direccion: cliente.address || "",
  email: cliente.email || "",
})

const aFilaDeProveedor = (proveedor) => ({
  id: proveedor.id,
  empresa_id: EMPRESA,
  nombre: proveedor.name,
  contacto: proveedor.contact || "",
  telefono: proveedor.phone || "",
  email: proveedor.email || "",
  notas: proveedor.notes || "",
})

const aFilaDeVenta = (venta) => ({
  id: venta.id,
  empresa_id: EMPRESA,
  cliente_id: venta.clientId || null,
  usuario_id: USUARIO_PRUEBA.id,

  numero_factura: venta.invoiceNumber,
  correlativo: venta.correlativo ?? 1000,
  fecha: venta.isoDate || new Date(venta.timestamp || Date.now()).toISOString(),

  nombre_cliente: venta.clientName || venta.customerName || "Consumidor Final",
  rtn_comprador: venta.rtn || "",

  subtotal: venta.subtotal ?? 0,
  isv: venta.tax ?? 0,
  tasa_isv: venta.taxRate ?? 15,
  total: venta.total ?? 0,

  forma_pago: venta.paymentType || venta.type || "contado",
  fecha_vencimiento: venta.dueDate || null,
  estado: venta.status || "pagada",

  cai_emision: venta.fiscal?.cai || "",
  rango_desde_emision: venta.fiscal?.rangoDesde || null,
  rango_hasta_emision: venta.fiscal?.rangoHasta || null,
  fecha_limite_emision_emision: venta.fiscal?.fechaLimiteEmision || null,

  nota: venta.note || "",
})

const renglonesDe = (venta) =>
  (venta.items || []).map((item, indice) => ({
    id: venta.id + "-r" + indice,
    empresa_id: EMPRESA,
    venta_id: venta.id,
    producto_id: item.productId || item.id || null,
    nombre: item.name,
    codigo: item.code || "",
    cantidad: item.qty ?? item.quantity ?? 1,
    precio: item.price ?? 0,
    subtotal: item.subtotal ?? 0,
  }))

const abonosDe = (venta) =>
  (venta.payments || []).map((abono, indice) => ({
    id: abono.id || venta.id + "-ab" + indice,
    empresa_id: EMPRESA,
    venta_id: venta.id,
    usuario_id: USUARIO_PRUEBA.id,
    monto: abono.amount,
    fecha: abono.isoDate || new Date(abono.timestamp || Date.now()).toISOString(),
    nota: abono.note || "",
  }))

const aFilaDeCotizacion = (cotizacion) => ({
  id: cotizacion.id,
  empresa_id: EMPRESA,
  cliente_id: cotizacion.clientId || null,
  usuario_id: USUARIO_PRUEBA.id,

  numero: cotizacion.quoteNumber,
  correlativo: cotizacion.correlativo ?? 2000,
  fecha: cotizacion.isoDate || new Date(cotizacion.timestamp || Date.now()).toISOString(),
  valida_hasta: cotizacion.validity || null,

  nombre_cliente: cotizacion.clientName || "Cliente General",
  rtn_cliente: cotizacion.rtn || "",

  incluye_isv: cotizacion.includeTax !== false,
  subtotal: cotizacion.subtotal ?? 0,
  isv: cotizacion.tax ?? 0,
  tasa_isv: cotizacion.taxRate ?? 15,
  total: cotizacion.total ?? 0,

  notas: cotizacion.notes || "",
  venta_id: cotizacion.saleId || null,
})

const renglonesDeCotizacion = (cotizacion) =>
  (cotizacion.items || []).map((item, indice) => ({
    id: cotizacion.id + "-r" + indice,
    empresa_id: EMPRESA,
    cotizacion_id: cotizacion.id,
    producto_id: item.productId || item.id || null,
    nombre: item.name,
    codigo: item.code || "",
    cantidad: item.qty ?? item.quantity ?? 1,
    precio: item.price ?? 0,
    subtotal: item.subtotal ?? 0,
  }))

const aplanar = (listas) => listas.reduce((todo, lista) => todo.concat(lista), [])

export function montarDatos({
  productos = [],
  clientes = [],
  proveedores = [],
  ventas = [],
  cotizaciones = [],
  empresa = EMPRESA_PRUEBA,
  conSesion = true,
} = {}) {
  const falso = crearSupabaseFalso({
    tablas: {
      empresas: empresa ? [empresa] : [],
      usuarios: [USUARIO_PRUEBA],
      permisos_usuario: [],
      productos: productos.map(aFilaDeProducto),
      movimientos_inventario: productos
        .map((producto, indice) => aMovimientoInicial(producto, indice))
        .filter((m) => m.cantidad !== 0),
      clientes: clientes.map(aFilaDeCliente),
      proveedores: proveedores.map(aFilaDeProveedor),
      ventas: ventas.map(aFilaDeVenta),
      detalle_venta: aplanar(ventas.map(renglonesDe)),
      abonos: aplanar(ventas.map(abonosDe)),
      cotizaciones: cotizaciones.map(aFilaDeCotizacion),
      detalle_cotizacion: aplanar(cotizaciones.map(renglonesDeCotizacion)),
    },
    sesionInicial: conSesion ? { user: { id: AUTH_ID } } : null,
  })

  globalThis.__supabaseFalso = falso

  return falso
}

/*
  Vacía las microtareas hasta que la pantalla deja de consultar la base.

  Un solo vaciado alcanza en una máquina descansada, pero una carga
  encadena varias consultas y cada una despierta a la siguiente en un turno
  distinto. En un runner de integración continua, con la máquina ocupada,
  ese turno de más llega tarde y la prueba mira el DOM antes de tiempo.
  Esperar a que el número de consultas se estabilice no depende de cuántos
  turnos hagan falta.
*/
export async function esperarQueSeAsiente(falso) {
  let consultasPrevias = -1
  let vueltas = 0

  while (consultasPrevias !== falso.from.mock.calls.length && vueltas < 20) {
    consultasPrevias = falso.from.mock.calls.length
    vueltas += 1

    await act(async () => {})
  }
}

/*
  Devuelve cuando la pantalla ya consultó las tablas que necesita, para
  que las pruebas no tengan que repetir el waitFor de la carga inicial.

  esperar nombra esas tablas: "usuarios" siempre se espera porque hasta
  que la sesión no resuelve el resto de los contextos no arranca.
*/
export async function renderizarPantalla(ui, { esperar = [], ...datos } = {}) {
  const falso = montarDatos(datos)
  const resultado = render(ui)

  for (const tabla of ["usuarios", ...esperar]) {
    await waitFor(() => {
      expect(falso.from).toHaveBeenCalledWith(tabla)
    })
  }

  await esperarQueSeAsiente(falso)

  return { ...resultado, falso }
}
