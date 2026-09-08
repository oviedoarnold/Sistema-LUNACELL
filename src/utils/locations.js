/*
  Reglas de las ubicaciones que no dependen de React ni de la base.

  Una ubicación es un punto de inventario: la bodega, la tienda o un
  camión. El tipo no cambia lo que el sistema hace con ella —todas van a
  guardar y mover mercadería igual—, sirve para que quien mira la lista
  distinga de un vistazo un camión de una bodega.
*/

export const LOCATION_TYPES = {
  WAREHOUSE: "bodega",
  STORE: "tienda",
  TRUCK: "camion",
  OTHER: "otro",
}

/*
  El orden es el de la lista desplegable, de lo más común a lo menos: casi
  toda ubicación nueva será una bodega o una tienda.
*/
export const LOCATION_TYPE_OPTIONS = [
  { value: LOCATION_TYPES.WAREHOUSE, label: "Bodega" },
  { value: LOCATION_TYPES.STORE, label: "Tienda" },
  { value: LOCATION_TYPES.TRUCK, label: "Camión" },
  { value: LOCATION_TYPES.OTHER, label: "Otro" },
]

export const DEFAULT_LOCATION_TYPE = LOCATION_TYPES.WAREHOUSE

export function isValidLocationType(type) {
  return Object.values(LOCATION_TYPES).includes(type)
}

/*
  Un tipo que la base acepte pero la aplicación todavía no conozca se
  muestra tal cual en vez de dejar la celda vacía: es más útil ver el valor
  crudo que un hueco.
*/
export function getLocationTypeLabel(type) {
  const option = LOCATION_TYPE_OPTIONS.find((item) => item.value === type)

  return option ? option.label : String(type || "—")
}

export function filterLocationsBySearchText(locations, searchText) {
  const query = String(searchText || "").trim().toLowerCase()

  return (locations || []).filter((location) =>
    [location.name, getLocationTypeLabel(location.type)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query)
  )
}

/*
  El nombre es lo único obligatorio. Devuelve el aviso a mostrar, o null si
  el nombre sirve, para que quien llame decida cómo enseñarlo.
*/
export function getLocationNameError(name) {
  if (!String(name || "").trim()) {
    return "El nombre de la ubicación es obligatorio."
  }

  return null
}
