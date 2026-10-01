# Modelo de datos

El esquema real se exporta con
[../scripts/exportar-esquema.sql](../scripts/exportar-esquema.sql), que consulta
el catálogo de PostgreSQL. El volcado no se versiona: queda desactualizado en
cuanto corre una migración, y entonces miente. Si este documento y la base
alguna vez difieren, la que manda es la base.

## Declaraciones

| | |
|---|---|
| Motor | PostgreSQL 17.6 (Supabase) |
| Tablas | **12** |
| Relaciones (llaves foráneas) | **28** |
| Índices | 32 |
| Políticas de acceso | 15, sobre las 12 tablas |
| Tabla con más filas | **`movimientos_inventario`** |
| Vistas | 2, ambas con `security_invoker` |

Todas las tablas tienen llave primaria. Once la tienen sobre `id`;
`permisos_usuario` la tiene compuesta sobre `(usuario_id, seccion)`, porque
lo que identifica un permiso es el par y no un identificador propio: así la
base misma impide asignar dos veces la misma sección al mismo usuario.

Todas tienen además Row Level Security activada. El aislamiento entre
empresas no lo hace el frontend.

## La decisión de modelado: el stock no es una columna

La forma obvia de guardar existencias es una columna `stock` en `productos`
que se suma al comprar y se resta al vender. Aquí no está. El stock es la
suma de `movimientos_inventario`, un libro donde cada entrada, salida o
ajuste queda anotado con su motivo, su fecha y quién lo hizo.

**Por qué.** Con una columna, el día que el conteo físico no cuadra con el
sistema no hay forma de averiguar qué pasó: solo se ve el número actual y
nadie sabe si faltan tres cables porque se vendieron, porque se dañaron,
porque alguien tecleó mal o porque se los llevaron. Con mercadería repartida
entre una bodega, una tienda y dos camiones, el descuadre de inventario no
es hipotético: es rutina. Con el libro se responde "el 12 de agosto salieron
3 por la factura FAC-01203".

Esa es también la razón de que eliminar un producto lo desactive en vez de
borrarlo: las facturas emitidas lo señalan y tienen que seguir mostrando qué
se vendió.

**Qué costó.** Leer el catálogo dejó de ser un `select` sobre una tabla y
pasó a ser una agregación: la vista `productos_con_stock` hace un
`GROUP BY` sobre el libro cada vez. Hoy son 19 movimientos y no se nota. Con
un año de facturación seguida serán decenas de miles, y esa
consulta corre cada vez que se abre el punto de venta, que es justo la
pantalla que no puede tardar.

Está mitigado a medias con `idx_movimientos_producto`, pero el índice ayuda
a encontrar las filas, no evita sumarlas. **Cuando empiece a pesar** la
salida es una vista materializada que se refresca al registrar un
movimiento, o una columna de saldo mantenida por trigger con el libro
siguiendo como respaldo auditable. Se dejó para después a propósito: es una
optimización que no hace falta hasta tener volumen, y adoptarla antes de
tiempo habría agregado complejidad sin nada a cambio.

## Lo que cambió: la existencia pasa a ser por ubicación

La sección de arriba termina diciendo que, cuando la agregación empiece a
pesar, la salida es «una columna de saldo mantenida con el libro siguiendo
como respaldo auditable». Eso es lo que hace la migración 0014, y llegó
antes de lo previsto por una razón distinta a la del volumen: el libro
respondía **cuántos hay**, pero nunca **dónde están**.

LUNACELL opera con una bodega, una tienda y camiones que venden en ruta. Un
camión que no sabe qué lleva no puede vender, y sumar todos los movimientos
daba un solo número para toda la empresa.

**El modelo es híbrido.** Dos tablas con dos trabajos distintos:

| | Qué es | Quién la escribe |
|---|---|---|
| `inventario_ubicacion` | la existencia operativa, autoritativa | solo funciones del motor |
| `movimientos_inventario` | el Kardex: cómo se llegó a esa existencia | las mismas |

El total de la empresa **no se guarda en ninguna parte**: es la suma de las
celdas. Una columna con el total se desincroniza el día que alguien escriba
en una sin tocar la otra, y entonces hay dos respuestas para la misma
pregunta.

