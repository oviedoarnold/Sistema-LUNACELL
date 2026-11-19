# Devoluciones después de facturar (etapas C4 y C5)

Una factura emitida no se corrige ni se renumera. Cuando el cliente devuelve productos, la factura queda igual, y la devolución se registra aparte, con sus cifras definitivas y sin que nadie pueda cambiarla ni borrarla. Sirve para facturas de contado, de crédito y de pedidos interubicación, tanto para una parte de lo vendido como para todo.

La migración es la [0052](../supabase/migrations/0052_devoluciones_ventas_y_ajustes_credito.sql). Desde la pantalla se llaman tres funciones:

- `devolucion_de_venta(venta)` devuelve lo que muestra la ventana.
- `registrar_devolucion_de_venta(venta, motivo, productos, ubicación, clave)` registra la devolución.
- `registrar_reembolso_de_venta(venta, medio, importe, referencia, clave)` registra el reembolso.

## Reglas

Son decisiones del propietario del 2026-11-19.

### Cuánto vale lo devuelto

Vale el precio facturado por la cantidad devuelta, más su ISV. El ISV se calcula con la misma proporción entre total y subtotal que tiene la factura.

El cargo de tarjeta o enlace solo se devuelve cuando vuelve todo lo que quedaba por devolver. Esa última devolución también ajusta el céntimo, para que la suma de lo devuelto sea exactamente el total.

### Crédito

Lo devuelto primero rebaja el saldo de esa misma factura. Para eso se registra un ajuste: un pago en estado `ajuste` con su abono, marcado con `devolucion_id`. El ajuste:

- no es dinero que entró;
- no aparece en los reportes de caja ni como «Abonado»;
- sí descuenta del saldo y entra en el orden FIFO de los pagos siguientes del cliente.

Si la devolución vale más que el saldo, el excedente queda a favor del cliente como reembolso pendiente. Nunca se aplica a otras facturas.

### Contado

Todo el valor devuelto queda a favor del cliente como reembolso pendiente.

### Reembolso

Es una entrega real de dinero y se registra aparte, cuando el dinero ya se entregó. El medio lo elige quien registra:

- **Efectivo:** sale de la caja de la ubicación que facturó y baja esa caja en el reporte del día.
- **Transferencia, tarjeta o enlace:** solo lo registra el administrador, y con referencia.

Límites del importe:

- **Contado:** nunca más de lo cobrado con ese medio en la factura. Si la factura viene de un pedido, cuenta lo cobrado en el pedido.
- **Crédito:** nunca más del excedente.

### Inventario

- Solo vuelve a la existencia lo recibido en buen estado, y en la ubicación donde de verdad se recibió. Cada unidad deja un movimiento `devolucion` enlazado a la devolución.
- Lo dañado queda registrado, pero no suma a la existencia.

### Facturas de pedido

El dinero de la devolución solo sale de la ubicación que facturó. Por eso no cambia ninguna obligación entre ubicaciones, ni las liquidaciones o contraliquidaciones ya hechas.

### Facturas fiscales (CAI)

Quedan bloqueadas (`DV004`) hasta definir con el contador la nota de crédito.

### Un solo camino

Una venta con devoluciones ya no se anula: ni con `anular_venta()` ni con `anular_factura_de_pedido()` (`AV010`). Lo que falta se devuelve con otra devolución. Una venta anulada no admite devoluciones (`DV003`).

### Reintentos

Cada intento lleva su clave. Si se repite con la misma clave, la base responde lo ya registrado y no escribe nada nuevo. Si esa clave se usa para otra operación, la base la rechaza (`DV006`).

## Quién puede

| | Administrador | Vendedor | Contador |
|---|---|---|---|
| Permiso | Ninguno adicional | **Registrar devoluciones** (`sales-return`) | Nunca |
| Ubicación | Cualquiera; recibe en cualquier ubicación activa | Solo facturas de su ubicación, y recibe en ella | — |
| Plazo | Sin límite | Sin límite | — |
| Reembolso electrónico | Sí, con referencia | No | — |

- Nadie recibe el permiso al instalar. Se asigna en **Configuración → Usuarios**, y no se le ofrece al contador.
- El contador puede consultar las devoluciones de una venta que ve, pero no registrarlas.
- Todo lo comprueba la base.

## Cómo se usa

1. En **Historial**, el botón **Devoluciones** aparece en las ventas vigentes que esa persona puede devolver, y en cualquier venta que ya tenga devoluciones.
2. Se escribe el motivo y, por producto, la cantidad y su estado, y se elige dónde se recibieron. Antes de confirmar, la ventana muestra:
   - cuánto baja la venta;
   - el nuevo importe;
   - el nuevo saldo del crédito;
   - lo que queda a favor;
   - si se devuelve el cargo.
3. Lo que queda a favor se reembolsa desde la misma ventana, en **Reembolsar dinero**, cuando el dinero de verdad se entrega.
4. En la lista, la venta muestra **Devuelto** con lo devuelto. «Abonado» y «Resta» ya tienen en cuenta el ajuste.

## Reportes

- **Reporte diario:** «Devoluciones de dinero a clientes» incluye los reembolsos de devoluciones, con el número de la factura. «Por devolver a clientes» suma lo pendiente de pedidos cancelados y de devoluciones.
- **Caja y medios:** solo cuentan pagos `aplicado`. El ajuste nunca aparece como cobro.

## Errores

| Código | Significado |
|---|---|
| `DV001` | Datos no válidos: motivo, productos, cantidades, estado o ubicación |
| `DV002` | La venta no existe en la empresa |
| `DV003` | La venta está anulada |
| `DV004` | Factura fiscal: bloqueada por ahora |
| `DV005` | Un producto no es de la venta, o se devuelve más de lo que queda |
| `DV006` | Clave usada para otra operación |
| `DV007` | Reembolso no válido: medio, importe, más de lo pendiente o de lo cobrado con ese medio, o falta la referencia |
| `AV010` | La venta tiene devoluciones: no se anula |
| `42501` | Sin permiso, o fuera de la ubicación que facturó |

## Pendiente

- La nota de crédito de las facturas fiscales.
- Aplicar a otras facturas, si el propietario lo decide, lo que queda a favor. Hoy solo se reembolsa.
