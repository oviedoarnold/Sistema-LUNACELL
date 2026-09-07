# Modelo de datos

El esquema real está exportado en [db-export.json](db-export.json), generado
con [../scripts/exportar-esquema.sql](../scripts/exportar-esquema.sql)
consultando el catálogo de PostgreSQL. Si este documento y ese archivo
alguna vez difieren, el que manda es el archivo.

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
ferreterías no lo hace el frontend.

## La decisión de modelado: el stock no es una columna

La forma obvia de guardar existencias es una columna `stock` en `productos`
que se suma al comprar y se resta al vender. Aquí no está. El stock es la
suma de `movimientos_inventario`, un libro donde cada entrada, salida o
ajuste queda anotado con su motivo, su fecha y quién lo hizo.

**Por qué.** Con una columna, el día que el conteo físico no cuadra con el
sistema no hay forma de averiguar qué pasó: solo se ve el número actual y
nadie sabe si faltan tres martillos porque se vendieron, porque se
quebraron, porque alguien tecleó mal o porque se los llevaron. En una
ferretería el descuadre de inventario no es hipotético, es rutina. Con el
libro se responde "el 12 de agosto salieron 3 por la factura FAC-01203".

Esa es también la razón de que eliminar un producto lo desactive en vez de
borrarlo: las facturas emitidas lo señalan y tienen que seguir mostrando qué
se vendió.

**Qué costó.** Leer el catálogo dejó de ser un `select` sobre una tabla y
pasó a ser una agregación: la vista `productos_con_stock` hace un
`GROUP BY` sobre el libro cada vez. Hoy son 19 movimientos y no se nota. Con
una ferretería facturando un año seguido serán decenas de miles, y esa
consulta corre cada vez que se abre el punto de venta, que es justo la
pantalla que no puede tardar.

Está mitigado a medias con `idx_movimientos_producto`, pero el índice ayuda
a encontrar las filas, no evita sumarlas. **Cuando empiece a pesar** la
salida es una vista materializada que se refresca al registrar un
movimiento, o una columna de saldo mantenida por trigger con el libro
siguiendo como respaldo auditable. Se dejó para después a propósito: es una
optimización que no hace falta hasta tener volumen, y adoptarla antes de
tiempo habría agregado complejidad sin nada a cambio.

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
baja una ferretería no queda nada suyo que conservar.
