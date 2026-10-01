# ADR-3: La visibilidad del inventario se decide por ubicación, y es un eje aparte

- **Fecha:** 2026-10-01
- **Estado:** Aceptada e implementada
- **Ruta:** `docs/adr/adr-003-visibilidad-de-inventario-por-ubicacion.md`
- **Migración:** `0015_visibilidad_por_ubicacion.sql`

## Contexto

La migración `0014` hizo que la existencia se guardara por producto y
ubicación, pero dejó la lectura como la del resto del esquema: **todo lo de
mi empresa**. Con una sola bodega eso era correcto. LUNACELL opera con una
bodega, una tienda y dos camiones que venden en ruta, y ahí deja de serlo:
el vendedor del Camión 01 no tiene por qué saber qué lleva el Camión 02.

Al diseñarlo apareció que lo que se llamaba «permisos de inventario» eran
en realidad **tres preguntas distintas**, y que juntarlas en una produce
los permisos que nadie entiende:

| | Pregunta |
|---|---|
| ubicación operativa | ¿desde dónde trabajo? |
| visibilidad | ¿qué puedo consultar? |
| operación | ¿desde dónde puedo mover existencia? |

El sistema anterior a la `0015` no contestaba ninguna: `usuarios` no tenía
ninguna relación con `ubicaciones`, y `ubicaciones` era una isla.

Se consideraron dos modelos de visibilidad:

| Opción | A favor | En contra |
|---|---|---|
| Tabla `usuario ↔ ubicaciones visibles` | Expresa «estas tres sí, esta no» | Tabla nueva, su RLS, su UI de casillas y su mantenimiento |
| **Dos permisos en `permisos_usuario`** | Reutiliza lo que existe, sin tabla nueva | No distingue «algunas de las otras» |

## Decisión

### 1. La ubicación operativa es una columna del usuario

`usuarios.ubicacion_id`, **nullable**, con llave foránea compuesta
`(ubicacion_id, empresa_id) → ubicaciones (id, empresa_id)`.

Columna y no tabla porque es **un** valor por usuario, igual que `rol`. Es
nullable por dos razones concretas: el dueño puede legítimamente no operar
desde un sitio fijo, y obligar a un valor forzaría a inventarle uno.

La empresa va dentro de la llave, como en la `0012` y la `0014`: sin el
par, un administrador podría asignarle a su vendedor el camión de otra
empresa, y la seguridad a nivel de fila no lo impediría, porque quien
escribe puede ser una función `SECURITY DEFINER` que pasa por encima.

Dos disparadores garantizan que esa ubicación esté activa —un `check` no
puede mirar otra tabla—: uno impide asignar una ya inactiva, y el otro
impide desactivar una que alguien tenga asignada.

### 2. La visibilidad son dos permisos, no una lista

Se añaden dos secciones a `permisos_usuario`, que ya existía:

| Permiso | Qué concede |
|---|---|
| `inventory-own` | ver el inventario de **su** ubicación operativa |
| `inventory-all` | ver el inventario de **todas** las ubicaciones activas de su empresa |

Son dos y no uno porque son dos concesiones distintas. «Ver lo mío» lo
necesita cualquiera que venda; «ver todo» es una decisión aparte del
administrador. Con un permiso único habría que elegir entre no ver nada o
verlo todo.

Sin ninguno de los dos: **ninguna existencia**. Y con `inventory-own` pero
sin ubicación asignada, tampoco: «mi ubicación» no existe todavía, y
mostrarlo todo convertiría un dato sin rellenar en un permiso.

### 3. El administrador tiene visibilidad global

`usuario_tiene_permiso()` devuelve verdadero para el administrador sin que
nadie le reparta filas, igual que ya hacía `hasPermission()` en el
frontend. Ve las cuatro ubicaciones activas de **su** empresa.

### 4. La ubicación operativa no limita al administrador

Son dos columnas distintas en dos tablas distintas, y se consultan por
separado. Un administrador cuya ubicación operativa sea el Camión 01 sigue
consultando las cuatro; su ubicación operativa sigue siendo el Camión 01.

Confundirlos dejaría al dueño viendo solo el camión desde el que resulta
que está trabajando esa mañana.

### 5. La visibilidad no concede operación

**Ver el inventario del Camión 02 no es poder vender desde el Camión 02.**

Hoy esto es gratis de garantizar, porque no existe ninguna operación que
mueva existencia por ubicación: el punto de venta sigue descontando del
total de la empresa. Cuando exista, la autorización para operar será su
propia pregunta y su propia comprobación, no un efecto secundario de poder
mirar.

### 6. La visibilidad no concede escritura directa

La política sigue siendo `for select`, y los `revoke` de `insert`, `update`
y `delete` que puso la `0014` sobre `inventario_ubicacion` no se tocan.
Ninguno de los dos permisos concede escritura porque **no hay ninguna
escritura que conceder** desde el navegador: la existencia la escribirán
funciones `SECURITY DEFINER`.

Se comprobó en la `0014` que revocar no es redundante: sin el `revoke`, un
`update` del cliente no falla —no encuentra filas y devuelve éxito con
cero cambios—, que es la peor respuesta posible.

### 7. El aislamiento por empresa no se relaja

