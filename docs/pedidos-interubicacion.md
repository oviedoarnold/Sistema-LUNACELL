# Pedidos interubicación: etapa A

Un cliente de Camión 01 compra y se lleva los productos en Bodega. Bodega entrega y descuenta su inventario. El pedido llega a Camión 01, que lo revisa y lo factura con su numeración, sin descontar inventario y sin cobrar otra vez.

Migración: [`0045_pedidos_interubicacion.sql`](../supabase/migrations/0045_pedidos_interubicacion.sql).

## Flujo

1. **Bodega entrega** desde el POS con «Enviar pedido». Elige la ubicación que factura, el cliente registrado, los productos y la forma de pago. `entregar_pedido()` hace todo en una transacción:
   - descuenta solo de la ubicación del usuario, con candado por producto (`PI007` si no alcanza);
   - guarda el pedido con precios general, especial y negociado, el ISV, el total y los cobros;
   - anota la salida como `entrega_pedido` en el Kardex y el evento `entregado`.

   La clave de idempotencia es obligatoria. Un reintento con la misma clave devuelve el pedido ya entregado; con otro contenido responde `PI005`.
2. **Camión 01 recibe el aviso**. La campanita cuenta los pedidos pendientes de su ubicación y marca los no leídos. Se consulta al abrir, al volver a la pestaña, cada minuto y cuando el mismo dispositivo entrega o factura. Leer no cambia el pedido.
3. **Camión 01 factura** desde «Pedidos». `facturar_pedido()` bloquea el pedido y emite una sola factura:
   - la factura lleva los datos guardados, la ubicación destino, el correlativo de la empresa y el tipo de documento del destino;
   - no toca inventario ni registra dinero;
   - si dos dispositivos facturan a la vez, el segundo recibe la misma factura con `ya_facturado`.

## Dinero

| Caso | Al entregar (Bodega) | Al facturar (Camión 01) |
|---|---|---|
| Contado | Cobros en `cobros_por_medio.pedido_id`, con ubicación Bodega, usuario, tasa y cargo | Factura `pagada` con el cargo cobrado; ningún cobro nuevo |
| Crédito | Nada | Factura `pendiente`: la deuda nace aquí, una sola vez |
| Crédito con prima | La prima, igual que un cobro de contado (menor que el total, `PI010`) | Factura `pendiente` más un pago (`pagos.pedido_id`) y su abono aplicados solo a esa factura, con la fecha, ubicación y usuario de Bodega |

Los porcentajes y cargos se validan al entregar con la tasa vigente (`LM007`). Si cambian el precio, el ISV o la tasa mientras el pedido espera, la factura usa lo guardado.

Si el destino emite facturas fiscales, el pedido lleva ISV (`PI009`).

## Pago parcial en pantalla

En la base se llama «prima»; en pantalla, **pago parcial**. Solo cambia la presentación: `entregar_pedido()` y `facturar_pedido()` son las mismas.

- **Dónde:** en el POS, «Enviar pedido» → Crédito. Aparece la casilla **«Hacer pago parcial»**, desmarcada por defecto.
- **Desmarcada:** el pedido se envía como siempre, sin monto ni medios. No viaja ningún cobro.
- **Marcada:** se piden el monto, el método (el selector de siempre, con mixto y referencia según las reglas vigentes) y se ve dónde se recibe el dinero. El resumen muestra:
  - total del pedido;
  - pago parcial;
  - cargo de tarjeta o enlace, si aplica;
  - lo que entrega el cliente;
  - el saldo pendiente del crédito.

  El cargo se suma a lo que entrega el cliente y no reduce el saldo.
- **Desmarcarla** borra el monto y los medios.
- **Montos no válidos:**
  - mayor que el total: no se envía;
  - igual al total: se avisa que va al contado y un botón lo pasa, conservando cliente, productos y medios. Nunca se cambia solo.
