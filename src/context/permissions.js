export const PERMISSIONS = {
  DASHBOARD: "dashboard",
  POS: "pos",
  QUOTES: "quotes",
  PRODUCTS: "products",
  CLIENTS: "clients",
  SUPPLIERS: "suppliers",
  SALES_HISTORY: "sales-history",
  SETTINGS: "settings",
}

export const ADMIN_PERMISSIONS = Object.values(PERMISSIONS)

/*
  Punto de partida para un vendedor nuevo.
  El administrador los ajusta uno por uno
  desde Configuración.
*/
export const SELLER_PERMISSIONS = [
  PERMISSIONS.DASHBOARD,
  PERMISSIONS.POS,
  PERMISSIONS.QUOTES,
  PERMISSIONS.CLIENTS,
  PERMISSIONS.SALES_HISTORY,
]
