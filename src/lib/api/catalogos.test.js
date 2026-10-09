import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  aProductoDeApp,
  aClienteDeApp,
  aProveedorDeApp,
  aEmpresaDeApp,
  traerProductos,
  crearProducto,
  actualizarProducto,
  desactivarProducto,
  ErrorDeInventario,
  traerClientes,
  crearCliente,
  actualizarCliente,
  traerProveedores,
  crearProveedor,
  actualizarProveedor,
  eliminarProveedor,
  traerEmpresa,
  actualizarEmpresa,
} from "./catalogos"
import * as catalogos from "./catalogos"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const EMPRESA = "empresa-1"
const USUARIO = "usuario-1"

const montar = ({ tablas = {}, fallarEn = {} } = {}) => {
  const falso = crearSupabaseFalso({
    tablas: {
      productos: [],
      productos_con_stock: [],
      movimientos_inventario: [],
      inventario_ubicacion: [],
      clientes: [],
      proveedores: [],
      empresas: [],
      ...tablas,
    },
    fallarEn,
  })

  globalThis.__supabaseFalso = falso

  return falso
}

// La base nunca devuelve undefined: las columnas de texto son not null.
const FILA_VACIA = {}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("traducción de filas a lo que esperan las pantallas", () => {
  it("un producto completo conserva todos sus datos", () => {
    const producto = aProductoDeApp({
      id: "p1",
      codigo: "M-001",
      nombre: "Martillo",
      categoria: "Herramientas",
      precio: "180.50",
      costo: "120.25",
      stock: "7",
      stock_minimo: "3",
      proveedor_id: "prov-1",
      imagen_url: "https://ejemplo.test/m.png",
    })

    expect(producto).toEqual({
      id: "p1",
      code: "M-001",
      name: "Martillo",
      category: "Herramientas",
      price: 180.5,
      costPrice: 120.25,
      stock: 7,
      minStock: 3,
      supplierId: "prov-1",
      imageUrl: "https://ejemplo.test/m.png",
    })
  })

  /*
    Las columnas que admiten nulo tienen que llegar a la pantalla como
    cadena vacía o cero, nunca como undefined: un input de React que recibe
    undefined deja de ser controlado y avisa por consola.

    id y nombre no están en la lista a propósito: son not null en el
    esquema, así que defenderlos aquí sería cubrir un caso que la base no
    puede producir.
  */
  it("un producto sin datos opcionales usa valores por omisión", () => {
    const producto = aProductoDeApp(FILA_VACIA)

    const opcionales = {
      code: "",
      category: "",
      supplierId: "",
      imageUrl: "",
      price: 0,
      costPrice: 0,
      stock: 0,
      minStock: 0,
    }

    Object.entries(opcionales).forEach(([campo, esperado]) => {
      expect(producto[campo], campo).toBe(esperado)
    })
  })

  it("un cliente sin datos opcionales tampoco", () => {
    const cliente = aClienteDeApp(FILA_VACIA)

    expect(cliente.rtn).toBe("")
    expect(cliente.phone).toBe("")
    expect(cliente.address).toBe("")
    expect(cliente.email).toBe("")
  })

  it("un proveedor sin datos opcionales tampoco", () => {
    const proveedor = aProveedorDeApp(FILA_VACIA)

    expect(proveedor.contact).toBe("")
    expect(proveedor.phone).toBe("")
    expect(proveedor.email).toBe("")
    expect(proveedor.notes).toBe("")
  })

  it("una empresa sin configurar trae los valores por omisión", () => {
    const empresa = aEmpresaDeApp(FILA_VACIA)

    expect(empresa.currency).toBe("L")
    expect(empresa.taxRate).toBe(0)
    expect(empresa.nextInvoice).toBe(1)
    expect(empresa.nextQuote).toBe(1)
    expect(empresa.fiscal.establecimiento).toBe("000")
    expect(empresa.fiscal.puntoEmision).toBe("001")
    expect(empresa.fiscal.tipoDocumento).toBe("01")
    expect(empresa.fiscal.rangoDesde).toBe("")
    expect(empresa.fiscal.rangoHasta).toBe("")
  })

  it("los datos fiscales viajan agrupados", () => {
    const empresa = aEmpresaDeApp({
      nombre: "Ferretería",
      cai: "ABC-123",
      rango_desde: 1000,
      rango_hasta: 9999,
      fecha_limite_emision: "2027-12-31",
      proximo_correlativo_factura: 1206,
    })

    expect(empresa.fiscal.cai).toBe("ABC-123")
    expect(empresa.fiscal.rangoDesde).toBe(1000)
    expect(empresa.nextInvoice).toBe(1206)
  })
})

