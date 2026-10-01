import { describe, it, expect } from "vitest"

import {
  agruparPorProducto,
  etiquetaDeTipo,
  filtrarPorTexto,
  filtrarPorUbicacion,
  totalVisible,
  ubicacionesPresentes,
} from "./inventario"

/*
  La agrupación y los filtros de la consulta de existencias.

  Se prueban aparte de la pantalla porque son la parte que se equivoca en
  silencio: una fila de más o de menos no rompe nada visible, solo cambia
  una cantidad, y eso no se nota mirando.

  La afirmación que sostiene todo el archivo: estas funciones no inventan
  ubicaciones. Lo que no venía en las filas no sale.
*/

const CARGADOR = "p-cargador"
const CUBO = "p-cubo"

const fila = (ubicacion, producto, cantidad, extra = {}) => ({
  locationId: `u-${ubicacion}`,
  locationName: ubicacion,
  locationType: extra.type || "bodega",
  productId: producto === "Cargador" ? CARGADOR : CUBO,
  code: producto === "Cargador" ? "LCCOBERESAM" : "LCCUBOESAM",
  productName: producto,
  quantity: cantidad,
})

/* Lo que la base devolvería a un administrador: 2 productos × 3 ubicaciones. */
const DEL_ADMIN = [
  fila("Lunacell Bodega", "Cargador", 15),
  fila("Camión 01", "Cargador", 3, { type: "camion" }),
  fila("Camión 02", "Cargador", 12, { type: "camion" }),
  fila("Lunacell Bodega", "Cubo Iphone", 0),
  fila("Camión 01", "Cubo Iphone", 0, { type: "camion" }),
  fila("Camión 02", "Cubo Iphone", 0, { type: "camion" }),
]

/* Lo que devolvería a un vendedor con inventory-own sobre el Camión 01. */
const DEL_VENDEDOR = [
  fila("Camión 01", "Cargador", 3, { type: "camion" }),
  fila("Camión 01", "Cubo Iphone", 0, { type: "camion" }),
]

describe("agruparPorProducto", () => {
  it("junta cada producto con sus ubicaciones", () => {
    const grupos = agruparPorProducto(DEL_ADMIN)

    expect(grupos).toHaveLength(2)
    expect(grupos.map((g) => g.productName)).toEqual([
      "Cargador",
      "Cubo Iphone",
    ])
    expect(grupos[0].ubicaciones).toHaveLength(3)
  })

  it("suma el total de cada producto", () => {
    const [cargador, cubo] = agruparPorProducto(DEL_ADMIN)

    expect(cargador.total).toBe(30)
    expect(cubo.total).toBe(0)
  })

  it("conserva el código del producto", () => {
    const [cargador] = agruparPorProducto(DEL_ADMIN)

    expect(cargador.code).toBe("LCCOBERESAM")
  })

  /*
    El orden no depende de cómo llegaron las filas. Si dependiera, la
    lista cambiaría de orden sola el día que cambie la consulta, y nadie
    lo notaría hasta buscar un producto donde estaba ayer.
  */
  it("ordena los productos y sus ubicaciones por nombre", () => {
    const alReves = [...DEL_ADMIN].reverse()

    const grupos = agruparPorProducto(alReves)

    expect(grupos.map((g) => g.productName)).toEqual([
      "Cargador",
      "Cubo Iphone",
    ])
    expect(grupos[0].ubicaciones.map((u) => u.locationName)).toEqual([
      "Camión 01",
      "Camión 02",
      "Lunacell Bodega",
    ])
  })

  /*
    Ésta es la prueba que importa de todo el archivo.

    Al vendedor del Camión 01 le llegan dos filas, las de su camión. Lo que
    NO debe pasar es que la agrupación complete la cuadrícula con la
    bodega y el otro camión en cero: ese cero sería mentira —hay 15 y 12—
    y además le diría que esas ubicaciones existen.

    Lo que no llegó no se dibuja.
  */
  it("no inventa ubicaciones que no venían en las filas", () => {
    const grupos = agruparPorProducto(DEL_VENDEDOR)

    expect(grupos).toHaveLength(2)

    for (const grupo of grupos) {
      expect(grupo.ubicaciones).toHaveLength(1)
      expect(grupo.ubicaciones[0].locationName).toBe("Camión 01")
    }

    const nombres = grupos.flatMap((g) =>
      g.ubicaciones.map((u) => u.locationName)
    )

    expect(nombres).not.toContain("Lunacell Bodega")
    expect(nombres).not.toContain("Camión 02")
  })

  it("una ubicación que vino con cero sí aparece, con cero", () => {
    const [, cubo] = agruparPorProducto(DEL_VENDEDOR)

    expect(cubo.ubicaciones[0].quantity).toBe(0)
  })

  it("sin filas no devuelve grupos", () => {
    expect(agruparPorProducto([])).toEqual([])
    expect(agruparPorProducto()).toEqual([])
  })
})

