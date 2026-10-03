import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { crearVenta } from "./ventas"
import { traerProductos, actualizarProducto } from "./catalogos"
import { crearSupabaseFalso } from "../../test/supabaseFalso"

/*
  Pruebas de caracterización de las existencias.

  Describen lo que el sistema hace HOY, no lo que debería hacer. Se
  escriben antes de tocar nada porque el inventario está a punto de pasar
  a ser por ubicación, y sin una red que fije el comportamiento actual no
  hay forma de demostrar que la migración no cambió lo que el usuario ve.

  Se ejercitan contra la capa de acceso a datos y no contra las pantallas
  porque la regla que interesa —cuánto queda después de vender— vive en la
  base, no en el navegador. El doble de Supabase recalcula
  productos_con_stock sumando el libro de movimientos, igual que la vista
  real, así que lo que se comprueba es la suma y no una columna guardada.

  Dos de estos casos describen comportamiento que una fase posterior va a
  cambiar a propósito: la venta no es atómica y se deshace a mano. Quedan
  fijados aquí para que ese cambio sea visible cuando llegue.
*/

const EMPRESA = "empresa-1"
const USUARIO = "usuario-1"

const CARGADOR = {
  id: "p1",
  empresa_id: EMPRESA,
  codigo: "11",
  nombre: "Cargador",
  categoria: "Accesorios",
  precio: 250,
  costo: 150,
  stock_minimo: 5,
  activo: true,
}

const entradaInicial = (cantidad) => ({
  id: "mov-inicial",
  empresa_id: EMPRESA,
  producto_id: CARGADOR.id,
  usuario_id: USUARIO,
  venta_id: null,
  tipo: "entrada",
  cantidad,
  motivo: "Existencia inicial",
})

vi.mock("../supabase", () => ({
  get supabase() {
    return globalThis.__supabaseFalso
  },
  hayConexionConfigurada: true,
}))

const montar = ({ existenciaInicial = 10, fallarEn = {} } = {}) => {
  const falso = crearSupabaseFalso({
    tablas: {
      empresas: [
        {
          id: EMPRESA,
          nombre: "LUNACELL",
          proximo_correlativo_factura: 1000,
          proximo_correlativo_cotizacion: 2000,
          proximo_correlativo_interno: 3000,
        },
      ],
      /*
        Desde INV-3.3 la venta descuenta de la ubicación del usuario en
        sesión, así que hace falta uno con ubicación.
      */
      usuarios: [
        { id: USUARIO, auth_id: "auth-1", empresa_id: EMPRESA, activo: true, ubicacion_id: "bodega" },
      ],
      ubicaciones: [
        { id: "bodega", empresa_id: EMPRESA, nombre: "Lunacell Bodega", tipo: "bodega", activa: true, vende: true },
      ],
      productos: [CARGADOR],
      movimientos_inventario: [entradaInicial(existenciaInicial)],
      /*
        La misma existencia vista desde la ubicación. Desde INV-3.2.1 un
        ajuste corrige la celda de una ubicación, así que tiene que haberla.
      */
      inventario_ubicacion: [
        {
          empresa_id: EMPRESA,
          ubicacion_id: "bodega",
          producto_id: CARGADOR.id,
          cantidad: existenciaInicial,
        },
      ],
      ventas: [],
      detalle_venta: [],
      abonos: [],
    },
    sesionInicial: { user: { id: "auth-1" } },
    fallarEn,
  })

  globalThis.__supabaseFalso = falso

  return falso
}

const contexto = {}

const ventaDe = (cantidad) => ({
  items: [
    {
      productId: CARGADOR.id,
      name: CARGADOR.nombre,
      code: CARGADOR.codigo,
      qty: cantidad,
      price: 250,
      subtotal: 250 * cantidad,
    },
  ],
  subtotal: 250 * cantidad,
  tax: 0,
  taxRate: 0,
  total: 250 * cantidad,
  paymentType: "contado",
  customerName: "Consumidor Final",
})

const existenciaDelCargador = async () => {
  const productos = await traerProductos()

  return productos.find((producto) => producto.id === CARGADOR.id).stock
}

const salidas = (falso) =>
  falso.datos.movimientos_inventario.filter((m) => m.tipo === "salida")