describe("productos", () => {
  it("solo devuelve los que siguen activos", async () => {
    // productos_con_stock es una vista: se calcula desde productos.
    montar({
      tablas: {
        productos: [
          { id: "p1", nombre: "Martillo", activo: true },
          { id: "p2", nombre: "Descontinuado", activo: false },
        ],
      },
    })

    const productos = await traerProductos()

    expect(productos.map((p) => p.name)).toEqual(["Martillo"])
  })

  it("recorta los espacios al guardar", async () => {
    const falso = montar()

    await crearProducto(
      { code: "  M-001  ", name: "  Martillo  ", category: "  Herramientas  " },
      EMPRESA,
      USUARIO
    )

    const [fila] = falso.datos.productos

    expect(fila.codigo).toBe("M-001")
    expect(fila.nombre).toBe("Martillo")
    expect(fila.categoria).toBe("Herramientas")
  })

  /*
    La existencia inicial entra por el RPC y en una ubicación: es lo que
    mueve a la vez la celda de esa ubicación y el libro. Antes se insertaba
    el movimiento suelto, sin ubicación, y la celda no se enteraba.
  */
  it("la existencia inicial entra como entrada en la ubicación elegida", async () => {
    const falso = montar()

    await crearProducto(
      { code: "M-1", name: "Martillo", stock: 12 },
      EMPRESA,
      { ubicacionId: "bodega" }
    )

    const [producto] = falso.datos.productos

    expect(falso.rpc).toHaveBeenCalledWith("registrar_movimiento_ubicacion", {
      p_producto_id: producto.id,
      p_ubicacion_id: "bodega",
      p_tipo: "entrada",
      p_cantidad: 12,
      p_motivo: "Existencia inicial",
    })

    const [movimiento] = falso.datos.movimientos_inventario

    expect(movimiento.ubicacion_id).toBe("bodega")
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(12)
  })

  it("un producto que nace sin existencias no llama al RPC", async () => {
    const falso = montar()

    await crearProducto({ code: "M-1", name: "Martillo", stock: 0 }, EMPRESA, {})

    expect(falso.rpc).not.toHaveBeenCalled()
    expect(falso.datos.movimientos_inventario).toHaveLength(0)
  })

  /*
    Sin ubicación no hay dónde poner la existencia. Se rechaza ANTES de
    crear el producto: crearlo y fallar después lo dejaría en cero sin que
    el usuario lo hubiera pedido.
  */
  it("una existencia inicial sin ubicación no crea el producto", async () => {
    const falso = montar()

    await expect(
      crearProducto({ code: "M-1", name: "Martillo", stock: 5 }, EMPRESA, {})
    ).rejects.toThrow(/ubicación/i)

    expect(falso.datos.productos).toHaveLength(0)
    expect(falso.rpc).not.toHaveBeenCalled()
  })

  /*
    La regresión que esta fase cierra: ningún camino de Productos escribe
    en movimientos_inventario por su cuenta.
  */
  it("crear y ajustar no escriben movimientos directamente", async () => {
    const falso = montar({
      tablas: {
        productos: [{ id: "p1", nombre: "Martillo", empresa_id: EMPRESA }],
        inventario_ubicacion: [{ ubicacion_id: "bodega", producto_id: "p1", cantidad: 10 }],
      },
    })

    await crearProducto({ code: "M-2", name: "Serrucho", stock: 3 }, EMPRESA, { ubicacionId: "bodega" })
    await actualizarProducto("p1", { name: "Martillo", stock: 8 }, {
      empresaId: EMPRESA,
      stockAnterior: 10,
      ubicacionId: "bodega",
    })

    expect(falso.from).not.toHaveBeenCalledWith("movimientos_inventario")
    expect(falso.datos.movimientos_inventario).toHaveLength(2)
    expect(falso.datos.movimientos_inventario.every((m) => m.ubicacion_id)).toBe(true)
  })

  it("avisa cuando el código ya está registrado", async () => {
    montar({ fallarEn: { productos: { insert: { code: "23505" } } } })

    await expect(
      crearProducto({ code: "M-1", name: "Martillo" }, EMPRESA, USUARIO)
    ).rejects.toThrow(/Ya existe un producto con ese código/i)
  })

  it("avisa si la base rechaza la creación por otro motivo", async () => {
    montar({ fallarEn: { productos: { insert: { message: "sin permiso" } } } })

    await expect(
      crearProducto({ code: "M-1", name: "Martillo" }, EMPRESA, USUARIO)
    ).rejects.toThrow(/No se pudo crear el producto/i)
  })

  /*
    Editar no reescribe el stock: registra el ajuste por la diferencia, en
    la ubicación elegida. stockAnterior es la existencia de ESA ubicación,
    no el total: la pantalla la muestra como referencia del ajuste.
  */
  const conCelda = (cantidad) =>
    montar({
      tablas: {
        productos: [{ id: "p1", nombre: "Martillo", empresa_id: EMPRESA }],
        inventario_ubicacion: [{ ubicacion_id: "bodega", producto_id: "p1", cantidad }],
      },
    })

  it("cambiar la existencia registra el ajuste por la diferencia en esa ubicación", async () => {
    const falso = conCelda(10)

    await actualizarProducto("p1", { name: "Martillo", stock: 15 }, {
      empresaId: EMPRESA,
      stockAnterior: 10,
      ubicacionId: "bodega",
    })

    expect(falso.rpc).toHaveBeenCalledWith("registrar_movimiento_ubicacion", {
      p_producto_id: "p1",
      p_ubicacion_id: "bodega",
      p_tipo: "ajuste",
      p_cantidad: 5,
      p_motivo: "Ajuste manual desde inventario",
    })
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(15)
  })

  it("un ajuste hacia abajo queda como cantidad negativa", async () => {
    const falso = conCelda(10)

    await actualizarProducto("p1", { name: "Martillo", stock: 4 }, {
      empresaId: EMPRESA,
      stockAnterior: 10,
      ubicacionId: "bodega",
    })

    expect(falso.datos.movimientos_inventario[0].cantidad).toBe(-6)
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(4)
  })

  it("editar sin tocar la existencia no llama al RPC", async () => {
    const falso = conCelda(10)

    await actualizarProducto("p1", { name: "Martillo de uña", stock: 10 }, {
      empresaId: EMPRESA,
      stockAnterior: 10,
      ubicacionId: "bodega",
    })

    expect(falso.rpc).not.toHaveBeenCalled()
    expect(falso.datos.productos[0].nombre).toBe("Martillo de uña")
  })

  it("un ajuste sin ubicación no toca el producto", async () => {
    const falso = conCelda(10)

    await expect(
      actualizarProducto("p1", { name: "Otro nombre", stock: 12 }, {
        empresaId: EMPRESA,
        stockAnterior: 10,
      })
    ).rejects.toThrow(/ubicación/i)

    expect(falso.datos.productos[0].nombre).toBe("Martillo")
    expect(falso.rpc).not.toHaveBeenCalled()
  })

  /*
    Los rechazos del motor llevan su propio mensaje —cuánto hay y dónde—, y
    se entregan tal cual: envolverlos en un «no se pudo» escondería justo
    el dato que hace falta para corregir el ajuste.
  */
  it("el rechazo por existencia insuficiente llega con el mensaje del motor", async () => {
    montar({
      tablas: { productos: [{ id: "p1", nombre: "Martillo" }] },
      fallarEn: {
        registrar_movimiento_ubicacion: {
          code: "LI003",
          message: "No hay suficiente «Martillo» en Bodega: hay 2, el ajuste quita 5",
        },
      },
    })

    const intento = actualizarProducto("p1", { name: "Martillo", stock: 0 }, {
      empresaId: EMPRESA,
      stockAnterior: 5,
      ubicacionId: "bodega",
    })

    await expect(intento).rejects.toBeInstanceOf(ErrorDeInventario)
    await expect(intento).rejects.toMatchObject({
      motivo: "existencia-insuficiente",
      message: "No hay suficiente «Martillo» en Bodega: hay 2, el ajuste quita 5",
    })
  })

  it.each([
    ["LI001", "ubicacion-inactiva"],
    ["LI002", "dato-invalido"],
    ["LI004", "producto-invalido"],
    ["42501", "sin-permiso"],
  ])("el código %s se traduce como %s", async (code, motivo) => {
    montar({
      fallarEn: { registrar_movimiento_ubicacion: { code, message: "motivo del motor" } },
    })

    await expect(
      crearProducto({ code: "M-1", name: "Martillo", stock: 1 }, EMPRESA, { ubicacionId: "bodega" })
    ).rejects.toMatchObject({ motivo, message: "motivo del motor" })
  })

  it("un fallo desconocido del RPC se informa sin detalles internos", async () => {
    montar({
      fallarEn: { registrar_movimiento_ubicacion: { message: "connection reset" } },
    })

    await expect(
      crearProducto({ code: "M-1", name: "Martillo", stock: 1 }, EMPRESA, { ubicacionId: "bodega" })
    ).rejects.toThrow(/No se pudo registrar el movimiento de inventario/i)
  })

  it("avisa si no puede actualizar", async () => {
    montar({ fallarEn: { productos: { update: { message: "sin permiso" } } } })

    await expect(
      actualizarProducto("p1", { name: "x" }, { empresaId: EMPRESA, stockAnterior: 0 })
    ).rejects.toThrow(/No se pudo actualizar el producto/i)
  })

  /*
    No se borra: se desactiva. Las facturas emitidas apuntan al producto y
    deben seguir mostrando qué se vendió.
  */
  it("eliminar un producto lo desactiva en vez de borrarlo", async () => {
    const falso = montar({
      tablas: { productos: [{ id: "p1", nombre: "Martillo", activo: true }] },
    })

    await desactivarProducto("p1")

    expect(falso.datos.productos).toHaveLength(1)
    expect(falso.datos.productos[0].activo).toBe(false)
  })
})