- **El cliente:** en modo pedido, cambiar entre Contado y Crédito ya no lo suelta. En las ventas normales sigue soltándose, como antes.
- **En el destino:**
  - cada tarjeta pendiente muestra lo pagado en origen y lo pendiente;
  - con pago parcial, la confirmación de «Facturar» resume el total, el pago recibido y el saldo.

  La factura es por el total y el pago se aplica una sola vez.

**Cobros posteriores.** Un pago registrado después en «Por cobrar» sigue la regla general: se aplica primero a las facturas más antiguas del cliente. Elegir una factura específica se evaluará por separado.

## Rechazo y resolución (etapa C1)

Migración: [`0048_rechazo_resolucion_pedidos.sql`](../supabase/migrations/0048_rechazo_resolucion_pedidos.sql). Todo se hace desde el detalle del pedido en «Pedidos», con conexión.

### Rechazar

- **Quién:** quien tiene «Facturar» en la ubicación destino, o el administrador.
- **Qué pide:** el motivo (de 5 a 500 caracteres) y la confirmación, en un solo diálogo.
- **Qué hace** `rechazar_pedido()`:
  - el pedido pasa de `pendiente` a `por_resolver`; nadie puede facturarlo mientras tanto;
  - queda el evento `rechazado` con el motivo, el usuario, su ubicación, la fecha y la ubicación que rechazó;
  - el aviso vuelve a quedar sin leer, y la campanita de la ubicación que lo entregó lo muestra con el motivo.
- **Qué no hace:** no devuelve inventario ni dinero, no factura, no toca cobros, pagos ni liquidaciones y no crea otro pedido. Rechazar no es cancelar.

### Resolver

Lo resuelve quien tiene «Resolver pedidos interubicación» en la ubicación que **entregó** el pedido, o el administrador. La ubicación de la factura siempre sale del pedido o de la lista de la empresa, nunca de la ubicación del administrador.

- **«Facturar en _origen_»** (`resolver_pedido(…, 'facturar_en_origen')`):
  - en la misma operación, el pedido pasa a ser de su origen y se emite su única factura con `facturar_pedido()`;
  - necesita también «Facturar»;
  - conserva productos, precios, ISV, cobros, cargos, el pago parcial y el inventario que salió al entregar;
  - no queda ningún momento en que otra ubicación pueda facturarlo.
- **«Enviar a otra ubicación»** (`resolver_pedido(…, 'reenviar', destino)`):
  - el mismo pedido, con el mismo número, vuelve a `pendiente` en la ubicación elegida, que recibe el aviso y lo factura como cualquier otro;
  - el destino debe ser otra ubicación activa de la empresa que factura, que no sea el origen ni la que lo rechazó; si emite facturas fiscales, el pedido debe llevar ISV (`PI009`);
  - la ubicación que lo rechazó deja de verlo.
- **Nota:** opcional, queda en la historia junto a quién resolvió.

Un pedido puede rechazarse y reenviarse varias veces: la historia conserva cada rechazo, cada envío (de dónde a dónde) y la factura.

### El dinero sigue al destino final

| Caso | Factura | Liquidación |
|---|---|---|
| Facturado en origen | De la ubicación que entregó, con el pago parcial ya aplicado | Ninguna: cobró y factura la misma ubicación |
| Enviado a otra ubicación | De la ubicación nueva | El efectivo cobrado en origen se le debe a la ubicación nueva |
| Por resolver | Ninguna todavía | Su efectivo no se puede liquidar: no se sabe a quién se le debe |

Lo electrónico (transferencia, tarjeta, enlace y su cargo) sigue sin liquidarse entre ubicaciones.

**Bloqueo por liquidaciones.** Si el efectivo del pedido ya está en una liquidación por confirmar o confirmada, el pedido no se rechaza ni cambia de ubicación (`PI013`). Si está por confirmar, quien la recibe puede rechazarla en Liquidaciones y después rechazar el pedido. Si ya está confirmada, ajustarla corresponde a la etapa C2. Las liquidaciones rechazadas no bloquean.

