# ADR-1: PostgreSQL multi-empresa con seguridad a nivel de fila

- **Fecha:** 2026-08-28
- **Estado:** Aceptada
- **Ruta:** `docs/adr/adr-001-postgresql-multiempresa.md`

## Contexto

El sistema nació para una sola ferretería y guarda todo en `localStorage`: productos,
clientes, ventas, cotizaciones y hasta los usuarios con sus permisos. Eso funcionó
para llegar a un producto usable, pero tiene tres consecuencias que ya nos alcanzaron:

1. **El portal privado no es privado.** Todos los datos viajan al navegador. Cualquiera
   abre las herramientas de desarrollo y los lee sin iniciar sesión, y también puede
   editarse los permisos.
2. **No hay forma de tener un segundo cliente.** El sistema asume una sola ferretería
   en todo el modelo de datos.
3. **Las contraseñas no están protegidas.** La función de hash es el `hashCode` de
   Java: 32 bits, trivial de colisionar. Sirve para una demo, no para guardar
   credenciales de empleados de un cliente real.

El producto se va a comercializar, así que la decisión no es solo académica.

Se evaluaron tres opciones:

| Opción | A favor | En contra |
|---|---|---|
| Seguir con `localStorage` | Cero trabajo, funciona sin Internet | Ninguno de los tres problemas se resuelve |
| SQL Server con backend propio | Control total del backend | Hosting con fricción, *row-level security* costoso de armar, más código que mantener |
| **PostgreSQL vía Supabase** | RLS nativo, autenticación con hashing serio, API JSON automática, HTTPS incluido | Dependencia de un proveedor |

## Decisión

Migrar a **PostgreSQL gestionado por Supabase**, con **`empresa_id` en todas las
tablas desde la primera migración** y políticas de *row-level security* que filtren
por esa columna.

La autenticación pasa a Supabase Auth. Los roles y permisos por sección se conservan
en tablas propias ligadas a `auth.users`, porque son lógica del negocio y no del
proveedor de identidad.

El inventario deja de ser un número mutable y pasa a ser un **libro de movimientos**:
cada entrada, salida, ajuste y devolución queda registrada, y el stock actual es la
suma.

## Consecuencias

**A favor**

- El portal privado se vuelve realmente privado: los datos no salen de la base sin
  una sesión válida, y la política se aplica en el motor, no en el frontend.
- Vender a una segunda ferretería deja de requerir un despliegue aparte.
- Las contraseñas quedan protegidas con hashing real, con recuperación y
  verificación por correo incluidas.
- El inventario se puede auditar: si el conteo físico no cuadra, hay rastro de
  quién lo movió y cuándo.
- Aparece un endpoint de salud en JSON, que el requisito 2 pide y hoy no existe.

**En contra**

- Dependencia de Supabase. Se mitiga en que por debajo es PostgreSQL estándar: los
  datos se exportan e importan a cualquier otro PostgreSQL. Lo único realmente atado
  es la autenticación, y aun eso es migrable.
- El frontend deja de ser síncrono. Los cuatro contextos pasan de leer `localStorage`
  al instante a esperar respuestas de red, con estados de carga y de error que hoy
  no existen.
- **Se pierde el funcionamiento sin Internet si no se hace nada más.** Hoy la
  aplicación funciona desconectada por accidente. Para una ferretería, que se caiga
  el Internet no puede significar que no se pueda cobrar.

## Qué se sacrificó, y por qué valió la pena para el cliente

**Se sacrificó el acceso síncrono a los datos.** Leer el inventario era una
lectura de `localStorage` que devolvía el arreglo en el mismo ciclo de
renderizado. Pasa a ser una consulta HTTP asíncrona contra la API REST que
PostgREST expone sobre PostgreSQL, sujeta a latencia de red y a fallos
parciales. Los cuatro contextos de React —productos, clientes, ventas y
cotizaciones— hay que reescribirlos con estados de carga y de error, y cada
mutación deja de ser una asignación para volverse un `INSERT` o un `UPDATE`
que puede violar una restricción de integridad y devolver un código de error
que la pantalla tiene que traducir. Eso encarece cada funcionalidad futura.

Valió la pena porque lo que se compra a cambio es **lo que hace vendible el
producto**:

- **Aislamiento entre clientes.** `empresa_id` en las doce tablas y políticas
  de *row-level security* que filtran por `empresa_del_usuario()`. La regla se
  evalúa en el motor, no en el frontend: sin un JWT válido, PostgREST no
  devuelve una sola fila. Las dos vistas llevan `security_invoker = on`, porque
  por omisión una vista corre con los permisos de quien la creó y habría
  devuelto los productos de todas las ferreterías.
- **Contraseñas protegidas.** El hash era el `hashCode` de Java, 32 bits,
  calculado en el navegador y guardado junto a los datos que protegía. Pasa a
  GoTrue, el servicio de autenticación de Supabase, que las hashea en el
  servidor y emite sesiones con JWT y refresco de token.
- **Inventario auditable.** El stock deja de ser una columna mutable y pasa a
  ser la suma de `movimientos_inventario`, un *ledger* append-only con
  índice por producto y fecha. Cuando el conteo físico no cuadra, hay a quién
  y a cuándo señalar.
- **Numeración fiscal correcta.** El correlativo lo entrega una función
  `security definer` que toma el candado de la fila de la empresa, así que dos
  cajas concurrentes no pueden leer el mismo número. Con el cálculo en el
  navegador, la restricción `unique (empresa_id, numero_factura)` habría
  rechazado la segunda factura, y el SAR exige una secuencia continua.

Un sistema que guarda todo en el navegador se puede demostrar, pero no se le
puede cobrar a una ferretería que le confía sus números y los datos de sus
clientes.

Para no sacrificar además el trabajo sin conexión —que en Honduras no es un lujo—
`localStorage` **no se elimina**: se convierte en caché con cola de sincronización.
El mostrador sigue vendiendo desconectado y sincroniza al volver la señal. Esa
decisión se toma ahora y no después, porque reconvertir una aplicación que asume
servidor siempre disponible en una que tolera estar desconectada es de las
reescrituras más caras que existen.

## Seguimiento — 2026-09-03

La migración se completó: catálogos, ventas, abonos y cotizaciones viven en
PostgreSQL, `empresa_id` está en las doce tablas, las políticas de fila se
aplican en el motor y el inventario es el libro de movimientos que se
describió arriba.

**Lo que no se cumplió de este ADR es la última parte.** `localStorage` no se
convirtió en caché con cola de sincronización: se eliminó. Hoy la aplicación
necesita conexión para todo lo que no sea abrir la pantalla, y una ferretería
con Internet inestable lo va a sentir en la caja.

Se deja anotado aquí y no se corrige el texto de arriba a propósito: el ADR
registra lo que se decidió el 28 de agosto, y lo que pasó después es
información distinta. La decisión de posponer la cola de sincronización se
tomó por tiempo, no porque el argumento original —que reconvertir después es
de las reescrituras más caras— haya dejado de ser válido. Sigue siendo
válido, y el costo de haberla pospuesto lo pagará quien la implemente.

El estado real del funcionamiento sin conexión está documentado en
[../pwa.md](../pwa.md).