describe("clientes", () => {
  it("los devuelve traducidos", async () => {
    montar({ tablas: { clientes: [{ id: "c1", nombre: "Ferremax", rtn: "0801" }] } })

    const [cliente] = await traerClientes()

    expect(cliente.name).toBe("Ferremax")
    expect(cliente.rtn).toBe("0801")
  })

  it("guarda el cliente con la empresa que lo crea", async () => {
    const falso = montar()

    await crearCliente({ name: "  Ferremax  " }, EMPRESA)

    expect(falso.datos.clientes[0].nombre).toBe("Ferremax")
    expect(falso.datos.clientes[0].empresa_id).toBe(EMPRESA)
  })

  it("devuelve el cliente creado ya traducido", async () => {
    montar()

    const creado = await crearCliente({ name: "Ferremax", phone: "9999-0000" }, EMPRESA)

    expect(creado.name).toBe("Ferremax")
    expect(creado.phone).toBe("9999-0000")
  })

  it("actualiza al cliente", async () => {
    const falso = montar({ tablas: { clientes: [{ id: "c1", nombre: "Antes" }] } })

    await actualizarCliente("c1", { name: "Después" }, EMPRESA)

    expect(falso.datos.clientes[0].nombre).toBe("Después")
  })

  /*
    Un cliente no se borra: sus ventas, facturas y cuentas por cobrar lo
    necesitan. La base tampoco lo permite (0025).
  */
  it("no ofrece borrar clientes", () => {
    expect(catalogos.eliminarCliente).toBeUndefined()
  })

  it("avisa si no puede cargarlos", async () => {
    montar({ fallarEn: { clientes: { message: "sin permiso" } } })

    await expect(traerClientes()).rejects.toThrow(/No se pudo cargar los clientes/i)
  })

})

