# Propuesta: cobro simplificado en el POS

Estado: propuesta. De aquí, solo el cálculo automático del pago mixto está
implementado. Las referencias opcionales y cualquier cargo al comprador siguen sin
hacerse y necesitan decisión.

## 1. Cálculo automático del pago mixto (implementado)

Se escribe un importe y el otro sale de la resta, en centavos:

```
calculado = máx(0, total - escrito)
```

- El medio que se escribe último manda; el otro pasa a calcularse.
- El calculado no se guarda: se deriva, así que sigue al total si cambia el carrito.
- El escrito no cambia solo. Si pasa del total, se muestra el excedente y no se puede
  confirmar.
- Ninguno de los dos puede quedar en cero, y nadie escribe porcentajes.

El contrato no cambia: `p_cobros` lleva los dos medios con su importe. El servidor
vuelve a comprobar que sumen el total que él calculó (`LM002`, u `OF001` sin conexión).
Eso cubre el caso de una copia sin conexión con un precio viejo: la venta no se pierde
ni se cobra otro importe.

## 2. Referencias: qué exige hoy el servidor

**No se pueden quitar sin una migración.** Quitarlas solo de la pantalla haría fallar
las ventas por transferencia, tarjeta y enlace. La base las exige en dos sitios de la
0039:

| Dónde | Regla | Efecto si llega vacía |
|---|---|---|
| `medios_de_cobro_invalidos()` | Referencia obligatoria si el medio no es efectivo | `LM001` en línea, `OF001` sin conexión: la venta queda en el teléfono sin subir |
| Restricción `cobros_por_medio_referencia` | `btrim(referencia) <> ''` si el medio no es efectivo | Rechaza la fila aunque la función la deje pasar |

Rellenarla con un texto fijo como «SIN REFERENCIA» pasaría la validación, pero dejaría
un dato falso en un registro que no se puede corregir. No se propone.

### Migración propuesta (0040, sin crear ni aplicar)

```sql
alter table public.cobros_por_medio drop constraint cobros_por_medio_referencia;
alter table public.cobros_por_medio add constraint cobros_por_medio_referencia check (
  (medio = 'efectivo' and referencia = '')
  or (medio <> 'efectivo' and char_length(referencia) <= 120)
);
-- Y en medios_de_cobro_invalidos(), quitar solo este bloque:
--   if v_medio <> 'efectivo' and v_referencia = '' then ... end if;
```

Se conservan: el medio válido, el importe positivo, la suma exacta, que el efectivo no
lleve referencia y el largo máximo. `medios_sin_conexion_invalidos()` usa la misma
función, así que las ventas sin conexión quedan cubiertas sin tocarla.

**Orden obligatorio:**

1. Aplicar la 0040. Las versiones actuales siguen funcionando, porque mandan referencia.
2. Publicar el frontend sin la exigencia, en `problemaDeCobros()` y en el selector.

Al revés, las ventas en línea fallarían, y las guardadas sin conexión no subirían hasta
aplicar la migración. Un teléfono con una versión anterior sigue pidiendo la referencia
hasta actualizarse, sin causar errores.

**Costo:**

- Los cobros sin referencia no se pueden cruzar uno a uno con el banco o el proveedor;
  solo por totales del día.
- Una disputa dependería del comprobante en papel.
- Los registros no se pueden editar, así que no se podrá completarlos después.
- Volver a exigirla requeriría otra migración, sin validar las filas ya guardadas.

**Recomendación:** dejarla como campo opcional, en lugar de eliminarla. El vendedor no
queda bloqueado, y quien tenga el número puede anotarlo.

## 3. Conciliación de importes

| Cruce | Hoy | Falta |
|---|---|---|
| Cobros por medio contra total cobrado | `reporte_medios_de_pago()` coincide con `reporte_diario()` | Nada |
| Efectivo contado contra efectivo del reporte | Se ve en el reporte | Registro del arqueo de caja |
| Depósitos de tarjeta y enlace contra lo cobrado | No existe | Registro de liquidaciones del proveedor por fecha, con bruto, comisión real y neto |
| Comisión estimada contra comisión real | Solo la estimada | Sale del registro anterior |

Con referencias opcionales, este cruce por fecha y medio pasa a ser el control principal.
Requiere su propia fase y migración.

## 4. El 7 % adicional al comprador

**No está implementado, y no debe implementarse en tarjeta.**

### Son dos cosas distintas

