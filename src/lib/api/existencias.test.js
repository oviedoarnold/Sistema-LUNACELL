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
        },
      ],
      productos: [CARGADOR],
      movimientos_inventario: [entradaInicial(existenciaInicial)],
      ventas: [],
      detalle_venta: [],
      abonos: [],
    },
    fallarEn,
  })

  globalThis.__supabaseFalso = falso

  return falso
}

const contexto = { empresaId: EMPRESA, usuarioId: USUARIO, empresa: {} }

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
    Nada en la base impide vender más de lo que hay: la única defensa
    contra la sobreventa vive hoy en el navegador. Se fija aquí porque es
    justo lo que el inventario por ubicación va a cerrar en PostgreSQL, y
    entonces esta prueba tendrá que cambiar a propósito.
  */
  it("hoy nada impide que la existencia quede negativa", async () => {
    montar({ existenciaInicial: 2 })

    await crearVenta(ventaDe(5), contexto)

    expect(await existenciaDelCargador()).toBe(-3)
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
      { empresaId: EMPRESA, usuarioId: USUARIO, stockAnterior }
    )

  it("bajar de 10 a 7 anota un movimiento de -3", async () => {
    // Arrange
    const falso = montar({ existenciaInicial: 10 })

    // Act
    await editar(7, 10)

    // Assert
    expect(ajustes(falso)).toHaveLength(1)
    expect(ajustes(falso)[0].cantidad).toBe(-3)
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
  crearVenta escribe en tres pasos —cabecera, renglones y movimientos— y
  los orquesta el navegador. Cuando uno de los dos últimos falla, borra la
  cabecera a mano para no dejar una factura a medias.

  Esa compensación es frágil por diseño: es una segunda llamada que puede
  fallar a su vez. Una fase posterior la reemplaza por una transacción en
  PostgreSQL. Estas pruebas fijan lo que hace hoy para que el cambio se
  pueda comparar contra algo.
*/
describe("cuando falla una parte de la venta", () => {
  const errorDeBase = { message: "sin permiso", code: "42501" }

  describe("falla el detalle de la factura", () => {
    const montarConFalla = () =>
      montar({ fallarEn: { detalle_venta: errorDeBase } })

    it("propaga el fallo en lugar de devolver una factura", async () => {
      montarConFalla()

      await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow(
        "No se pudo guardar el detalle de la venta."
      )
    })

    it("borra la cabecera que ya había insertado", async () => {
      const falso = montarConFalla()

      await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

      expect(falso.datos.ventas).toHaveLength(0)
    })

    it("no descarga el inventario", async () => {
      const falso = montarConFalla()

      await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

      expect(salidas(falso)).toHaveLength(0)
    })

    it("deja la existencia como estaba", async () => {
      montarConFalla()

      await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

      expect(await existenciaDelCargador()).toBe(10)
    })
  })

  describe("falla la descarga de inventario", () => {
    const montarConFalla = () =>
      montar({ fallarEn: { movimientos_inventario: { insert: errorDeBase } } })

    it("propaga el fallo", async () => {
      montarConFalla()

      await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow(
        "No se pudo descargar el inventario de la venta."
      )
    })

    it("borra la cabecera que ya había insertado", async () => {
      const falso = montarConFalla()

      await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

      expect(falso.datos.ventas).toHaveLength(0)
    })

    /*
      El detalle sí alcanzó a guardarse y la compensación no lo borra: se
      apoya en el borrado en cascada de PostgreSQL, que el doble no imita.
      Queda anotado porque es exactamente la clase de suposición que una
      transacción de verdad vuelve innecesaria.
    */
    it("no borra por su cuenta los renglones ya guardados", async () => {
      const falso = montarConFalla()

      await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

      expect(falso.datos.detalle_venta).toHaveLength(1)
    })

    it("deja la existencia como estaba", async () => {
      montarConFalla()

      await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

      expect(await existenciaDelCargador()).toBe(10)
    })
  })

  /*
    El correlativo se pide antes de insertar. Si la venta se deshace, ese
    número ya se gastó y la siguiente factura salta. Es comportamiento
    actual, no un defecto que esta fase venga a corregir.
  */
  it("el correlativo ya pedido no se devuelve", async () => {
    const falso = montar({ fallarEn: { detalle_venta: errorDeBase } })

    await expect(crearVenta(ventaDe(3), contexto)).rejects.toThrow()

    expect(falso.datos.empresas[0].proximo_correlativo_factura).toBe(1001)
  })
})