### Seguridad

- Las dos funciones toman primero el candado del par de ubicaciones (el mismo de `registrar_liquidacion()`) y después la fila del pedido: una liquidación no puede meter su efectivo mientras se rechaza o se resuelve, y dos personas que resuelven a la vez quedan en fila (la segunda recibe `PI012`).
- Las dos llevan clave de idempotencia. Un reintento con la misma clave devuelve lo hecho; la clave usada para otra operación da `PI011`.
- Las únicas transiciones posibles son `pendiente → facturado`, `pendiente → por_resolver` (solo cambia el estado) y `por_resolver → pendiente` (solo cambian el estado y el destino, siempre a otra ubicación). Un pedido facturado o cancelado ya no cambia.
- Origen y destino solo coinciden en un pedido facturado en origen. Un disparador diferido lo revisa al confirmar la transacción: un pedido pendiente para su propia ubicación no puede quedar guardado.

### Cómo se integró sin reescribir lo publicado

`saldos_de_pedidos()`, `detalle_de_pedido()`, `avisos_de_pedidos()`, `reporte_diario_de_caja()` y `reporte_medios_de_caja()` se renombraron con el sufijo `_base` sin cambiar su código. Las funciones con el nombre de siempre las llaman y agregan lo nuevo:

- `saldos_de_pedidos()` deja fuera los pedidos facturados en origen y los que están por resolver;
- los reportes de caja siguen contando el cobro de un pedido facturado en origen en su ubicación, su día y su medio, pero ya no como «cobrado por cuenta de otra ubicación».

## Cancelación antes de facturar (etapa C2a)

Migración: [`0049_cancelacion_pedidos_interubicacion.sql`](../supabase/migrations/0049_cancelacion_pedidos_interubicacion.sql). Se hace desde el detalle del pedido en «Pedidos», con conexión, en un solo formulario.

**Tres hechos, tres registros.** Pueden ir juntos en la misma operación o registrarse después, desde el pedido cancelado.

| Hecho | Registro | Qué mueve |
|---|---|---|
| La cancelación | `cancelaciones_de_pedido` (una por pedido) | Nada: el pedido deja de poder facturarse |
| Los productos que vuelven | `recepciones_de_pedido` y `recepcion_detalle` | En buen estado, suman existencia en la ubicación que los recibió (movimiento `devolucion`); dañados, solo quedan registrados |
| El dinero que se le devuelve al cliente | `reembolsos_de_pedido`, una fila por entrega y medio | El efectivo baja la caja de quien pagó; lo electrónico sale de la cuenta de la empresa |

Lo pendiente no es un registro: es lo entregado menos lo recibido, y lo cobrado menos lo devuelto. Los cobros originales no se tocan.

### Reglas

- **Quién:** «Autorizar cancelación de pedidos» (`orders-cancel`) en el origen o el destino, o el administrador. Ni el contador ni otra empresa.
- **Qué se cancela:** solo un pedido pendiente o por resolver. Uno facturado se rechaza (`PI012`): su anulación es de la etapa C3.
- **Motivo:** obligatorio, de 5 a 500 caracteres.
- **Productos:**
  - el empleado los recibe en su ubicación, si es el origen o el destino;
  - el administrador, en cualquier ubicación activa; si no es ni el origen ni el destino, con una nota que la respalde;
  - nunca más de lo entregado y no recibido (`PI014`).
- **Dinero:**
  - se devuelve lo realmente recibido, cargo de tarjeta o enlace incluido, con los importes históricos;
  - el efectivo se devuelve en efectivo desde el origen o el destino;
  - transferencia, tarjeta y enlace los devuelve solo el administrador, con referencia;
  - se puede devolver en varias entregas, nunca más de lo pendiente de cada medio (`PI015`);
  - desde la 0050 (C2b), el administrador también puede devolver el efectivo desde una tercera ubicación activa, con la referencia de la entrega real (`PI015` si está desactivada o sin referencia). Los empleados, solo desde su ubicación si es el origen o el destino.
