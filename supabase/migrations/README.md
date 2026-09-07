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

## Por qué falta el 0008

Existió y se movió a
[`scripts/limpiar-datos-fiscales-de-muestra.sql`](../../scripts/limpiar-datos-fiscales-de-muestra.sql).

Deshacía la parte fiscal del 0006, así que aplicar la cadena entera dejaba
la base en un estado contradictorio: una migración ponía el CAI de muestra y
la siguiente lo quitaba. No es un paso del esquema sino una decisión del
negocio —el día que la ferretería tenga su CAI real— y por eso vive entre
los scripts y no aquí.

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
