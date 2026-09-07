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
  registrarMovimiento,
  traerClientes,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
  traerProveedores,
  crearProveedor,
  actualizarProveedor,
  eliminarProveedor,
  traerEmpresa,
  actualizarEmpresa,
} from "./catalogos"
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

  it("una ferretería sin configurar trae los valores por omisión", () => {
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
    Las existencias iniciales entran como movimiento y no como columna: el
    stock es la suma del libro, para que siempre haya rastro.
  */
  it("la existencia inicial entra como movimiento de entrada", async () => {
    const falso = montar()

    await crearProducto({ code: "M-1", name: "Martillo", stock: 12 }, EMPRESA, USUARIO)

    const [movimiento] = falso.datos.movimientos_inventario

    expect(movimiento.tipo).toBe("entrada")
    expect(movimiento.cantidad).toBe(12)
    expect(movimiento.motivo).toBe("Existencia inicial")
  })

  it("un producto que nace sin existencias no registra movimiento", async () => {
    const falso = montar()

    await crearProducto({ code: "M-1", name: "Martillo", stock: 0 }, EMPRESA, USUARIO)

    expect(falso.datos.movimientos_inventario).toHaveLength(0)
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
    Editar no reescribe el stock: registra el ajuste por la diferencia.
    Sobrescribir el número borraría el rastro de por qué cambió.
  */
  it("cambiar la cantidad registra el ajuste por la diferencia", async () => {
    const falso = montar({ tablas: { productos: [{ id: "p1", nombre: "Martillo" }] } })

    await actualizarProducto("p1", { name: "Martillo", stock: 15 }, {
      empresaId: EMPRESA,
      usuarioId: USUARIO,
      stockAnterior: 10,
    })

    const [movimiento] = falso.datos.movimientos_inventario

    expect(movimiento.tipo).toBe("ajuste")
    expect(movimiento.cantidad).toBe(5)
  })

  it("un ajuste hacia abajo queda como cantidad negativa", async () => {
    const falso = montar({ tablas: { productos: [{ id: "p1", nombre: "Martillo" }] } })

    await actualizarProducto("p1", { name: "Martillo", stock: 4 }, {
      empresaId: EMPRESA,
      usuarioId: USUARIO,
      stockAnterior: 10,
    })

    expect(falso.datos.movimientos_inventario[0].cantidad).toBe(-6)
  })

  it("editar sin tocar la cantidad no registra movimiento", async () => {
    const falso = montar({ tablas: { productos: [{ id: "p1", nombre: "Martillo" }] } })

    await actualizarProducto("p1", { name: "Martillo de uña", stock: 10 }, {
      empresaId: EMPRESA,
      usuarioId: USUARIO,
      stockAnterior: 10,
    })

    expect(falso.datos.movimientos_inventario).toHaveLength(0)
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

  it("avisa si no puede registrar un movimiento", async () => {
    montar({ fallarEn: { movimientos_inventario: { message: "sin permiso" } } })

    await expect(
      registrarMovimiento({
        empresaId: EMPRESA,
        productoId: "p1",
        tipo: "entrada",
        cantidad: 1,
      })
    ).rejects.toThrow(/No se pudo registrar el movimiento/i)
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

  it("elimina al cliente", async () => {
    const falso = montar({ tablas: { clientes: [{ id: "c1", nombre: "Ferremax" }] } })

    await eliminarCliente("c1")

    expect(falso.datos.clientes).toHaveLength(0)
  })

  it("avisa si no puede cargarlos", async () => {
    montar({ fallarEn: { clientes: { message: "sin permiso" } } })

    await expect(traerClientes()).rejects.toThrow(/No se pudo cargar los clientes/i)
  })

  it("avisa si no puede eliminarlo", async () => {
    montar({ fallarEn: { clientes: { delete: { message: "sin permiso" } } } })

    await expect(eliminarCliente("c1")).rejects.toThrow(/No se pudo eliminar el cliente/i)
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
})

describe("ferretería", () => {
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
      /No se pudo guardar los datos de la ferretería/i
    )
  })
})