- **Liquidaciones** (reglas de la 0050, etapa C2b; ver [liquidaciones-entre-ubicaciones.md](liquidaciones-entre-ubicaciones.md)):
  - con efectivo del pedido en una liquidación **por confirmar** no se cancela ni se devuelve efectivo (`PI013`); con una confirmada o rechazada, sí;
  - un pedido cancelado ya no se le debe al destino;
  - quien devolvió al cliente efectivo que conserva otra ubicación recibe de ella lo que puso: el origen le debe al destino o a una tercera ubicación, o el destino le devuelve al origen lo que ya le habían liquidado (contraliquidación);
  - lo pendiente de devolver al cliente no es deuda entre ubicaciones.
- **Reportes de caja:**
  - si ese día hubo devoluciones de pedidos, o quedan pendientes, agregan lo devuelto (por medio y por ubicación), el neto y lo pendiente;
  - lo pendiente no baja ninguna caja;
  - una ubicación que devolvió efectivo aparece aunque ese día no haya cobrado (con su neto negativo), así las filas por ubicación suman exactamente los totales; lo electrónico sale de la cuenta de la empresa y no es de ninguna fila;
  - sin cancelaciones, las cifras son las de antes.
- **Seguridad:**
  - la clave de cada operación evita repeticiones (`PI011` si se reusa para otra cosa);
  - el pedido se bloquea con el mismo candado que las liquidaciones;
  - los registros no se modifican ni se borran;
  - el formulario abierto bloquea la actualización automática.

## Quién puede

- Entrega quien tiene «Facturar» y una ubicación asignada; el pedido sale de esa ubicación.
- Factura quien tiene «Facturar» en la ubicación destino, o el administrador.
- Ven el pedido las dos ubicaciones, el administrador y el contador con historial. El contador no escribe, no recibe avisos y no factura.
- Las tablas nuevas solo se escriben desde las funciones. El pedido solo pasa de pendiente a facturado, y su detalle y su historia no cambian.

### Privilegios nuevos

«Resolver pedidos interubicación» (`orders-resolve`) y «Autorizar cancelación de pedidos» (`orders-cancel`) se asignan en Configuración, en Usuarios y privilegios, uno por uno.

- Nadie los recibe al instalar.
- El administrador los tiene siempre.
- Al contador no se le ofrecen, y la base no se los reconoce aunque se le marquen por SQL.
- Valen solo para pedidos de la ubicación del usuario (origen o destino). La base los comprueba con `usuario_puede_resolver_pedido()` y `usuario_puede_autorizar_cancelacion()`.

Desde la etapa C1, «Resolver pedidos interubicación» permite resolver los pedidos rechazados, y solo en la ubicación que los entregó. Desde la C2a, «Autorizar cancelación de pedidos» permite cancelar antes de facturar y registrar los productos que vuelven y el dinero que se devuelve.

## Lo que queda para después

- **Etapa B**
  - La caja por ubicación, lo cobrado por cuenta de otra ubicación, los reportes y las liquidaciones.
  - Hasta entonces, los reportes de siempre cuentan la factura de un pedido en la ubicación y el día en que se facturó, y su dinero aparece como «sin registrar». Lo cobrado en origen ya queda guardado con su ubicación, usuario y fecha en `cobros_por_medio.pedido_id`, que es lo que usará la etapa B.
- **Etapa C**
  - C1 (0048): rechazo y resolución antes de facturar. Hecho; ver arriba.
  - C2a (0049): cancelación antes de facturar, productos que vuelven y reembolsos. Hecho; ver arriba.
  - C2b (0050): obligaciones entre ubicaciones en ambos sentidos (contraliquidación), reembolsos desde terceras ubicaciones y cancelar con efectivo ya liquidado. Hecho; ver [liquidaciones-entre-ubicaciones.md](liquidaciones-entre-ubicaciones.md).
  - C3 (0051): anulación completa de la factura de un pedido. Hecho; ver «Anular la factura de un pedido».
  - C4 y C5 (0052): devoluciones parciales o totales con la factura vigente y ajustes de crédito. Hecho; ver [devoluciones-de-ventas.md](devoluciones-de-ventas.md). El dinero de una devolución sale solo de la ubicación que facturó: no cambia ninguna obligación entre ubicaciones.
