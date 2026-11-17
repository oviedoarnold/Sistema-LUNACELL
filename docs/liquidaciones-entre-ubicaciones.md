# Caja por ubicación y liquidaciones entre ubicaciones (pedidos, etapa B)

Migración `0046_liquidaciones_entre_ubicaciones.sql`. Pantalla `/liquidaciones`. Reportes `reporte_diario_de_caja()` y `reporte_medios_de_caja()`.

## Las cuatro ubicaciones de un pedido

| Papel | Dónde se guarda |
|---|---|
| Origen (entrega la mercadería) | `pedidos_ubicacion.origen_id` y el movimiento `entrega_pedido` |
| La que factura | `pedidos_ubicacion.destino_id` y `ventas.ubicacion_id` de la factura |
| La que recibió el dinero | `cobros_por_medio.ubicacion_id` del cobro del pedido (0045), con la fecha, el medio, la tasa y el cargo reales |
| La liquidación interna | `liquidaciones_ubicacion` (quien entrega el efectivo → quien lo recibe) y su reparto por pedido en `liquidacion_detalle` |

El cobro se guarda una sola vez (0045). La 0046 no lo duplica ni lo cambia.

## Decisiones del propietario (2026-11-16)

- **Cuenta única.** Transferencia, tarjeta y enlace de pago llegan a la cuenta de la empresa. Solo el efectivo se liquida entre ubicaciones; lo electrónico aparece como «en cuenta de la empresa».
- **El 1.70 %** es el cargo por usar tarjeta o enlace. Va con ese pago a la cuenta de la empresa y nunca forma parte de una liquidación. No hay comisión por venta.
- **Dos pasos.** Quien entrega el efectivo registra la entrega; la ubicación que lo recibe confirma o rechaza.
- **Desde el cobro.** El efectivo cobrado para otra ubicación queda por liquidar desde ese momento, aunque la factura siga pendiente.

## Saldos por pedido

- `efectivo`: suma de los cobros en efectivo del pedido.
- `por_confirmar`: lo entregado que aún no se confirma.
- `liquidado`: lo confirmado.
- `pendiente = efectivo − por_confirmar − liquidado`. Una entrega rechazada deja de restar.

Desde la 0048 (etapa C1), el efectivo se le debe al **destino final** del pedido:

- un pedido enviado a otra ubicación pasa al par nuevo (origen → ubicación nueva);
- un pedido facturado en su origen no aparece: cobró y factura la misma ubicación;
- un pedido por resolver tampoco: mientras no se sepa quién lo factura, su efectivo no se liquida;
- un pedido con efectivo en una liquidación por confirmar o confirmada no se rechaza ni cambia de ubicación (`PI013`).

Estados que muestra la pantalla:

| Estado | Cuándo |
|---|---|
| Pendiente | No se ha entregado nada |
| Parcialmente liquidado | Hay algo confirmado y falta |
| Pendiente de confirmación | Hay una entrega sin confirmar |
| Liquidado | Todo el efectivo está confirmado |
| En cuenta de la empresa | El pedido no tiene efectivo |

## Funciones

| Función | Quién | Qué hace |
|---|---|---|
| `registrar_liquidacion(origen, destino, monto, método, fecha, referencia, observación, pedido, clave)` | `settlements-manage` en la ubicación de origen, o el administrador | Registra la entrega (`por_confirmar`). Si se indica un pedido, sale solo de ese; si no, se reparte del pedido más antiguo al más reciente. |
| `resolver_liquidacion(id, confirmar, motivo)` | `settlements-manage` en la ubicación que recibe, o el administrador | Confirma, o rechaza con motivo de al menos 5 caracteres. |
| `control_de_liquidaciones(origen, destino)` | `settlements-view` o `settlements-manage` (ubicaciones propias); administrador y contador ven todo | Saldos por par, pedidos con sus medios, e historial. |
| `reporte_diario_de_caja`, `reporte_medios_de_caja` | Administrador | Los reportes de siempre con la caja corregida para pedidos. |

Reglas de registro:

