# Requisitos pendientes

Lo que el negocio necesita y el sistema todavía no hace. No es deuda
técnica —eso vive en [Deuda técnica](deuda-tecnica.md), donde se anota lo
que está mal escrito—: aquí va lo que está bien escrito pero no existe.

La lista se escribe cuando el requisito aparece, aunque no toque
construirlo todavía. Un requisito detectado y no anotado se pierde.

Cuando algo de aquí se implemente, se borra de la lista.

---

## Cuentas por cobrar consolidadas por cliente

**Detectado.** 18 de septiembre de 2026, durante la validación visual de
la Fase E (formularios y modales). El requisito salió al revisar la
ventana de abonos, no de un fallo: lo que hay funciona, pero no es lo que
el negocio necesita.

**Qué hace hoy el sistema.** El historial presenta las facturas a crédito
una por una. Cada abono se registra contra una factura concreta: se abre
su ventana, se escribe el monto y el saldo de *esa* factura baja. Si un
cliente tiene cuatro facturas pendientes, hay que abrir cuatro ventanas y
repartir el pago a mano.

**Qué necesita LUNACELL.**

- Consolidar la deuda por **cliente**, no por factura.
- Ver el saldo pendiente total de ese cliente.
- Ver todas sus facturas pendientes en un solo sitio.
- Registrar **un abono global** al cliente.
- Distribuir ese abono internamente entre sus facturas pendientes.
- Conservar la trazabilidad por factura y por abono: de un pago global
  hay que poder decir cuánto fue a cada factura.
- Mantener el histórico.
- Cerrar cada factura conforme queda cubierta.

**Por qué duele.** Un cliente que paga no paga facturas, paga lo que
debe. Obligar al cajero a repartir el pago a mano invita a dos errores
que el sistema no puede detectar después: repartir mal y dejar una
factura abierta que ya estaba pagada.

**Por qué no se hizo en la Fase E.** Esa fase era deliberadamente
estética: presentación, consistencia y accesibilidad, sin tocar reglas de
negocio. Meter aquí el reparto de abonos habría cambiado cómo se aplica
el dinero de un cliente dentro de una rama que nadie revisó con esa
intención.

**Qué implica hacerlo.** No es una pantalla: es una regla de negocio.
Hay que decidir y dejar escrito el **orden de aplicación** —lo más
probable es que sea la factura más antigua primero, pero eso se decide,
no se asume—, qué pasa cuando el abono excede la deuda total, y cómo se
deshace un abono global ya repartido. Toca el modelo de datos (un abono
deja de pertenecer a una factura para pertenecer a un cliente y tener
renglones), la capa de ventas y los saldos. Pide su propia fase, con sus
pruebas de reparto antes que su interfaz.

**Qué no debe hacerse por el camino.** Cambiar cómo se calcula el saldo
de una factura suelta, ni tocar los correlativos ni la facturación
fiscal. El reparto es una capa por encima de lo que ya existe.
