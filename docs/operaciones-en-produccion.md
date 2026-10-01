# Operaciones sobre los datos de producción

Este archivo registra los cambios hechos **a mano sobre los datos reales**
del cliente: los que no son una migración de esquema y por tanto no dejan
rastro en `supabase/migrations/`.

Existe porque esos cambios son los únicos del sistema que no se pueden
revisar leyendo el código. Una migración se lee, se prueba y se vuelve a
correr; borrar una fila de la base del cliente ocurre una vez y, si nadie
lo anota, la única prueba de que pasó es que el dato ya no está.

Cada entrada lleva la autorización, la evidencia de antes, lo que se
ejecutó y la evidencia de después. Sin las cuatro cosas no es un registro,
es un recuerdo.

---

## 2026-10-01 · Eliminar la ubicación de prueba «Caminio 03»

**Autorización:** del propietario, decisión D6 de la auditoría de INV-2,
aprobada de forma expresa y por escrito.

**Qué era.** Una ubicación creada el 2026-09-08 únicamente para probar la
pantalla de ubicaciones, con el nombre mal escrito —«Caminio» por
«Camión»— y desactivada desde entonces. Las ubicaciones reales de LUNACELL
son cuatro: `Lunacell Bodega`, `Lunacell Store`, `Camión 01` y
`Camión 02`.

**Por qué se borra en vez de dejarla desactivada.** La regla del sistema es
que una ubicación no se borra, se desactiva, porque su historial tiene que
seguir teniendo sentido. Aquí no hay historial: no movió una sola unidad.
Lo que la regla protege no existe en este caso, y lo que queda es un
nombre con una falta de ortografía en una lista que el administrador va a
leer cada vez que asigne una ubicación.

### Evidencia de antes

```
id                                    bd40a6af-d264-4233-bb8e-2b3d43b208a2
tipo / activa                         camion / activa=false
celdas en inventario_ubicacion        0
filas en movimientos_inventario       0
filas en ventas                       0
usuarios que la referencian           0  (la columna aún no existía)
FKs que apuntan a ubicaciones         3  (inventario_ubicacion,
                                          movimientos_inventario, ventas)
ubicaciones totales                   5
```

Las tres FK que existen hacia `ubicaciones` son las únicas del esquema, y
las tres dieron cero. No quedaba ninguna otra vía de referencia.

### Lo que se ejecutó

Un solo `delete` con las condiciones dentro de la propia sentencia, para
que la comprobación y el borrado no pudieran separarse en el tiempo. Si
cualquiera de ellas hubiera dejado de cumplirse entre la verificación y la
ejecución, el `delete` no habría tocado ninguna fila:

```sql
with huerfana as (
  select u.id
    from ubicaciones u
   where u.nombre = 'Caminio 03'
     and u.activa = false
     and not exists (select 1 from inventario_ubicacion i where i.ubicacion_id = u.id)
     and not exists (select 1 from movimientos_inventario m where m.ubicacion_id = u.id)
     and not exists (select 1 from ventas v where v.ubicacion_id = u.id)
)
delete from ubicaciones where id in (select id from huerfana)
returning id, nombre, tipo, activa;
```

Devolvió exactamente una fila: `Caminio 03 / camion / false`.

**No se metió en la migración 0015.** Una migración se corre en toda
instalación del sistema, y en cualquier otra «Caminio 03» no existe: sería
una sentencia que no hace nada y que además mezcla un arreglo de datos de
un cliente con un cambio de esquema de todos. Son dos cosas y se deshacen
por separado.

### Evidencia de después

```
existe Caminio 03                     false
ubicaciones totales                   4
listado                               Camión 01[camion,activa]
                                      Camión 02[camion,activa]
                                      Lunacell Bodega[bodega,activa]
                                      Lunacell Store[tienda,activa]

productos                             2        (sin cambio)
movimientos_inventario                12       (sin cambio)
ventas                                8        (sin cambio)
pagos                                 0        (sin cambio)
celdas de inventario                  2 celdas, 20 unidades  (sin cambio)
stock por producto                    Cargador=10, Cubo Iphone=10
inventario por ubicación              Cargador@Lunacell Bodega=10
                                      Cubo Iphone@Lunacell Bodega=10
```

Las cuatro ubicaciones que quedan son las reales y están todas activas.
Ningún otro dato cambió.
