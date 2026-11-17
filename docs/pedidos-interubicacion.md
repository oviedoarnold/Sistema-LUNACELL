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

En esta etapa no habilitan ninguna acción: las funciones de la etapa C los exigirán.

## Lo que queda para después

- **Etapa B**
  - La caja por ubicación, lo cobrado por cuenta de otra ubicación, los reportes y las liquidaciones.
  - Hasta entonces, los reportes de siempre cuentan la factura de un pedido en la ubicación y el día en que se facturó, y su dinero aparece como «sin registrar». Lo cobrado en origen ya queda guardado con su ubicación, usuario y fecha en `cobros_por_medio.pedido_id`, que es lo que usará la etapa B.
- **Etapa C**
  - Rechazo, resolución y reenvío, cancelación autorizada, anulación, devoluciones y reembolsos.
  - El estado `por_resolver`, la tabla `eventos_de_pedido` y los dos privilegios ya existen.
  - Una factura de pedido no se anula con la anulación actual: `anular_venta()` la rechaza y la pantalla explica por qué.
- **Sin conexión**: los pedidos se crean, revisan y facturan solo con conexión. La venta sin conexión de siempre no cambió.

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