| | Comisión interna (existe) | Cargo al comprador (solicitado) |
|---|---|---|
| Quién paga | El negocio, al proveedor | El comprador |
| Dónde vive | `tasas_de_comision`, `comisiones_de_cobro` | No existe |
| Cambia el total o la factura | No | Sí |
| Lo ve el vendedor | No | Sí |

Si algún cargo llegara a ser válido, no debe reutilizar esas tablas ni esa tasa: sería un
concepto propio, visible en el documento y dentro del total. La comisión interna no
cambia en ningún caso.

### Lo que dicen las normas revisadas

No es una opinión legal. Debe confirmarla un abogado, porque no se revisó el texto
consolidado de la ley con sus reformas (decretos 33-2013, 57-2017, 141-2021 y 34-2025).

- **[Ley de Tarjetas de Crédito](https://amhon.hn/documentos/leyes/Ley_Tarjetas_Credito.pdf),
  Decreto 106-2006, art. 44 del texto original:** los comercios no podrán aplicar recargos
  que encarezcan el precio para compensar las comisiones de la emisora. Tampoco podrán
  discriminar por pagar con tarjeta en vez de efectivo, en particular en descuentos, ofertas
  y promociones. Comprobada la infracción, se prevé la desafiliación del comercio.
- **[Circular CNBS 006/2025](https://circulares.cnbs.gob.hn/Archivo/Viewer/5681/006-2025%20REFORMAS%20AL%20REGLAMENTO%20DE%20TARJETAS%20CREDITOf.pdf),
  art. 45 reformado del Reglamento, del 12 de junio de 2025:** el comercio afiliado «no podrá
  establecer recargos por el uso de la tarjeta de crédito, financiamiento o débito» (numeral
  3), ni mínimos de compra, ni eliminar descuentos (numeral 5). El artículo excluye del
  comercio electrónico los numerales 4, 6, 7 y 8, **no el 3 ni el 5**.

### Qué significa por caso

| Caso | Lectura | Decisión |
|---|---|---|
| Tarjeta en terminal | Prohibido expresamente | No implementar |
| Enlace pagado con tarjeta | El numeral 3 también aplica al comercio electrónico: muy probablemente prohibido | No implementar sin dictamen escrito |
| Enlace pagado sin tarjeta (billetera, transferencia) | No se encontró norma ni contrato que lo resuelva | Revisar contrato del proveedor y dictamen |
| Cargo oculto, o cobrar distinto de lo facturado | No se acepta, sea cual sea el medio | Nunca |
| Descuento solo por pagar en efectivo | Riesgo por la no discriminación del art. 44 | Consultar antes de usarlo |
| Mínimo de compra con tarjeta | Prohibido, numeral 5 | No implementar |

No se pudo verificar la Ley de Protección al Consumidor (Decreto 24-2008) ni el
tratamiento de un cargo así en el ISV: las búsquedas no dieron el texto.

### Alternativas para absorber el costo

Todas requieren revisión legal y comercial:

1. Negociar la tasa con el proveedor. Un 7 % es alto.
2. Considerar el costo al fijar los precios, iguales para todos los medios.
3. Promover transferencia o efectivo sin penalizar la tarjeta.

### Por qué «7 %» tampoco recupera el 7 %

Si el proveedor cobra sobre lo que paga el comprador, un 7 % encima no cubre la comisión.
Con un total de L 638.25:

| | Comprador paga | Comisión del 7 % | Neto | Diferencia |
|---|---|---|---|---|
| Sin cargo | 638.25 | 44.68 | 593.57 | −44.68 |
| Más 7 % | 682.93 | 47.81 | 635.12 | −3.13 |
| Dividido entre 0.93 (equivale a 7.53 %) | 686.29 | 48.04 | 638.25 | 0.00 |

### Preguntas pendientes

**Para el abogado:**

1. ¿Sigue vigente el art. 44 con ese texto y ese número tras las reformas?
2. ¿Alcanza a un enlace pagado con tarjeta? ¿Y a uno pagado sin tarjeta?
3. ¿Se puede ofrecer un descuento por efectivo?

**Para el contador:**

4. Si un cargo fuera válido, ¿integra la base del ISV? ¿Cómo va en factura y en documento
   interno?

**Para el proveedor de enlace y el de terminal:**

5. ¿El contrato permite cobrarle un cargo al comprador?
6. ¿Sobre qué base se calcula la comisión?
