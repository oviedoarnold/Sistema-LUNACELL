import { describe, it, expect } from "vitest"

import {
  DEFAULT_LOCATION_TYPE,
  LOCATION_TYPES,
  LOCATION_TYPE_OPTIONS,
  filterLocationsBySearchText,
  getLocationNameError,
  getLocationTypeLabel,
  isValidLocationType,
} from "./locations"

const UBICACIONES = [
  { id: "u1", name: "Bodega Principal", type: LOCATION_TYPES.WAREHOUSE, active: true },
  { id: "u2", name: "Lunacell Store", type: LOCATION_TYPES.STORE, active: true },
  { id: "u3", name: "Camión 01", type: LOCATION_TYPES.TRUCK, active: true },
  { id: "u4", name: "Camión 02", type: LOCATION_TYPES.TRUCK, active: false },
]

describe("tipos de ubicación", () => {
  it("acepta los tipos que la base permite", () => {
    expect(isValidLocationType(LOCATION_TYPES.WAREHOUSE)).toBe(true)
    expect(isValidLocationType(LOCATION_TYPES.STORE)).toBe(true)
    expect(isValidLocationType(LOCATION_TYPES.TRUCK)).toBe(true)
    expect(isValidLocationType(LOCATION_TYPES.OTHER)).toBe(true)
  })

  it("rechaza un tipo inventado", () => {
    expect(isValidLocationType("nave-espacial")).toBe(false)
  })

  it("rechaza un tipo vacío", () => {
    expect(isValidLocationType("")).toBe(false)
    expect(isValidLocationType(undefined)).toBe(false)
  })

  it("el tipo por omisión es uno válido", () => {
    expect(isValidLocationType(DEFAULT_LOCATION_TYPE)).toBe(true)
  })

  /*
    La lista desplegable y la restricción de la base tienen que ofrecer lo
    mismo: una opción de más deja al usuario elegir algo que la base
    rechaza al guardar.
  */
  it("todas las opciones del desplegable son tipos válidos", () => {
    LOCATION_TYPE_OPTIONS.forEach((opcion) => {
      expect(isValidLocationType(opcion.value)).toBe(true)
    })
  })

  it("ofrece una opción por cada tipo", () => {
    expect(LOCATION_TYPE_OPTIONS).toHaveLength(
      Object.values(LOCATION_TYPES).length
    )
  })
})

describe("getLocationTypeLabel", () => {
  it("traduce el tipo al nombre que ve el usuario", () => {
    expect(getLocationTypeLabel(LOCATION_TYPES.WAREHOUSE)).toBe("Bodega")
    expect(getLocationTypeLabel(LOCATION_TYPES.STORE)).toBe("Tienda")
    expect(getLocationTypeLabel(LOCATION_TYPES.TRUCK)).toBe("Camión")
  })

  /*
    Un tipo que la base acepte pero la aplicación no conozca todavía se
    muestra crudo: es más útil que una celda vacía.
  */
  it("muestra el valor crudo cuando el tipo es desconocido", () => {
    expect(getLocationTypeLabel("taller")).toBe("taller")
  })

  it("no deja la celda vacía cuando no hay tipo", () => {
    expect(getLocationTypeLabel("")).toBe("—")
    expect(getLocationTypeLabel(null)).toBe("—")
  })
})

describe("filterLocationsBySearchText", () => {
  it("devuelve todas las ubicaciones cuando no se busca nada", () => {
    expect(filterLocationsBySearchText(UBICACIONES, "")).toHaveLength(4)
  })

  it("filtra por nombre", () => {
    const encontradas = filterLocationsBySearchText(UBICACIONES, "bodega principal")

    expect(encontradas).toHaveLength(1)
    expect(encontradas[0].name).toBe("Bodega Principal")
  })

  it("ignora mayúsculas y espacios sobrantes", () => {
    const encontradas = filterLocationsBySearchText(UBICACIONES, "  LUNACELL  ")

    expect(encontradas).toHaveLength(1)
    expect(encontradas[0].name).toBe("Lunacell Store")
  })

  /*
    Buscar "camión" tiene que traer los dos camiones aunque ninguno se
    llame así: quien busca por tipo no se sabe los nombres de memoria.
  */
  it("filtra también por el nombre del tipo", () => {
    const encontradas = filterLocationsBySearchText(UBICACIONES, "camión")

    expect(encontradas).toHaveLength(2)
  })

  it("no devuelve nada cuando la búsqueda no coincide", () => {
    expect(filterLocationsBySearchText(UBICACIONES, "sucursal")).toHaveLength(0)
  })

  it("incluye las desactivadas, que también se buscan", () => {
    const encontradas = filterLocationsBySearchText(UBICACIONES, "Camión 02")

    expect(encontradas).toHaveLength(1)
    expect(encontradas[0].active).toBe(false)
  })

  it("aguanta una lista vacía o ausente", () => {
    expect(filterLocationsBySearchText([], "algo")).toEqual([])
    expect(filterLocationsBySearchText(undefined, "algo")).toEqual([])
  })
})

describe("getLocationNameError", () => {
  it("no se queja de un nombre válido", () => {
    expect(getLocationNameError("Bodega Principal")).toBeNull()
  })

  it("exige un nombre", () => {
    expect(getLocationNameError("")).toBeTruthy()
  })

  it("no acepta un nombre que solo tiene espacios", () => {
    expect(getLocationNameError("   ")).toBeTruthy()
  })

  it("no acepta la ausencia de nombre", () => {
    expect(getLocationNameError(undefined)).toBeTruthy()
  })
})
