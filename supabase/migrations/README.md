# Migraciones

Se corren en orden numérico desde el SQL Editor de Supabase. Todas son
idempotentes: volver a correr una no falla ni duplica nada, así que ante la
duda de si ya se aplicó, correrla de nuevo es seguro.

| # | Qué hace |
|---|---|
| 0001 | Esquema completo: doce tablas con `empresa_id`, políticas de acceso por fila, y el trigger que vincula a un usuario invitado cuando se registra |
| 0002 | Datos de demostración. No hace nada si ya estaban cargados |
| 0003 | Corrige que un empleado viera los permisos de toda la empresa y no solo los suyos |
| 0004 | Recrea las vistas con `security_invoker`, sin el cual devolvían filas de todas las ferreterías |
| 0005 | `siguiente_correlativo()`, que entrega el número de factura tomando el candado de la fila |
| 0006 | Cuenta de administración para la demostración y datos fiscales de muestra |
| 0007 | Imagen del producto: columna, bucket de almacenamiento y sus políticas |
| 0009 | Claves de idempotencia en ventas, cotizaciones y abonos |
| 0010 | Permisos de la cuenta demo, según el recorrido guiado |
| 0011 | Ubicaciones: bodegas, tiendas y camiones como puntos de inventario, y la sección nueva en los permisos |

## Instalación en una base vacía

No todas se corren. Las 0002, 0006 y 0010 cargan la ferretería de
demostración —su empresa, sus ocho productos, sus ventas y las cuentas
invitadas de aquel proyecto— y no tienen nada que hacer en una base de
LUNACELL.

| # | En una base nueva de LUNACELL |
|---|---|
| 0001 | **Correr.** Estructura completa: las doce tablas, las funciones `empresa_del_usuario()` y `usuario_es_admin()`, el disparador sobre `auth.users` y las políticas |
| 0002 | **Omitir.** Ferretería El Yunque, sus productos, ventas y cuentas invitadas |
| 0003 | **Correr.** Corrige la política de `permisos_usuario` |
| 0004 | **Correr.** Recrea las vistas con `security_invoker` |
| 0005 | **Correr.** `siguiente_correlativo()`. Sus dos `update` finales no afectan a nadie con la base vacía |
| 0006 | **Omitir.** Cuenta demo y un CAI de muestra que el SAR no emitió |
| 0007 | **Correr.** Imagen del producto y su bucket |
| 0009 | **Correr.** Claves de idempotencia |
| 0010 | **Omitir.** Permisos de la cuenta demo |
| 0011 | **Correr.** Ubicaciones |

Ninguna de las que se corren borra datos: solo la 0010 tiene un `delete`,
y es de las que se omiten. Lo que sí hacen varias es recrear vistas y
políticas, que es cómo se corrigen a sí mismas.

Después de la estructura hace falta el arranque de la instalación —la
empresa y su administrador—, que no es una migración y vive en
[`scripts/crear-empresa-y-administrador.sql`](../../scripts/crear-empresa-y-administrador.sql).

### La 0001 no se puede repetir

Al contrario que las demás, crea sus políticas en un bucle sin
`drop policy if exists`, así que correrla dos veces falla con "policy
already exists". No es un problema al instalar —se corre una vez sobre una
base vacía— pero conviene saberlo antes de repetirla por costumbre.

## Por qué falta el 0008

Existió y se convirtió en un script fuera de las migraciones.

Deshacía la parte fiscal del 0006, así que aplicar la cadena entera dejaba
la base en un estado contradictorio: una migración ponía el CAI de muestra y
la siguiente lo quitaba. No era un paso del esquema sino una decisión del
negocio, y por eso salió de aquí.

Ese script se eliminó al migrar a LUNACELL: lo único que hacía era limpiar el
CAI de muestra de la empresa de demostración, que en esta base nunca existió.

El número no se reutiliza: renumerar migraciones ya aplicadas rompe el
registro de cuáles se corrieron.

## Sobre los datos fiscales de muestra

La ferretería de ejemplo lleva un CAI inventado, y con él las facturas salen
con la numeración autorizada (`000-001-01-00001209`) en vez de la interna
(`FAC-01209`). Eso es intencional para la demostración: enseña la numeración
fiscal funcionando.

**Ese CAI no lo emitió el SAR.** Antes de facturar de verdad hay que correr
el script de limpieza y cargar el CAI real desde Configuración. Mientras no
haya uno, dejar los campos fiscales vacíos hace que el sistema use la
numeración interna, que no pretende ser un documento fiscal.
