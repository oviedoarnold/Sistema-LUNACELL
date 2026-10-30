export const PERMISSIONS = {
  DASHBOARD: "dashboard",
  POS: "pos",
  QUOTES: "quotes",
  PRODUCTS: "products",
  CLIENTS: "clients",
  SUPPLIERS: "suppliers",
  SALES_HISTORY: "sales-history",

  /*
    Anular ventas. Aparte del historial a propósito: ver y cobrar no es lo
    mismo que anular una venta ya cobrada. Al vendedor se le exigen las dos
    marcas, y la base lo comprueba en anular_venta(), no solo esta pantalla.
  */
  SALES_VOID: "sales-void",
  LOCATIONS: "locations",
  SETTINGS: "settings",

  /*
    Qué inventario puede consultar.

    Son dos y no uno porque son dos concesiones distintas: ver lo que lleva
    el camión propio lo necesita cualquiera que venda, y ver lo de todas las
    ubicaciones es una decisión aparte del administrador.

    Los nombres son los que la migración 0015 ya acepta en
    permisos_usuario.seccion. No se inventan aquí: cambiarlos obligaría a
    otra migración para que la base los admitiera.
  */
  INVENTORY_OWN: "inventory-own",
  INVENTORY_ALL: "inventory-all",
}

/*
  Permisos que otro ya concede, para no tener que repartirlos dos veces.

  «Ver el inventario de todas las ubicaciones» incluye por definición ver el
  de la propia, así que exigir las dos marcas sería pedirle al administrador
  que diga lo mismo dos veces, y dejaría al usuario fuera de la pantalla el
  día que olvide una.

  Se deriva en vez de guardarse. La base ya razona igual —
  `usuario_ve_ubicacion()` trata `inventory-all` como suficiente por sí
  solo, sin mirar `inventory-own`— y guardar la implicación como dos filas
  abriría la puerta a que las dos reglas se separen: bastaría con escribir
  un permiso por SQL para que la pantalla y el motor dejaran de coincidir.
*/
const IMPLICA = {
  [PERMISSIONS.INVENTORY_ALL]: [PERMISSIONS.INVENTORY_OWN],
}

/*
  Si esa lista de permisos concede el que se pregunta, directamente o porque
  otro lo incluye. No sabe nada de roles: quién es administrador lo decide
  AuthContext, que es quien conoce al usuario.
*/
export function concedePermiso(permisos, permiso) {
  if (!Array.isArray(permisos)) {
    return false
  }

  if (permisos.includes(permiso)) {
    return true
  }

  return permisos.some((otro) => (IMPLICA[otro] || []).includes(permiso))
}

export const ADMIN_PERMISSIONS = Object.values(PERMISSIONS)

/*
  Los roles que acepta la base (0036). El contador consulta y no escribe:
  la base lo detiene en cada tabla, y estas pantallas solo le ahorran los
  botones que de todos modos fallarían.
*/
export const ROLES = {
  ADMIN: "admin",
  VENDEDOR: "vendedor",
  CONTADOR: "contador",
}

/*
  Las secciones que se le pueden habilitar a un contador: las que tienen
  algo que consultar. Las demás son operación pura —facturar, administrar
  el catálogo, anular, ubicaciones, configuración— y no se le ofrecen. Si
  alguien se las marcara por SQL, la pantalla tampoco las abre.
*/
export const CONTADOR_PERMISSIONS = [
  PERMISSIONS.DASHBOARD,
  PERMISSIONS.QUOTES,
  PERMISSIONS.CLIENTS,
  PERMISSIONS.SUPPLIERS,
  PERMISSIONS.SALES_HISTORY,
  PERMISSIONS.INVENTORY_OWN,
  PERMISSIONS.INVENTORY_ALL,
]

/* Lo que se guarda para un rol: todo para el administrador, y lo consultable para el contador. */
export function permisosDelRol(rol, permisos = []) {
  if (rol === ROLES.ADMIN) return ADMIN_PERMISSIONS
  if (rol === ROLES.CONTADOR) return permisos.filter((p) => CONTADOR_PERMISSIONS.includes(p))

  return permisos
}

/*
  Punto de partida para un vendedor nuevo.
  El administrador los ajusta uno por uno
  desde Configuración.

  Lleva el inventario de su propia ubicación porque un vendedor que no sabe
  qué lleva su camión no puede vender desde él.
*/
export const SELLER_PERMISSIONS = [
  PERMISSIONS.DASHBOARD,
  PERMISSIONS.POS,
  PERMISSIONS.QUOTES,
  PERMISSIONS.CLIENTS,
  PERMISSIONS.SALES_HISTORY,
  PERMISSIONS.INVENTORY_OWN,
]
