import { PERMISSIONS } from "../context/permissions"

/*
  Ruta que protege cada permiso, en el
  mismo orden que las pestañas del menú.

  ProtectedRoute la recorre para saber a
  qué página mandar a un usuario que
  entró a una ruta que no tiene
  habilitada.
*/
export const NAV_ROUTES = [
  {
    path: "/dashboard",
    permission: PERMISSIONS.DASHBOARD,
  },
  {
    path: "/pos",
    permission: PERMISSIONS.POS,
  },
  {
    path: "/quotes",
    permission: PERMISSIONS.QUOTES,
  },
  {
    path: "/products",
    permission: PERMISSIONS.PRODUCTS,
  },
  {
    path: "/clients",
    permission: PERMISSIONS.CLIENTS,
  },
  {
    path: "/suppliers",
    permission: PERMISSIONS.SUPPLIERS,
  },
  {
    path: "/sales-history",
    permission: PERMISSIONS.SALES_HISTORY,
  },
  {
    path: "/settings",
    permission: PERMISSIONS.SETTINGS,
  },
]