`usuario_ve_ubicacion()` comprueba `u.empresa_id = empresa_del_usuario()`
dentro de la propia función, y no delega en la política de `ubicaciones`,
porque es `SECURITY DEFINER` y pasa por encima de la seguridad a nivel de
fila: tiene que poner el límite ella misma.

La empresa nunca llega desde el navegador. Se resuelve en el motor contra
`auth.uid()`, como en todo el esquema desde el ADR-1.

### 8. El cero y lo prohibido se representan distinto

La `0014` guarda el cero como **ausencia de celda**. Eso obliga a una
decisión explícita en la consulta, porque dos situaciones distintas no
tienen fila:

| | Qué es | Cómo se representa |
|---|---|---|
| **A** | ubicación visible que no tiene ese producto | `cantidad = 0` |
| **B** | ubicación que el usuario no puede consultar | **no aparece** |

La vista `existencias_por_ubicacion` parte de las **ubicaciones** y no de
las celdas, y filtra la visibilidad **antes** de unirlas. Así el `left
join` produce el cero del caso A, y el caso B no llega a la unión.

El filtro sobre `ubicaciones` es imprescindible y no basta con la política
de `inventario_ubicacion`: con `security_invoker = on`, una celda oculta
hace que el `left join` devuelva `null` y el `coalesce` lo convierta en
`0`. Se comprobó quitándolo: la vista pasó a mostrar `Bodega=0`,
`Camión 02=0` y `Store=0` a un vendedor que solo debía ver su camión,
cuando en la bodega había quince unidades y en el otro camión doce. Además
de mentir, delataba que esas ubicaciones existen.

## Consecuencias

**La política de `inventario_ubicacion` se estrechó.** Antes cualquiera de
la empresa veía las celdas de todas las ubicaciones; ahora solo las
visibles. Cuando se aplicó no afectaba a nadie —el único usuario era
administrador— pero afecta al primer vendedor que se cree.

**El motor empieza a saber de permisos.** `usuario_tiene_permiso()` es la
primera vez que la base consulta `permisos_usuario` para decidir acceso a
datos. Hasta la `0015`, el reparto por secciones vivía solo en el frontend
—es lo que decidió el ADR-2— así que saltárselo daba acceso a todo lo de la
empresa. Que las dos reglas digan lo mismo es lo que hace que saltarse el
frontend no sirva de nada, y pasa a ser una obligación de mantenimiento:
cambiar una obliga a cambiar la otra.

**No se guarda una lista de ubicaciones visibles por usuario, todavía.**
Con cuatro ubicaciones, «las otras tres» y «algunas de las otras tres»
casi siempre coinciden, así que la tabla costaría su RLS, su interfaz de
casillas y su mantenimiento a cambio de una distinción que nadie ha
pedido. Si llega a hacer falta, se añade **dentro de
`usuario_ve_ubicacion()`** sin cambiar la forma de la política ni de la
vista. La decisión es reversible en ese sentido y no en el contrario:
retirar una tabla ya poblada es otra cosa.

**`usuario_ve_ubicacion()` no filtra por `activa`, a propósito.** Una
ubicación desactivada que conserve existencia tiene que poder consultarse,
o unidades que nadie movió desaparecen. El filtro de `activa` vive en la
vista, que sirve a la operación del día: la función contesta «¿puedes
verla?» y la vista «¿se opera con ella hoy?».

**La vista no expone costo, margen, utilidad ni precio.** Saber cuántas
unidades lleva un camión no es saber cuánto costaron. Esto no resuelve el
problema de fondo —el costo sigue sin protección propia en
`productos_con_stock`, que es `security_invoker` sobre una política sin
filtro de administrador— y conviene no leerlo como resuelto.

## Qué queda pendiente, y de quién

**`SELLER_PERMISSIONS` se cambiará en INV-2.3**, no aquí. Que un vendedor
nuevo reciba `inventory-own` por omisión está aprobado, pero añadir los
permisos al catálogo del frontend hace crecer `ADMIN_PERMISSIONS`, y
guardar un administrador escribiría esas secciones. Si el frontend se
desplegara antes de que la `0015` exista en producción, eso choca contra la
restricción y rompe Configuración. Va con la interfaz que lo consume, donde
el orden se puede garantizar.

**INV-3 conectará la ubicación operativa con las ventas**, los movimientos
de inventario y el descuento real de existencia. Las columnas
`ventas.ubicacion_id` y `movimientos_inventario.ubicacion_id` ya existen
desde la `0014`, nullable y vacías, esperando ese momento. Esta decisión no
dice cómo será ese flujo.

## Qué se sacrificó

Se sacrificó la **granularidad** de poder elegir ubicaciones visibles una
por una. Con cuatro ubicaciones es un sacrificio pequeño, y se aceptó
porque la alternativa pedía una tabla, su seguridad y su interfaz antes de
que nadie hubiera necesitado la distinción. El camino para añadirla queda
abierto en un solo punto.

Se sacrificó también tener **la misma regla escrita en dos sitios** —el
motor y el frontend—, que es exactamente lo que el ADR-2 evitaba al dejar
el reparto solo en el cliente. Se aceptó porque la alternativa era que la
única defensa del inventario siguiera siendo el navegador, y el navegador
lo controla quien lo abre.
