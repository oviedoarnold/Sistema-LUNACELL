# Precios negociados durante una venta

El vendedor puede cambiar el precio de un producto solo para la venta actual, por
ejemplo en una compra al por mayor.

No cambia el precio general, el precio especial del cliente, el costo ni otras ventas.

## Qué precio se usa

1. El negociado en esta venta.
2. El especial del cliente, si existe.
3. El general del catálogo.

El subtotal, el ISV, el cargo del 7 % y el total se calculan sobre el precio negociado.
La factura muestra el precio vendido.

## Reglas

- **Quién negocia:** quien tenga el permiso de facturar y el administrador. El contador
  no puede. No hay un permiso aparte.
- **Validación:** el precio debe ser un número mayor que cero, con hasta dos decimales.
- **Motivo:** bajar el precio exige elegir uno; subirlo, no.
- **Flujo autorizado:** solo `registrar_venta_con_medios()` y la sincronización aceptan
  un precio negociado. Enviado a `registrar_venta_ubicacion()` se ignora.
- **Reintentos:** la misma clave con otros precios se rechaza (`LM005`).

## En el POS

- **Modificar precio** abre el editor debajo de la línea. Mientras está abierto no se
  puede facturar.
- **Restaurar** vuelve al precio de referencia.
- Cambiar la cantidad conserva el precio negociado.
- Cambiar de cliente conserva el precio negociado y actualiza su referencia.
- Quitar el producto del carrito descarta la negociación.

## Trazabilidad

Cada línea negociada de `detalle_venta` guarda:

| Columna | Qué guarda |
|---|---|
| `precio` | El precio aplicado |
| `precio_referencia` | El precio antes de negociar |
| `negociado_por`, `negociado_por_nombre` | Quién lo cambió |
| `negociado_en` | Fecha y hora |
| `motivo_negociacion` | `mayoreo`, `cliente_frecuente`, `promocion` u `otro` |

El administrador lo revisa en el historial, con el filtro **Con precio negociado**.

## Sin conexión

La venta guarda el precio cobrado, el de referencia y el motivo.

| Caso al sincronizar | Qué pasa |
|---|---|
| Vendedor con permiso y datos válidos | Se registra con lo cobrado, aunque el precio general o especial haya cambiado |
| Vendedor sin permiso | Va a conciliación (`sin-permiso`) |
| Precio o motivo no válidos | Va a conciliación (`precio-distinto`) |
| Reintento | La clave y la huella evitan duplicados |

Al aplicar una conciliación, la venta conserva su trazabilidad. Si la negociación no era
válida, el precio cobrado se conserva y el motivo no válido no se guarda.

## Despliegue

**Primero la 0043, después el frontend.** Sin la 0043, una venta negociada no llega a
aplicarse: al contado el servidor la rechaza porque los medios no cuadran, y a crédito se
registraría al precio normal.

## Precio mínimo

Hoy no existe un precio mínimo de venta, y esta fase no agrega uno. Tampoco se usa el
costo de adquisición como referencia para el vendedor.

Una regla administrable podría agregarse así:

1. Una columna `productos.precio_minimo`, opcional, que solo el administrador cambia.
2. Una validación en `aplicar_precios_negociados()` que rechace un precio menor, con un
   código propio.
3. Sin conexión, una venta que incumpla el mínimo iría a conciliación.
4. El POS solo mostraría el rechazo; el mínimo no tendría que enviarse al vendedor.
