# Acceso demo y recorrido guiado

Código de verificación: `LEARN-CAP-50768C03`

Recorrido de **5 minutos** para probar el sistema sin ayuda.

La cuenta demo entra a la ferretería que usa el sistema en el día a día. No
son las credenciales de nadie: es un usuario aparte, con permisos
recortados, creado para esto. Pero los datos que verá son los del negocio, y
lo que registre queda guardado.

---

## Credenciales

| Cuenta | Correo | Contraseña | Para qué sirve |
|---|---|---|---|
| Vendedor de mostrador | `demo@oviedoarnold.lat` | `Demo2026` | Ver el sistema con permisos limitados |
| Administrador | `demo-admin@oviedoarnold.lat` | (la que se le asigne) | Ver el sistema completo |

No son credenciales de ningún cliente: son usuarios creados para esto. Las
dos pertenecen a la misma ferretería y no ven los datos de ninguna otra.

---

## Los 4 pasos

### Paso 1 · Ver las credenciales

**URL:** https://www.oviedoarnold.lat/demo

*Qué debe observar:* la cuenta con la que va a entrar. La base ya tiene
**productos, clientes, ventas y cotizaciones** cargados; no hay nada que
preparar.

---

### Paso 2 · Entrar como vendedor

**URL:** https://www.oviedoarnold.lat/login

Entre con `demo@oviedoarnold.lat` / `Demo2026`.

*Qué debe observar:*

- El panel muestra las ventas del día, el **saldo por cobrar** (L 6.365,80)
  y los productos con existencias bajas o agotadas.
- En el menú superior hay **solo cinco secciones**: Dashboard, Facturar,
  Cotizar, Clientes e Historial. **No aparecen Inventario, Proveedores ni
  Configuración**, porque este usuario no las tiene habilitadas.
- **Compruebe el control de acceso:** escriba a mano
  `https://www.oviedoarnold.lat/products` en la barra de direcciones. El
  sistema **no lo deja entrar** y lo devuelve al panel. Ocultar el botón no
  es lo único que hace: cada ruta verifica el permiso.

---

### Paso 3 · Facturar una venta

**URL:** https://www.oviedoarnold.lat/pos

Busque un producto, pulse **«Agregar»** y observe el resumen de la derecha.

*Qué debe observar:*

- El subtotal, el ISV del 15 % y el total se calculan al instante.
- Junto a cada producto, las existencias **bajan** conforme agrega unidades:
  el sistema descuenta lo que ya está en el carrito.
- Intente agregar más unidades de las que hay: aparece un aviso indicando
  cuántas quedan disponibles.
- Puede elegir **Contado** o **Crédito**. Al elegir crédito, el sistema exige
  seleccionar un cliente registrado y una fecha de vencimiento.
- Al pulsar **«Generar factura»** el botón se bloquea y dice «Registrando…».
  Un doble clic no emite dos facturas: cada intento lleva una clave que la
  base rechaza si se repite.

---

### Paso 4 · Registrar un abono

**URL:** https://www.oviedoarnold.lat/sales-history

Busque la factura **FAC-01203** (Constructora Sula) y pulse **«Abonar»**.

*Qué debe observar:*

- La lista distingue las ventas de **Contado** de las de **Crédito**, y marca
  las que están **Pendiente**, **Vencida** o **Cancelada**.
- En las facturas a crédito con saldo aparece **«Abonado»** y **«Resta»**.
  FAC-01203 suma **L 12.594,80**, lleva **L 8.000** abonados y resta
  **L 4.594,80**.
- Al abrir el modal verá el total, lo abonado y el saldo. Pulse **«Pagar el
  saldo completo»** y luego **«Registrar abono»**.
- La factura pasa a **Cancelada**, el botón «Abonar» desaparece y el
  **saldo por cobrar del encabezado baja**.
- Si intenta abonar más que el saldo, el sistema lo rechaza.

---

## Si quiere ver el resto del sistema

Cierre sesión y entre con `demo-admin@oviedoarnold.lat`. Con esa cuenta
aparecen las tres secciones que la de vendedor no tiene:

- **Inventario** — productos con alerta de existencias bajas y agotadas
- **Proveedores** — directorio ligado a los productos
- **Configuración** — usuarios con permisos por sección, y los datos fiscales
  (CAI, rango autorizado y fecha límite de emisión) con aviso cuando el rango
  está por agotarse o venció

---

## Nota sobre dónde viven los datos

Los datos viven en PostgreSQL, no en el navegador: dos cajas abiertas al mismo
tiempo ven el mismo inventario, que es lo que resuelve el
[ADR-1](adr/adr-001-postgresql-multiempresa.md). La contraparte es que la
demostración es compartida: lo que registre queda guardado y lo verá quien
entre después.

Cada ferretería está aislada por `empresa_id` y por las políticas de acceso
de la base, así que una cuenta demo no puede leer los datos de otra empresa
aunque se lo proponga.