- El monto debe ser mayor que cero, con hasta dos decimales, y no mayor que lo pendiente (`LQ002`).
- La fecha efectiva no puede ser futura.
- Los métodos son `entrega_en_efectivo` y `deposito_a_cuenta`.

Concurrencia:

- **Clave obligatoria.** La misma clave con los mismos datos devuelve la misma liquidación (`repetida: true`). Con otros datos, `LQ003`.
- **Mismo par.** Dos registros del mismo par se ejecutan en fila (candado consultivo), así que el saldo no se gasta dos veces.
- **Confirmar y rechazar a la vez.** La primera operación bloquea la fila; la segunda ve el resultado. Si coincide con lo que pedía, se repite; si no, `LQ004`.

Una liquidación **no** es venta, cobro, abono ni ingreso. No toca facturas, cuentas por cobrar, cajas ni inventario.

Auditoría:

- Las tablas solo se escriben desde las funciones.
- Una liquidación solo puede pasar de `por_confirmar` a `confirmada` o `rechazada`. Nada registrado se modifica ni se borra, ni siquiera el dueño de la base puede hacerlo.
- El contador no escribe.
- Cada liquidación guarda quién la registró y quién la resolvió, con nombre y hora.

## Permisos

| Permiso | Clave | Qué permite |
|---|---|---|
| Consultar liquidaciones | `settlements-view` | Abrir la pantalla y ver los saldos de sus ubicaciones |
| Registrar y confirmar liquidaciones | `settlements-manage` | Registrar la entrega en su ubicación y confirmar o rechazar lo que recibe. Incluye consultar. |

- El administrador tiene los dos.
- Nadie los recibe al aplicar la migración; se asignan en Configuración → Usuarios.
- Al contador solo se le puede dar el de consultar.

## Reportes de caja

Parten de `reporte_diario()` y `reporte_medios_de_pago()`, que no cambian, y solo corrigen lo que es de pedidos:

- **El cobro del pedido** cuenta para la ubicación que recibió el dinero, el día del cobro y con su medio real. Se suma a `cobros_total`, a `cobros_por_cuenta_de_otras` y a la lista `cobros_de_pedidos`.
- **El contado de la factura de un pedido** sigue siendo venta de quien factura. Ya no se cuenta como cobro suyo ni como «sin registrar».
- **La prima de un crédito** ya está en los cobros del pedido, así que su abono no se suma otra vez.
- **Lo nuevo del reporte diario:**
  - `saldos_por_liquidar`: lo pendiente, por confirmar y liquidado de cada par, al momento de consultar;
  - `liquidaciones_del_dia`: las liquidaciones por su fecha efectiva.

Con solo ventas normales, los reportes de caja dan exactamente lo mismo que los de siempre. Hay una prueba que lo comprueba.

## Corrección 0047

En producción, el reporte diario de caja del 16/11/2026 mostraba la fila «Sin ubicación» con cobros que no eran suyos. Esa fila existe por un abono antiguo sin ubicación, y recibía las facturas y los cobros de pedidos de todas las ubicaciones. La 0047 separa `sumar_de()` en dos firmas (todo, o una ubicación comparada tal cual) sin cambiar el código de los reportes: los totales, las demás filas y el reporte de medios no cambian.

## Pendiente para la etapa C2

Anular o cancelar un pedido cuyo efectivo ya se liquidó exige revertir o ajustar esa liquidación. Ni la 0046 ni la 0048 tienen esa operación:

- una liquidación confirmada no se modifica;
- un pedido no puede cancelarse todavía;
- por eso la 0048 bloquea el rechazo y la resolución de un pedido con efectivo ya liquidado o por confirmar.

La etapa C2 debe definir:

- un ajuste o contraliquidación con su propio registro;
- qué pasa con lo pendiente y con lo entregado por confirmar de un pedido cancelado;
- cómo se reflejan en los saldos las devoluciones parciales.

## Errores

| Código | Significado |
|---|---|
| `LQ001` | Datos no válidos |
| `LQ002` | Monto mayor que lo pendiente |
| `LQ003` | Clave usada para otra liquidación |
| `LQ004` | La liquidación ya no está por confirmar |
| `42501` | Sin permiso o fuera de sus ubicaciones |