- **Sin conexión**: los pedidos se crean, revisan, facturan, rechazan y resuelven solo con conexión. La venta sin conexión de siempre no cambió.

## Anular la factura de un pedido (etapa C3, 0051)

Una factura de pedido no se anula con `anular_venta()`, porque la mercadería salió del origen y no de la ubicación que facturó. Se anula con `anular_factura_de_pedido(venta, motivo, clave)`, desde el mismo botón **Anular** del Historial.

- **La factura** queda «Anulada», con su registro inmutable en `anulaciones_venta` (tratamiento del dinero «pedido»). Conserva su número, sus productos y sus pagos, y deja de contar como venta y como deuda.
- **El pedido** queda «Cancelado», con su registro en `cancelaciones_de_pedido` (estado anterior «facturado»). Desde ahí se usa lo mismo que en C2a y C2b:
  - los productos que devuelva el cliente se reciben donde de verdad vuelvan;
  - lo cobrado en el pedido (el contado o la prima) queda por devolver y se devuelve en una o varias entregas;
  - las obligaciones entre ubicaciones salen de dónde quedó el efectivo, también con liquidaciones ya confirmadas.
- **Anular no mueve inventario ni registra reembolsos** por su cuenta: la mercadería no vuelve sola a ninguna ubicación.

Reglas (decisiones del propietario, 2026-11-19):

- **Quién:** igual que `anular_venta()`. El administrador, siempre. El vendedor necesita «Historial de facturas» y «Anular ventas», en la ubicación que facturó, y solo el mismo día de la factura. Recibir y devolver después siguen las reglas de C2a.
- **Abonos registrados después de facturar** (pagos del cliente repartidos por FIFO): no se anula (`AV005`); se usan las devoluciones de C4 y C5, que rebajan el saldo y dejan a favor el excedente. La prima cobrada en el pedido sí se admite.
- **Facturas fiscales (CAI):** no se anulan (`AV004`). Falta definir con el contador su anulación o nota de crédito y el tratamiento del correlativo fiscal.
- **Liquidación por confirmar:** no se anula (`PI013`); con una confirmada, sí.
- **Una sola vez:** un reintento responde «ya_anulada» sin escribir nada. La clave es obligatoria.

## Errores

| Código | Significado |
|---|---|
| `PI001` | Datos no válidos |
| `PI002` | Sin ubicación de origen, o desactivada |
| `PI003` | Destino no válido: el mismo origen, desactivado, no factura o de otra empresa |
| `PI004` | Falta un cliente registrado de la empresa |
| `PI005` | Clave usada para otro pedido |
| `PI006` | Producto inexistente o inactivo |
| `PI007` | Existencia insuficiente en origen |
| `PI008` | El pedido no existe o no se puede facturar |
| `PI009` | ISV obligatorio en un destino fiscal |
| `PI010` | Prima igual o mayor que el total |
| `PI011` | Clave usada para otra operación (rechazar o resolver) |
| `PI012` | El pedido no está en el estado que la operación necesita, o cambió mientras se revisaba |
| `PI013` | El efectivo del pedido está en una liquidación que lo bloquea: por confirmar o confirmada para rechazar o resolver (C1); por confirmar para cancelar o devolver efectivo (C2b) |
| `PI014` | Recepción de productos no válida: cantidades, estado, ubicación o falta la nota |
| `PI015` | Reembolso no válido: medio que el cliente no usó, más de lo pendiente, o sin referencia (electrónico, o efectivo desde una tercera ubicación) |
