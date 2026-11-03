# Reporte diario de ventas y movimientos

Pantalla **Reportes** (`/reports`), solo para administradores. Muestra lo que
vendió y cobró cada ubicación en un día de Honduras, quién lo hizo y qué
movimientos de inventario hubo. Se exporta a PDF y a CSV.

Todo lo calcula `reporte_diario(p_dia, p_ubicacion)` (0038), con `numeric`. La
pantalla, el CSV y el PDF muestran esas cifras y no suman nada.

## De dónde sale cada dato

| Dato | Campo |
|---|---|
| Día de una venta | `ventas.fecha`. En una venta sin conexión o conciliada es la hora en que se hizo, no la de su sincronización |
| Ubicación de una venta | `ventas.ubicacion_id` |
| Vendedor | `ventas.usuario_id` |
| Forma de pago | `ventas.forma_pago`: `contado` o `credito` |
| Productos | `detalle_venta`, con el nombre y el precio de cuando se vendió |
| Día de un abono | `abonos.fecha` |
| Ubicación de un abono | `pagos.ubicacion_id`, o la de su venta si el pago no la tiene |
| Anulación | `anulaciones_venta`: `anulada_en`, `total`, `tratamiento_dinero`, `ubicacion_venta` |
| Movimientos | `movimientos_inventario`, con su traslado (`traslado_id`) y su venta (`venta_id`) |

## Cómo se calcula

- **Día:** de 00:00 inclusive a 00:00 del día siguiente, exclusive, en
  `America/Tegucigalpa`.
- **Ventas válidas:** las del día que no están anuladas.
- **Ticket promedio:** ventas válidas entre su cantidad, a dos decimales.
- **Cobros recibidos:** contado válido del día más abonos del día.
- **Abonos:** se suman `abonos` y no `pagos`. Un pago se reparte en abonos, y
  sumar los dos duplicaría el dinero. Un pago revertido no cuenta.
- **Anulaciones:** cuentan el día en que se anularon, aparte de las ventas. En
  el día de la venta, esta sigue en el detalle como «Anulada» y no suma.
- **Por conciliar:** no están en `ventas`, así que no cuentan. El reporte avisa
  cuántas hay de ese día.
- **Movimientos:** `salida` con venta es «Venta». Los demás tipos son los de la
  base. Un traslado son dos movimientos, y cada ubicación ve el suyo.

## Limitaciones

- **No se registra el método de pago.** La base solo distingue contado de
  crédito: no se sabe si un contado fue en efectivo o por transferencia, y un
  abono tampoco lo guarda. Separarlos exige capturarlo en el POS y en los cobros.
- **Un día pasado puede cambiar**, y no se guarda una foto de cada cierre. Al
  sincronizar una venta sin conexión o conciliarla, entra en el día en que se
  hizo. Al anular una venta, deja de sumar en su día.
- **Cobros de contado:** una venta de contado anulada sale de los cobros de su
  día aunque el dinero haya entrado. El «por reembolsar» se ve el día de la
  anulación. El reporte no es un arqueo de caja.
- **Datos anteriores a las ubicaciones:** las ventas y los movimientos sin
  ubicación aparecen como «Sin ubicación», solo en la vista de todas.

## Despliegue

**Primero la 0038, después el frontend.** Sin la función, la pantalla muestra
«No se pudo cargar el reporte» y lo demás sigue igual. El frontend actual no
la usa, así que aplicarla antes no afecta a nadie.

Reversión, después de revertir el frontend:

```sql
begin;
drop function if exists public.reporte_diario(date, uuid);
drop index if exists public.idx_abonos_empresa_fecha;
delete from supabase_migrations.schema_migrations where name = '0038_reporte_diario';
commit;
```