describe("totalVisible", () => {
  /*
    El total es el de lo visible, no el de lo que existe. Para el vendedor
    del Camión 01 son 3, no 30: enseñarle 30 sería contarle lo que hay en
    la ubicación prohibida, con otro formato.
  */
  it("suma solo lo que el usuario recibió", () => {
    expect(totalVisible(agruparPorProducto(DEL_ADMIN))).toBe(30)
    expect(totalVisible(agruparPorProducto(DEL_VENDEDOR))).toBe(3)
  })

  it("sin grupos es cero", () => {
    expect(totalVisible([])).toBe(0)
    expect(totalVisible()).toBe(0)
  })
})

describe("filtrarPorTexto", () => {
  it("encuentra por nombre del producto", () => {
    expect(filtrarPorTexto(DEL_ADMIN, "cubo")).toHaveLength(3)
  })

  it("encuentra por código", () => {
    expect(filtrarPorTexto(DEL_ADMIN, "LCCOBER")).toHaveLength(3)
  })

  /* Quien escribe «camion» en el buscador de productos no busca un camión. */
  it("no busca por ubicación", () => {
    expect(filtrarPorTexto(DEL_ADMIN, "Camión 01")).toHaveLength(0)
  })

  it("ignora tildes y mayúsculas", () => {
    expect(filtrarPorTexto(DEL_ADMIN, "IPHONE")).toHaveLength(3)
  })

  it("un texto vacío no filtra nada", () => {
    expect(filtrarPorTexto(DEL_ADMIN, "")).toHaveLength(6)
    expect(filtrarPorTexto(DEL_ADMIN, "   ")).toHaveLength(6)
  })

  it("sin coincidencias devuelve vacío", () => {
    expect(filtrarPorTexto(DEL_ADMIN, "zzzznoexiste")).toEqual([])
  })
})

describe("filtrarPorUbicacion", () => {
  it("deja solo las filas de esa ubicación", () => {
    const filas = filtrarPorUbicacion(DEL_ADMIN, "u-Camión 02")

    expect(filas).toHaveLength(2)
    expect(filas.every((f) => f.locationName === "Camión 02")).toBe(true)
  })

  it("sin ubicación elegida no filtra", () => {
    expect(filtrarPorUbicacion(DEL_ADMIN, "")).toHaveLength(6)
  })

  /* El <select> entrega cadenas, así que la comparación no puede ser estricta. */
  it("compara el identificador como texto", () => {
    const numericas = [{ ...fila("Bodega", "Cargador", 1), locationId: 7 }]

    expect(filtrarPorUbicacion(numericas, "7")).toHaveLength(1)
  })
})

describe("ubicacionesPresentes", () => {
  it("lista cada ubicación una sola vez", () => {
    const u = ubicacionesPresentes(DEL_ADMIN)

    expect(u).toHaveLength(3)
    expect(u.map((x) => x.locationName)).toEqual([
      "Lunacell Bodega",
      "Camión 01",
      "Camión 02",
    ])
  })

  /*
    El selector se arma con esto, así que ofrecer una ubicación que no
    llegó ya le estaría diciendo al usuario que existe, aunque elegirla no
    devolviera nada.
  */
  it("no ofrece ubicaciones que el usuario no recibió", () => {
    const u = ubicacionesPresentes(DEL_VENDEDOR)

    expect(u).toHaveLength(1)
    expect(u[0].locationName).toBe("Camión 01")
  })

  it("conserva el tipo de cada una", () => {
    const u = ubicacionesPresentes(DEL_ADMIN)

    expect(u.find((x) => x.locationName === "Camión 01").locationType).toBe(
      "camion"
    )
  })
})

describe("etiquetaDeTipo", () => {
  it("traduce los tipos del esquema", () => {
    expect(etiquetaDeTipo("bodega")).toBe("Bodega")
    expect(etiquetaDeTipo("tienda")).toBe("Tienda")
    expect(etiquetaDeTipo("camion")).toBe("Camión")
  })

  /* Un tipo que el frontend no conoce no debe dejar la celda en blanco. */
  it("un tipo desconocido no se queda sin texto", () => {
    expect(etiquetaDeTipo("nave-espacial")).toBe("Otra")
    expect(etiquetaDeTipo(undefined)).toBe("Otra")
  })
})
