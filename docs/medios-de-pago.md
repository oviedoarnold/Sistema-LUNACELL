# Medios de pago y comisiones

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

## Comisiones

La comisión del proveedor es una estimación interna, separada del cobro:

- Se calcula en la base con la tasa vigente en la fecha del cobro: 7 % inicial en
  tarjeta y enlace de pago. El administrador la cambia en Configuración, y vale de
  ahora en adelante.
- **No se le cobra al comprador:** no cambia el total ni aparece en la factura.
- Solo la lee el administrador, igual que los cobros, que también van en una tabla
  cerrada para vendedor y contador.
- Una venta anulada conserva su comisión, porque el proveedor puede no devolverla.
  Se ve aparte el día de la anulación.

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
  son lo que declara quien cobra. La comisión es una estimación, sin conciliar
  contra la liquidación real.
- **La vía anterior sigue abierta** para no romper teléfonos y pestañas con la
  versión previa: `registrar_venta_ubicacion` y `registrar_pago_cliente` aún
  registran sin medios, y esas operaciones quedan «Sin registrar».
- **El medio no se imprime** en la factura ni se muestra en el historial, y un
  administrador no lo ve al revisar una conciliación pendiente.

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

Reversión, después de revertir el frontend. Borra los cobros y comisiones ya
registrados, que no se pueden reconstruir; las ventas y los abonos no se tocan:

```sql
begin;
drop trigger if exists aplicar_cobros_de_conciliacion on public.ventas_por_conciliar;
drop trigger if exists sembrar_tasas_de_comision on public.empresas;
drop function if exists public.reporte_medios_de_pago(date, uuid);
drop function if exists public.rescatar_venta_con_medios(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, jsonb, uuid, text, text, date, text, text);
drop function if exists public.sincronizar_venta_con_medios(text, uuid, uuid, text, text, timestamptz, timestamptz, numeric, jsonb, numeric, text, jsonb, uuid, text, text, date, text);
drop function if exists public.registrar_pago_con_medios(uuid, numeric, jsonb, text, text);
drop function if exists public.registrar_venta_con_medios(jsonb, text, jsonb, uuid, text, text, date, text, text);
drop function if exists public.configurar_tasa_de_comision(text, numeric);
drop function if exists public.aplicar_cobros_de_conciliacion();
drop function if exists public.guardar_cobros_sin_conexion(uuid, jsonb, jsonb);
drop function if exists public.medios_sin_conexion_invalidos(text, jsonb, numeric);
drop function if exists public.guardar_cobros_de_pago(uuid, jsonb);
drop function if exists public.guardar_cobros_de_venta(uuid, jsonb);
drop function if exists public.cobros_guardados(uuid, uuid);
drop function if exists public.cobros_normalizados(jsonb);
drop function if exists public.suma_de_cobros(jsonb);
drop function if exists public.medios_de_cobro_invalidos(jsonb);
drop function if exists public.sembrar_tasas_de_comision();
drop table if exists public.comisiones_de_cobro;
drop table if exists public.cobros_por_conciliar;
drop table if exists public.cobros_por_medio;
drop table if exists public.tasas_de_comision;
drop function if exists public.anotar_comision_de_cobro();
drop function if exists public.registro_de_cobro_inmutable();
delete from supabase_migrations.schema_migrations where name = '0039_medios_de_pago';
commit;
```
