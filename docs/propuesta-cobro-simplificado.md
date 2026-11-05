# Propuesta: cobro simplificado en el POS

Estado: el cálculo automático del pago mixto está publicado. Las referencias opcionales
están en la migración 0040 y su frontend. Cualquier cargo al comprador sigue sin hacerse
y necesita decisión.

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

## 2. Referencias opcionales

Quitarlas solo de la pantalla habría hecho fallar las ventas por transferencia, tarjeta y
enlace. La 0039 las exige en dos sitios, y la 0040 cambia los dos:

| Dónde | Regla | Efecto si llega vacía |
|---|---|---|
| `medios_de_cobro_invalidos()` | Referencia obligatoria si el medio no es efectivo | `LM001` en línea, `OF001` sin conexión: la venta queda en el teléfono sin subir |
| Restricción `cobros_por_medio_referencia` | `btrim(referencia) <> ''` si el medio no es efectivo | Rechaza la fila aunque la función la deje pasar |

Rellenarla con un texto fijo como «SIN REFERENCIA» pasaría la validación, pero dejaría
un dato falso en un registro que no se puede corregir. No se propone.

Se conservan el medio válido, el importe positivo, la suma exacta, que el efectivo no
lleve referencia y el largo máximo. `medios_sin_conexion_invalidos()` usa la misma
función, así que las ventas sin conexión quedan cubiertas sin tocarla.

**Orden obligatorio:**

1. Aplicar la 0040. Las versiones actuales siguen funcionando, porque mandan referencia.
2. Publicar el frontend que deja de exigirla, en `problemaDeCobros()` y en el selector.

Al revés, las ventas en línea fallarían, y las guardadas sin conexión no subirían hasta
aplicar la migración. Un teléfono con una versión anterior sigue pidiendo la referencia
hasta actualizarse, sin causar errores.

**Costo:**

- Los cobros sin referencia no se pueden cruzar uno a uno con el banco o el proveedor;
  solo por totales del día.
- Una disputa dependería del comprobante en papel.
- Los registros no se pueden editar, así que no se podrá completarlos después.
- Volver a exigirla requeriría otra migración, sin validar las filas ya guardadas.

El campo sigue visible como opcional: el vendedor no queda bloqueado, y quien tenga el
número puede anotarlo.

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

Implementado por decisión del negocio en la 0041, que además retiró la comisión interna.
Ver `medios-de-pago.md`. El negocio aceptó el riesgo legal descrito aquí, sin dictamen.

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

| Caso | Lectura 
No se pudo verificar la Ley de Protección al Consumidor (Decreto 24-2008) ni el
tratamiento de un cargo así en el ISV: las búsquedas no dieron el texto.