describe("proveedores", () => {
  it("los devuelve traducidos", async () => {
    montar({
      tablas: { proveedores: [{ id: "s1", nombre: "Distribuidora", contacto: "Carlos" }] },
    })

    const [proveedor] = await traerProveedores()

    expect(proveedor.name).toBe("Distribuidora")
    expect(proveedor.contact).toBe("Carlos")
  })

  it("guarda el proveedor recortando espacios", async () => {
    const falso = montar()

    await crearProveedor({ name: "  Distribuidora  ", notes: "  Cemento  " }, EMPRESA)

    expect(falso.datos.proveedores[0].nombre).toBe("Distribuidora")
    expect(falso.datos.proveedores[0].notas).toBe("Cemento")
  })

  it("actualiza al proveedor", async () => {
    const falso = montar({ tablas: { proveedores: [{ id: "s1", nombre: "Antes" }] } })

    await actualizarProveedor("s1", { name: "Después" }, EMPRESA)

    expect(falso.datos.proveedores[0].nombre).toBe("Después")
  })

  it("elimina al proveedor", async () => {
    const falso = montar({ tablas: { proveedores: [{ id: "s1", nombre: "X" }] } })

    await eliminarProveedor("s1")

    expect(falso.datos.proveedores).toHaveLength(0)
  })

  it("avisa si no puede cargarlos", async () => {
    montar({ fallarEn: { proveedores: { message: "sin permiso" } } })

    await expect(traerProveedores()).rejects.toThrow(/No se pudo cargar los proveedores/i)
  })

  /*
    Sin `suppliers`, la base no alcanza ninguna fila y responde sin error:
    la pantalla no puede decir que lo borró.
  */
  it("avisa que no tiene permiso si no se borró ningún proveedor", async () => {
    const falso = montar({ tablas: { proveedores: [{ id: "s1", nombre: "X" }] } })

    await expect(eliminarProveedor("no-visible")).rejects.toThrow(
      "No tienes permiso para eliminar el proveedor."
    )
    expect(falso.datos.proveedores).toHaveLength(1)
  })
})

