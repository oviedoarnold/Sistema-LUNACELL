# Guía de ventas sin conexión

Esta guía es para quienes venden en los camiones y la bodega y para los
administradores de LUNACELL.

> **Estado actual:** ninguna ubicación vende sin conexión todavía. La activación
> la hace un administrador ubicación por ubicación, en este orden: Camión 01,
> Camión 02, Lunacell Bodega y, al final, Lunacell Store (después de la revisión
> fiscal).

## Para vendedores

### Antes de salir a ruta

1. Instala LUNACELL en el teléfono ("Agregar a la pantalla de inicio"). Así el
   teléfono conserva mejor las ventas guardadas.
2. Entra con tu usuario **con conexión** y abre **Facturar** unos segundos. Con
   eso se descarga la copia de productos, precios, existencias y clientes de tu
   ubicación.
3. Arriba del POS verás **En línea** y **Sin ventas pendientes**. Si no ves esa
   barra, tu ubicación no está habilitada para vender sin conexión.

### Cuando se va la conexión

- La barra dice **Sin conexión** y aparece el aviso **Modo sin conexión**.
- Vende igual que siempre. El botón ahora dice **Guardar venta sin conexión**.
- Al guardar, recibes un **comprobante provisional** con un número como
  `PROV-AB12-000001`.
  - **No es una factura**: no lleva CAI ni número fiscal.
  - La factura la asigna el servidor al sincronizar.
- **Crédito:** solo a clientes que ya existen y estaban en la copia. Sin
  conexión no se pueden crear clientes nuevos.
- **Existencias:** el disponible es el de la copia, menos lo que ya vendiste
  desde este teléfono. Si otro vendedor vendió lo mismo, el servidor lo
  resuelve al sincronizar.
- **Aviso de copia vieja:** si la copia tiene más de 12 o 24 horas, se avisa.
  No bloquea la venta, pero conéctate en cuanto puedas para actualizarla.

### Cuando vuelve la conexión

- Las ventas se envían **solas**: al volver la señal, al abrir la aplicación, al
  volver a ella desde otra app y cada pocos segundos mientras queden pendientes.
- También puedes pulsar **Sincronizar ahora**.
- En **Ventas sin conexión** ves cada venta con su estado:

| Estado | Qué significa |
|---|---|
| Pendiente | Solo está en el teléfono. Se enviará sola. |
| Sincronizando | Se está enviando. |
| Registrada | El servidor la registró; se ve su número de factura. |
| En conciliación | El servidor la guardó, pero un administrador debe revisarla (por ejemplo, faltaba existencia). Está a salvo: **no la vuelvas a hacer**. |
| Aplicada en conciliación | El administrador la aplicó: ya está en los libros. |
| Anulada en conciliación | El administrador la anuló. Si crees que es un error, consúltalo con él. |
| Error | El servidor no la aceptó tal como está. Avisa al administrador; sigue guardada. |

### Si la venta en línea se queda "pensando"

Si pulsaste **Generar factura** y no hubo respuesta, LUNACELL pregunta qué
hacer:

- **Reintentar:** es seguro. La misma venta no se duplica.
- **Guardar sin conexión:** la guarda en el teléfono. Antes de enviarla se
  comprueba si el primer intento ya se había registrado, para no cobrarla dos
  veces.

### Lo que no debes hacer

- **No borres los datos del navegador** ni desinstales la aplicación mientras
  haya ventas pendientes: se perderían.
- **No cierres sesión** con ventas pendientes si no tienes conexión: no podrás
  volver a entrar hasta que regrese. LUNACELL te avisa antes. Las ventas no se
  borran y se envían cuando vuelvas a entrar con tu usuario.
- Si vas a entregar o cambiar el teléfono, guarda antes un **respaldo cifrado**.

### Respaldo cifrado de emergencia

Úsalo si el teléfono va a pasar días sin conexión, se va a reiniciar o lo vas a
entregar.

1. En **Ventas sin conexión**, pulsa **Respaldo cifrado**.
2. Escribe una frase de al menos 10 caracteres y repítela. Anótala aparte:
   **no se guarda en ningún lado** y sin ella el archivo no se abre.
3. Se descarga un archivo `lunacell-respaldo-….json`.
4. Entrega el archivo y la frase **por separado** al administrador.

Generar el respaldo no borra nada: las ventas siguen en el teléfono y se envían
solas cuando vuelva la conexión.

## Para administradores

### Habilitar una ubicación

La marca `vende_sin_conexion` solo la cambia un administrador en la base. Una
ubicación que emite facturas fiscales no puede tenerla. La activación es parte
de OFF-1.4; esta versión no habilita ninguna.

### Conciliación (menú Administración → Conciliación)

Solo la ven y la usan administradores. Tiene tres pestañas.

**1. Ventas por conciliar.** Son ventas ya cobradas y entregadas que el servidor
no pudo registrar solo, por motivos como estos:

- existencia insuficiente;
- precio distinto;
- reloj del teléfono desfasado;
- ubicación cambiada;
- rescate.

En **Revisar** ves el origen, el vendedor, la ubicación, el dispositivo, las
fechas, los productos con lo que de verdad se cobró, y el motivo con el detalle
del servidor. Elige una acción y escribe el motivo, que es obligatorio y queda
registrado:

| Acción | Qué hace |
|---|---|
| Aplicar | Registra la venta como documento interno, con el vendedor, la ubicación, la fecha y el precio originales. |
| Aplicar con ajuste | Si falta existencia, primero repone exactamente lo que falta (con tu motivo) y después registra la venta. Nunca deja existencias negativas. |
| Anular | La venta no se registra; el registro se conserva con su motivo. |

Detalles a tener en cuenta:

- Cada venta se resuelve **una sola vez**.
- Una venta de una ubicación fiscal no se puede aplicar desde aquí: se anula y
  se emite por el procedimiento fiscal.

**2. Rescate de respaldo.** Para las ventas de un teléfono que no puede
sincronizar.

1. Elige el archivo y escribe la frase. El archivo se abre en tu navegador: ni
   el archivo ni la frase viajan al servidor.
2. Revisa la lista de ventas que trae.
3. Pulsa **Rescatar**. Cada venta queda **en conciliación**; nunca se registra
   directamente.

El resultado se muestra por venta:

| Resultado | Qué significa |
|---|---|
| Quedó en conciliación | La venta se subió y espera tu revisión. |
| Ya estaba registrada | El teléfono la había sincronizado antes; no se duplica. |
| Ya estaba en conciliación | Ya había llegado; no se duplica. |
| Rechazada por el servidor | La clave ya se usó para otra venta o los datos no son válidos. El detalle lo explica. |
| No se envió | Estaba mal formada o repetida en el archivo. |

Lo que ya rescataste en la sesión no se vuelve a enviar.

**3. Auditoría de rescates.** Cada intento de rescate queda registrado,
incluidos los rechazados. Este registro no se puede modificar.

### Ventas de otro usuario en un teléfono

Si un vendedor dejó ventas pendientes y no puede volver a entrar, un
administrador puede entrar en ese mismo teléfono con conexión y abrir
**Facturar → Ventas sin conexión → Respaldo cifrado**. Como administrador, el
respaldo incluye las ventas de todos los usuarios del teléfono. Después las
rescata en **Conciliación → Rescate**.

### Cambiar la ubicación de un vendedor

Si el vendedor trabaja en una ubicación que vende sin conexión, Configuración
avisa antes del cambio. Sus ventas sin sincronizar llegarían a conciliación con
el motivo "ubicación cambiada". Lo ideal es que sincronice antes del cambio.