**La celda no puede ser negativa.** `cantidad integer not null check
(cantidad >= 0)` es lo que vuelve imposible vender lo que no hay, pase lo
que pase por encima: aunque una función se escriba mal, la fila no entra.
No resuelve la concurrencia —dos ventas simultáneas siguen necesitando un
candado— pero garantiza que el resultado nunca quede por debajo de cero.

**El navegador no escribe existencias.** La política de RLS es solo de
lectura y además se le revocan `insert`, `update` y `delete`. Se comprobó
que sin revocar, un `update` del cliente no falla: no encuentra filas y
devuelve éxito con cero cambios, que parece haber funcionado. Las funciones
`SECURITY DEFINER` que escribirán el inventario no se ven afectadas porque
corren como su dueño.

### La apertura, y por qué no dejó rastro en el Kardex

El stock que existía —20 unidades entre dos productos— se pasó a celdas
comprobando que la suma coincidiera exactamente con la de los movimientos.
Si no hubiera cuadrado, la migración se deshace: una que descuadra el
inventario en silencio es peor que una que falla.

**La apertura no escribe ningún movimiento**, y esa decisión es deliberada.
`productos_con_stock` y `stock_actual` suman **todos** los movimientos sin
mirar el tipo, así que un movimiento de apertura de +10 habría hecho que el
panel, el inventario y el punto de venta mostraran 20 al instante. El
Kardex de lo heredado son los movimientos que ya estaban; la apertura es el
punto de partida del modelo nuevo, no un movimiento más.

### La historia no se reescribió

`movimientos_inventario.ubicacion_id` y `ventas.ubicacion_id` son
**nullable**, y van a seguir siéndolo mientras existan filas de antes.

Los movimientos y las ventas anteriores a este corte ocurrieron cuando el
sistema no relacionaba el inventario con las ubicaciones, así que nadie
anotó dónde. Ponerlos todos en la bodega sería inventar historia: la
apertura decide dónde está el stock **hoy**, que es un hecho comprobable
mirando, pero no dice dónde ocurrió una venta de septiembre.

Son dos cosas distintas y se tratan distinto: el estado actual se fija, el
pasado se deja como estaba.

### La transición, hasta que llegue el motor de venta

Mientras el punto de venta siga siendo el de hoy hay dos representaciones
del mismo número, y conviven a propósito:

| | Qué lee | De dónde sale |
|---|---|---|
| **Ahora** | el catálogo, con un número por producto | `productos_con_stock`, que suma el libro |
| **Después del motor de venta** | la existencia de su ubicación | `inventario_ubicacion` |

No se cambió a medias. El frontend **no se tocó** en esta migración, así
que no hay dos fuentes contradiciéndose: hay una en uso y otra esperando.
Cambiar de una a otra es un solo punto,
[`existenciaEnCatalogo`](../src/utils/existencias.js), que ya se escribió
como costura para esto.

Mientras las dos existan, la comprobación de que no se han separado es que
`sum(inventario_ubicacion.cantidad)` siga siendo igual a
`sum(movimientos_inventario.cantidad)` por producto. Dejará de serlo en
cuanto el motor nuevo escriba solo en las celdas, y ahí es donde el libro
pasa a ser lo que se quería que fuera: el relato, no la fuente.

## La otra cara: lo que sí se duplica

Un documento emitido guarda copia de datos que ya viven en otra tabla, y eso
es deliberado:

- `detalle_venta` y `detalle_cotizacion` guardan `nombre` y `codigo` del
  producto, no solo `producto_id`.
- `ventas` guarda `nombre_cliente` y `rtn_comprador`, no solo `cliente_id`.
- `ventas` guarda `cai_emision`, `rango_desde_emision`, `rango_hasta_emision`
  y `fecha_limite_emision_emision`, copiados de `empresas` al emitir.

Normalizado del todo, corregir el nombre de un producto reescribiría todas
las facturas donde aparece, y renovar el CAI cambiaría el de las ya
emitidas. Una factura es constancia de lo que ocurrió ese día: tiene que
seguir diciendo lo mismo aunque el catálogo cambie después.

El costo de duplicar es el de siempre: si alguien corrige un nombre mal
escrito, las facturas viejas conservan el equivocado. Es el resultado
correcto, aunque a primera vista parezca un error de sincronización.

Por eso las llaves foráneas de los documentos hacia el catálogo son
`on delete set null` y no `cascade`: borrar un cliente no puede llevarse sus
facturas por delante. Hacia `empresas` sí son `cascade`, porque si se da de
baja una empresa no queda nada suyo que conservar.
