# Medios de pago, cargo e ISV

Registra con qué se cobró cada venta de contado y cada abono: efectivo,
transferencia, tarjeta o enlace de pago, o dos de ellos con su importe.

`ventas.forma_pago` sigue diciendo si la venta es al contado o a crédito. Una
venta a crédito no lleva medios: se cobra con sus abonos.

## Reglas

- **Los importes suman exactamente** el total de la venta que calculó el servidor,
  o el monto del abono. Si no, se deshace todo: venta, existencia y correlativo.
- **Un medio por operación**, una sola vez cada uno. En transferencia, tarjeta y
  enlace la referencia es opcional (0040): nunca se inventa, y sin ella queda vacía.
  El efectivo no lleva.
- **El POS no preselecciona un medio**, para que una transferencia que nadie
  cambió no quede como efectivo.
- **Pago único o pago mixto.** El único lleva un medio y el total, sin escribir
  importe. El mixto lleva exactamente dos medios distintos, con importe positivo en
  los dos: se escribe uno y el otro se calcula con lo que falta. Cambiar de
  modalidad borra lo escrito, para que nada viaje oculto.
- **La pantalla no deja superar el total**, ni pegando: el importe se ajusta al
  total y lo avisa. Si el total cambia en un pago mixto, el importe calculado lo
  sigue y el escrito no cambia solo: si pasa del total, la venta no se confirma
  hasta corregirlo.
- **El límite de dos medios es de la aplicación.** Lo comprueban la pantalla y la
  venta sin conexión al guardarse. La base sigue admitiendo los cuatro, así que una
  llamada directa a la función con tres pasa si los importes suman; y una venta con
  más de dos guardada antes en un teléfono se sincroniza igual.
- **Un cobro sin referencia** se concilia por fecha y medio, no uno a uno. No se
  puede completar después, porque los cobros no admiten cambios.
- **Un reintento no duplica.** La misma clave con los mismos medios devuelve lo que
  ya existe; con otros medios se rechaza (`LM005`, u `OF003` sin conexión).
- **Solo se agrega.** Ni el dueño de la base cambia, borra o vacía un cobro.

## Cargo del 7 %

Tarjeta y enlace suman un 7 % a lo que paga el comprador, sobre el importe de ese
medio, y lo calcula el sistema: L 1,000 con tarjeta son L 1,070, y L 600 en efectivo
más L 400 con tarjeta son L 1,028.

- `ventas.total` sigue siendo productos más ISV. El cargo va en `cobros_por_medio.cargo`,
  y su suma en `ventas.cargo_por_medio` o `pagos.cargo_por_medio`.
- Lo cobrado es el total más el cargo, y el documento muestra las dos cifras.
- En un abono de L 400 con tarjeta el comprador paga L 428, y la deuda baja L 400.
- Al anular con reembolso pendiente, `anulaciones_venta.cargo_a_devolver` guarda lo que
  hay que devolver además del total.
- La base comprueba el cargo. Una versión anterior no lo manda y queda con cargo 0, así
  que esa vía sigue abierta hasta que no queden versiones anteriores.

## ISV por venta

La casilla de ISV del POS nace marcada solo en una ubicación de tipo `tienda`, y el
vendedor la cambia. Sin ella, la venta queda con tasa 0. Una factura fiscal lleva siempre
ISV (`LV009`). Un reintento con otra decisión se rechaza (`LM005`, u `OF003` sin conexión).

## Ventas sin conexión

Las funciones anteriores no cambian. La venta guardada con medios va por
`sincronizar_venta_con_medios`, que llama a la anterior y guarda los medios en la
misma transacción.

| Caso | Qué pasa |
|---|---|
| Venta guardada antes de esta versión | Va por la función anterior y queda «Sin registrar» |
| Medios mal formados o que no suman | `OF001`: la venta sigue en el teléfono |
| Queda en conciliación | Los medios esperan en `cobros_por_conciliar`, sin contar |
| Se aplica la conciliación | Pasan a la venta, con su fecha original |
| Se anula la conciliación | No generan cobros |
| Rescate | Igual que la conciliación; un rechazo queda auditado |

## El reporte

`reporte_medios_de_pago(día, ubicación)` cuenta el mismo dinero que `cobros_total`
de `reporte_diario()`. Lo que no tiene medio porque se registró antes va como
**«Sin registrar»**, nunca como efectivo, así que los totales siempre coinciden.

Un pago de un administrador sobre facturas de varias ubicaciones reparte cada medio
en orden entre esas ubicaciones, de la factura más vieja a la más reciente. Los
importes por medio y por ubicación son exactos, pero en ese caso la asignación de
un medio a una ubicación es una convención, no un dato del cobro.

## Limitaciones

- **No se confirma el pago con el proveedor o el banco:** el medio y la referencia
  son lo que declara quien cobra.
- **La vía anterior sigue abierta** para no romper teléfonos y pestañas con la
  versión previa: `registrar_venta_ubicacion` y `registrar_pago_cliente` aún
  registran sin medios, y esas operaciones quedan «Sin registrar».
- **Riesgo legal aceptado por el negocio:** ver `propuesta-cobro-simplificado.md`.

## Despliegue

**Primero la 0039, después el frontend.** La migración no afecta a la versión
actual, que no usa nada de lo nuevo. Con el frontend nuevo y sin la migración, las
ventas de contado fallarían.

**Primero la 0040, después el frontend que deja de pedir la referencia.** Las
versiones anteriores siguen funcionando, porque mandan referencia. Al revés, las
ventas sin referencia fallarían con `LM001`, y las guardadas sin conexión no subirían
(`OF001`) hasta aplicarla.

Para revertir solo la 0040 no se quita lo ya guardado: se vuelve a poner la comprobación
en `medios_de_cobro_invalidos()` y se recrea la restricción con `not valid`, para que
no falle por los cobros sin referencia.

**Primero la 0041, después el frontend del cargo y el ISV.** Las versiones anteriores siguen funcionando con ella.