describe("empresa", () => {
  it("devuelve null si todavía no hay ninguna", async () => {
    montar()

    expect(await traerEmpresa()).toBeNull()
  })

  it("la devuelve traducida cuando existe", async () => {
    montar({ tablas: { empresas: [{ id: "e1", nombre: "El Yunque", tasa_isv: "15" }] } })

    const empresa = await traerEmpresa()

    expect(empresa.name).toBe("El Yunque")
    expect(empresa.taxRate).toBe(15)
  })

  it("guarda los datos fiscales", async () => {
    const falso = montar({ tablas: { empresas: [{ id: "e1", nombre: "Antes" }] } })

    await actualizarEmpresa("e1", {
      name: "Ferretería",
      address: "San Pedro Sula",
      phone: "2222-0000",
      currency: "L",
      taxRate: 15,
      fiscal: {
        rtn: "0801",
        cai: "ABC-123",
        rangoDesde: 1000,
        rangoHasta: 9999,
        fechaLimiteEmision: "2027-12-31",
      },
    })

    const fila = falso.datos.empresas[0]

    expect(fila.cai).toBe("ABC-123")
    expect(fila.rango_desde).toBe(1000)
    expect(fila.fecha_limite_emision).toBe("2027-12-31")
  })

  /*
    Un rango vacío tiene que llegar como null y no como cero: la columna es
    bigint, y un cero significaría que el rango arranca en el documento
    número cero.
  */
  it("un rango sin llenar se guarda como nulo, no como cero", async () => {
    const falso = montar({ tablas: { empresas: [{ id: "e1", nombre: "Antes" }] } })

    await actualizarEmpresa("e1", {
      name: "Ferretería",
      fiscal: { rangoDesde: "", rangoHasta: "", fechaLimiteEmision: "" },
    })

    const fila = falso.datos.empresas[0]

    expect(fila.rango_desde).toBeNull()
    expect(fila.rango_hasta).toBeNull()
    expect(fila.fecha_limite_emision).toBeNull()
  })

  it("avisa si no puede guardar", async () => {
    montar({ fallarEn: { empresas: { update: { message: "sin permiso" } } } })

    await expect(actualizarEmpresa("e1", { name: "x" })).rejects.toThrow(
      /No se pudo guardar los datos de la empresa/i
    )
  })
})

/*
  SEC-3a: sin el permiso de su sección la base contesta 42501. Decirle
  «No se pudo…» a quien no tiene permiso lo manda a reintentar algo que
  nunca va a funcionar; tiene que saber que es una cuestión de permiso.
*/
describe("productos sin permiso", () => {
  const SIN_PERMISO = { code: "42501", message: "new row violates row-level security policy for table \"productos\"" }

  it("crear dice que falta permiso", async () => {
    montar({ fallarEn: { productos: { insert: SIN_PERMISO } } })

    await expect(
      crearProducto({ code: "M-1", name: "Martillo" }, EMPRESA, USUARIO)
    ).rejects.toThrow("No tienes permiso para crear el producto.")
  })

  it("actualizar dice que falta permiso", async () => {
    montar({ fallarEn: { productos: { update: SIN_PERMISO } } })

    await expect(
      actualizarProducto("p1", { name: "x" }, { empresaId: EMPRESA, stockAnterior: 0 })
    ).rejects.toThrow("No tienes permiso para actualizar el producto.")
  })

  it("desactivar dice que falta permiso", async () => {
    montar({ fallarEn: { productos: { update: SIN_PERMISO } } })

    await expect(desactivarProducto("p1")).rejects.toThrow("No tienes permiso para eliminar el producto.")
  })
})