const ajustes = (falso) =>
  falso.datos.movimientos_inventario.filter((m) => m.tipo === "ajuste")

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("una venta descuenta exactamente lo vendido", () => {
  it("de 10 unidades, vender 3 deja 7", async () => {
    // Arrange
    montar({ existenciaInicial: 10 })

    // Act
    await crearVenta(ventaDe(3), contexto)

    // Assert
    expect(await existenciaDelCargador()).toBe(7)
  })

  it("anota la salida como movimiento negativo y no como columna", async () => {
    const falso = montar({ existenciaInicial: 10 })

    await crearVenta(ventaDe(3), contexto)

    expect(salidas(falso)).toHaveLength(1)
    expect(salidas(falso)[0].cantidad).toBe(-3)
    expect(salidas(falso)[0].motivo).toBe("Venta")
  })

  it("deja la salida enlazada a la factura que la causó", async () => {
    const falso = montar({ existenciaInicial: 10 })

    const ventaId = await crearVenta(ventaDe(3), contexto)

    expect(salidas(falso)[0].venta_id).toBe(ventaId)
  })

  it("dos ventas seguidas descuentan las dos", async () => {
    montar({ existenciaInicial: 10 })

    await crearVenta(ventaDe(1), contexto)
    await crearVenta(ventaDe(2), contexto)

    expect(await existenciaDelCargador()).toBe(7)
  })

  /*
    Esta prueba decía «hoy nada impide que la existencia quede negativa»,
    y anunciaba que cambiaría a propósito cuando el inventario por
    ubicación lo cerrara en PostgreSQL. INV-3.3 es ese cambio: el RPC
    rechaza la venta y no toca nada.
  */
  it("vender más de lo que hay en la ubicación se rechaza y no toca nada", async () => {
    const falso = montar({ existenciaInicial: 2 })

    await expect(crearVenta(ventaDe(5), contexto)).rejects.toMatchObject({
      motivo: "existencia-insuficiente",
    })

    expect(await existenciaDelCargador()).toBe(2)
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(2)
  })

  it("la salida queda en la ubicación de quien vende y descuenta su celda", async () => {
    const falso = montar({ existenciaInicial: 10 })

    await crearVenta(ventaDe(3), contexto)

    expect(salidas(falso)[0].ubicacion_id).toBe("bodega")
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(7)
  })
})

describe("el ajuste manual registra únicamente la diferencia", () => {
  const editar = (stock, stockAnterior) =>
    actualizarProducto(
      CARGADOR.id,
      {
        code: CARGADOR.codigo,
        name: CARGADOR.nombre,
        category: CARGADOR.categoria,
        price: 250,
        costPrice: 150,
        minStock: 5,
        stock,
      },
      { empresaId: EMPRESA, stockAnterior, ubicacionId: "bodega" }
    )

  it("bajar de 10 a 7 anota un movimiento de -3", async () => {
    // Arrange
    const falso = montar({ existenciaInicial: 10 })

    // Act
    await editar(7, 10)

    // Assert
    expect(ajustes(falso)).toHaveLength(1)
    expect(ajustes(falso)[0].cantidad).toBe(-3)
    expect(ajustes(falso)[0].ubicacion_id).toBe("bodega")
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(7)
  })

  it("la existencia resultante es la que el usuario escribió", async () => {
    montar({ existenciaInicial: 10 })

    await editar(7, 10)

    expect(await existenciaDelCargador()).toBe(7)
  })

  it("subir de 10 a 14 anota un movimiento de +4", async () => {
    const falso = montar({ existenciaInicial: 10 })

    await editar(14, 10)

    expect(ajustes(falso)[0].cantidad).toBe(4)
    expect(await existenciaDelCargador()).toBe(14)
  })

  /*
    Sobrescribir el número borraría el rastro de por qué cambió. El libro
    conserva la entrada original y le suma el ajuste.
  */
  it("conserva la entrada original en el libro", async () => {
    const falso = montar({ existenciaInicial: 10 })

    await editar(7, 10)

    expect(falso.datos.movimientos_inventario).toHaveLength(2)
    expect(falso.datos.movimientos_inventario[0].cantidad).toBe(10)
  })
})

/*
  Hasta INV-3.3, crearVenta escribía en tres pasos —cabecera, renglones y
  movimientos— y, si uno fallaba, borraba la cabecera a mano. Esa
  compensación era frágil por diseño: una segunda llamada que podía fallar
  a su vez, y el número ya pedido no se devolvía.

  Ahora la venta es una sola llamada a registrar_venta_ubicacion(), que es
  una transacción: o entra todo o no entra nada, y el navegador no tiene
  nada que deshacer.
*/
describe("cuando la venta falla", () => {
  const errorDeBase = { message: "connection reset" }

  const montarConFalla = () =>
    montar({ fallarEn: { registrar_venta_ubicacion: errorDeBase } })

  it("propaga el fallo en lugar de devolver una factura", async () => {
    montarConFalla()

    await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow(
      "No se pudo registrar la venta."
    )
  })

  it("no deja cabecera, renglones ni salidas", async () => {
    const falso = montarConFalla()

    await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

    expect(falso.datos.ventas).toHaveLength(0)
    expect(falso.datos.detalle_venta).toHaveLength(0)
    expect(salidas(falso)).toHaveLength(0)
  })

  it("deja la existencia como estaba", async () => {
    const falso = montarConFalla()

    await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

    expect(await existenciaDelCargador()).toBe(10)
    expect(falso.datos.inventario_ubicacion[0].cantidad).toBe(10)
  })

  /*
    El navegador ya no borra nada: no hay cabecera suya que deshacer. Es
    la prueba de que la compensación desapareció, no solo de que no hizo
    falta esta vez.
  */
  it("no intenta borrar nada por su cuenta", async () => {
    const falso = montarConFalla()

    await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

    expect(falso.from).not.toHaveBeenCalledWith("ventas")
  })

  /*
    Antes el correlativo se pedía antes de insertar y una venta deshecha
    lo dejaba gastado. Ahora se pide dentro de la transacción.
  */
  it("una venta rechazada no consume número", async () => {
    const falso = montar({ existenciaInicial: 1 })

    await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

    expect(falso.datos.empresas[0].proximo_correlativo_interno).toBe(3000)
    expect(falso.datos.empresas[0].proximo_correlativo_factura).toBe(1000)
  })
})
