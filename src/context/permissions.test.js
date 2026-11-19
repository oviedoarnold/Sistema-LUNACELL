import { describe, it, expect } from "vitest"

import {
  ADMIN_PERMISSIONS,
  CONTADOR_PERMISSIONS,
  PERMISSIONS,
  SELLER_PERMISSIONS,
  concedePermiso,
} from "./permissions"

/*
  Qué permiso concede qué.

  Lo que importa aquí es la implicación: «ver el inventario de todas las
  ubicaciones» incluye por definición ver el de la propia. Si no estuviera
  escrita, un usuario con el permiso amplio no podría abrir la pantalla
  —porque la ruta pide el de su ubicación— y nadie entendería por qué.

  La misma regla vive en la base, dentro de usuario_ve_ubicacion(), que
  trata inventory-all como suficiente sin mirar inventory-own. Que las dos
  digan lo mismo es lo que hace que la pantalla no prometa algo que el
  motor luego niegue.
*/

describe("concedePermiso", () => {
  it("concede lo que está en la lista", () => {
    expect(concedePermiso([PERMISSIONS.POS], PERMISSIONS.POS)).toBe(true)
  })

  it("no concede lo que no está", () => {
    expect(concedePermiso([PERMISSIONS.POS], PERMISSIONS.SETTINGS)).toBe(false)
  })

  /* La implicación, que es la razón de existir de esta función. */
  it("ver todas las ubicaciones ya incluye ver la propia", () => {
    expect(
      concedePermiso([PERMISSIONS.INVENTORY_ALL], PERMISSIONS.INVENTORY_OWN)
    ).toBe(true)
  })

  it("pero ver la propia no concede ver todas", () => {
    expect(
      concedePermiso([PERMISSIONS.INVENTORY_OWN], PERMISSIONS.INVENTORY_ALL)
    ).toBe(false)
  })

  /*
    La implicación es de ese permiso y no una regla general: si se
    extendiera sola a otros, repartir permisos dejaría de ser previsible.
  */
  it("no inventa implicaciones entre otros permisos", () => {
    expect(concedePermiso([PERMISSIONS.SETTINGS], PERMISSIONS.POS)).toBe(false)
    expect(
      concedePermiso([PERMISSIONS.PRODUCTS], PERMISSIONS.INVENTORY_OWN)
    ).toBe(false)
  })

  it("una lista vacía o ausente no concede nada", () => {
    expect(concedePermiso([], PERMISSIONS.POS)).toBe(false)
    expect(concedePermiso(undefined, PERMISSIONS.POS)).toBe(false)
    expect(concedePermiso(null, PERMISSIONS.POS)).toBe(false)
  })
})

describe("los conjuntos de permisos", () => {
  it("el administrador los tiene todos", () => {
    for (const permiso of Object.values(PERMISSIONS)) {
      expect(ADMIN_PERMISSIONS).toContain(permiso)
    }
  })

  /*
    Un vendedor que no sabe qué lleva su camión no puede vender desde él,
    así que nace viéndolo.
  */
  it("un vendedor nuevo ve el inventario de su ubicación", () => {
    expect(SELLER_PERMISSIONS).toContain(PERMISSIONS.INVENTORY_OWN)
  })

  it("pero no el de todas las ubicaciones", () => {
    expect(SELLER_PERMISSIONS).not.toContain(PERMISSIONS.INVENTORY_ALL)
  })

  it("ni la configuración", () => {
    expect(SELLER_PERMISSIONS).not.toContain(PERMISSIONS.SETTINGS)
  })

  /*
    Los nombres son los que la migración 0015 escribió en el check de
    permisos_usuario. Cambiarlos aquí sin tocar la base dejaría a la
    aplicación guardando secciones que la base rechaza.
  */
  // 0045: los mismos nombres que acepta permisos_usuario, y nadie los recibe por omisión.
  it("los privilegios de pedidos usan los nombres de la base y no vienen con un vendedor nuevo", () => {
    expect(PERMISSIONS.ORDERS_RESOLVE).toBe("orders-resolve")
    expect(PERMISSIONS.ORDERS_CANCEL).toBe("orders-cancel")
    expect(SELLER_PERMISSIONS).not.toContain(PERMISSIONS.ORDERS_RESOLVE)
    expect(SELLER_PERMISSIONS).not.toContain(PERMISSIONS.ORDERS_CANCEL)
    expect(ADMIN_PERMISSIONS).toEqual(expect.arrayContaining([PERMISSIONS.ORDERS_RESOLVE, PERMISSIONS.ORDERS_CANCEL]))
  })

  it("las liquidaciones: operar incluye consultar, el contador solo puede consultar y nadie las recibe solo", () => {
    expect(PERMISSIONS.SETTLEMENTS_VIEW).toBe("settlements-view")
    expect(PERMISSIONS.SETTLEMENTS_MANAGE).toBe("settlements-manage")
    expect(concedePermiso([PERMISSIONS.SETTLEMENTS_MANAGE], PERMISSIONS.SETTLEMENTS_VIEW)).toBe(true)
    expect(concedePermiso([PERMISSIONS.SETTLEMENTS_VIEW], PERMISSIONS.SETTLEMENTS_MANAGE)).toBe(false)
    expect(SELLER_PERMISSIONS).not.toContain(PERMISSIONS.SETTLEMENTS_VIEW)
    expect(SELLER_PERMISSIONS).not.toContain(PERMISSIONS.SETTLEMENTS_MANAGE)
    expect(CONTADOR_PERMISSIONS).toContain(PERMISSIONS.SETTLEMENTS_VIEW)
    expect(CONTADOR_PERMISSIONS).not.toContain(PERMISSIONS.SETTLEMENTS_MANAGE)
  })

  // 0052: el nombre que acepta permisos_usuario; nadie lo recibe solo y no se le ofrece al contador.
  it("registrar devoluciones usa el nombre de la base, no viene con un vendedor nuevo ni se le ofrece al contador", () => {
    expect(PERMISSIONS.SALES_RETURN).toBe("sales-return")
    expect(SELLER_PERMISSIONS).not.toContain(PERMISSIONS.SALES_RETURN)
    expect(CONTADOR_PERMISSIONS).not.toContain(PERMISSIONS.SALES_RETURN)
    expect(ADMIN_PERMISSIONS).toContain(PERMISSIONS.SALES_RETURN)
  })

  it("los permisos de inventario usan los nombres que la base acepta", () => {
    expect(PERMISSIONS.INVENTORY_OWN).toBe("inventory-own")
    expect(PERMISSIONS.INVENTORY_ALL).toBe("inventory-all")
  })
})
