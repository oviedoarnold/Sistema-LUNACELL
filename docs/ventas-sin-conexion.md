# Ventas sin conexión — motor del dispositivo (OFF-1.2)

El servidor (OFF-1.1, migraciones 0027–0029) ya acepta ventas hechas sin
conexión de forma idempotente y manda a conciliación las que no cuadran. Este
documento describe la otra mitad: lo que corre en el teléfono. La pantalla del
POS que lo usa llega en OFF-1.3. **Ninguna ubicación está habilitada**
(`ubicaciones.vende_sin_conexion = false` en todas).

Orden previsto de activación (OFF-1.4): Camión 01 → Camión 02 → Lunacell
Bodega → Lunacell Store. Store va al final, tras la revisión fiscal.

## Piezas (`src/lib/sinConexion/`)

| Archivo | Qué hace |
|---|---|
| `almacen.js` | IndexedDB `lunacell-sin-conexion`: almacenes `meta`, `ventas` y `copias`. Cada operación es una transacción; si algo falla, no queda nada a medias. |
| `dispositivo.js` | Identificador único y permanente del dispositivo (UUID), más un código corto para el comprobante. Varios dispositivos por ubicación son normales. |
| `copiaLocal.js` | Copia de productos, existencias y clientes que el dispositivo descargó con conexión. Una por empresa + usuario + ubicación: cambiar de usuario o de ubicación nunca mezcla datos. Avisa si la copia es vieja (12 h leve, 24 h fuerte). |
| `venta.js` | Arma la venta local y valida: copia del mismo usuario y ubicación, ubicación habilitada, productos de la copia, crédito solo a clientes registrados. Totales en centavos. |
| `cola.js` | La cola durable. Clave de idempotencia única por venta (`off-<dispositivo>-<uuid>`), número provisional interno `PROV-XXXX-000001` (no fiscal), control de existencias locales y estados. |
| `clasificar.js` | Traduce cada respuesta y cada error del servidor a lo que hay que hacer. |
| `candado.js` | Solo una pestaña sincroniza a la vez (Web Locks, o un turno con vencimiento en IndexedDB). |
| `sincronizador.js` | La ronda: envía en orden las ventas pendientes del usuario en sesión y guarda la respuesta. |
| `conectividad.js` | Cuándo sincronizar: al iniciar, al volver la red, al volver a primer plano, periódicamente con pendientes, con espera progresiva tras fallos y a mano. |
| `exportacion.js` | Archivo de emergencia cifrado (AES-GCM, llave por PBKDF2-SHA-256). |

`src/lib/api/ventasSinConexion.js` convierte una venta en los parámetros
exactos de `sincronizar_venta_sin_conexion` y `rescatar_venta_sin_conexion`.

## Estados de una venta

```
pendiente ──► sincronizando ──► registrada          (final)
    ▲               │      └──► en_conciliacion     (final)
    └───────────────┤
                    └──► error  (rechazo; reintento solo manual)
```

- **pendiente**: guardada en el teléfono y aún no confirmada por el servidor.
- **sincronizando**: se está enviando. Si la app se cierra en este estado, al
  abrir vuelve a pendiente y se reenvía **con la misma clave**: el servidor
  responde `ya_registrada` y no duplica.
- **registrada**: el servidor la registró como venta, con su número de
  factura.
- **en_conciliacion**: el servidor la guardó para que un administrador la
  revise (sin existencias, precio distinto, reloj desfasado…). Está a salvo;
  no se reenvía.
- **error**: el servidor la rechazó por su contenido (OF001, OF003). Sigue
  guardada y se puede reintentar con la sincronización manual o exportar.

Una venta solo deja de estar pendiente cuando el servidor responde que la
tiene. **El motor nunca borra una venta sin confirmación.**
`limpiarConfirmadas` solo quita ventas en estado final confirmadas antes de
una fecha dada. Esa limpieza es opcional y la decide OFF-1.3.

## Qué se hace ante cada error

| Clase | Ejemplos | Acción |
|---|---|---|
| red | sin conexión, tiempo agotado, 502/503/504 | La venta vuelve a pendiente y la ronda se detiene; se reintenta con espera progresiva (5 s, 15 s, 30 s, 60 s y después cada 2 min). |
| sesion | 401, JWT vencido, 42501 | La venta vuelve a pendiente y la ronda se detiene hasta que el usuario inicie sesión. |
| otro_usuario | OF002 | La venta vuelve a pendiente: espera a que su dueño inicie sesión. |
| rechazo | OF001, OF003 | Pasa a error, y las demás ventas siguen. |
| temporal | cualquier otro | La venta vuelve a pendiente, y las demás ventas siguen. |

## Límites del navegador (importante para OFF-1.3 y OFF-1.4)

**El almacenamiento del navegador no es un disco seguro.**

- El navegador puede borrar IndexedDB cuando el teléfono se queda sin
  espacio, y el usuario también puede borrarlo al limpiar los datos del
  sitio.
- Safari (iOS) borra los datos de un sitio que no se usa durante 7 días,
  salvo que la app esté instalada en la pantalla de inicio.
- `navigator.storage.persist()` pide que no se borre. Chrome y Android lo
  conceden a las apps instaladas o muy usadas; Safari no lo garantiza.
- **Mitigaciones previstas:**
  - instalar la PWA en los teléfonos de los camiones;
  - pedir `persist()` al activar el modo;
  - mostrar el aviso de pendientes;
  - usar el archivo de emergencia cifrado.

**No hay sincronización garantizada en segundo plano.**

- Con la app cerrada o en segundo plano, el navegador congela los
  temporizadores y las peticiones.
- La Background Sync API solo existe en Chrome y Android, y no en iOS.
- Por eso el motor sincroniza cuando la app vuelve a primer plano y cuando
  vuelve la red. Las ventas esperan seguras hasta entonces.
- Si se agrega Background Sync en el futuro, debe ser una mejora y no el
  mecanismo principal.

**`navigator.onLine` no prueba que haya internet.**

- Solo indica que hay una interfaz de red. Con un wifi sin salida o con un
  portal cautivo dice "en línea".
- El motor lo usa únicamente para no intentar cuando dice "sin red".
- Antes de cada ronda pregunta al servidor (`/auth/v1/health`, con 5 s de
  límite).

**Reloj del teléfono.**

- La hora de la venta es la del teléfono.
- Al sincronizar se envía también la hora del envío, y con ella el servidor
  mide el desfase.
- Si el desfase supera 10 min, la venta va a conciliación como
  `reloj-desfasado`. La fecha no se corrige automáticamente.

## Archivo de emergencia

- **Cifrado:** AES-GCM de 256 bits, que detecta cualquier alteración.
- **Llave:** se deriva de una frase de al menos 10 caracteres con PBKDF2-SHA-256
  (310 000 iteraciones), usando una sal aleatoria por archivo.
- **La frase:** no se guarda en ningún lado.
- **Exportar no borra:** las ventas siguen en el teléfono hasta que el
  servidor las confirme.
- **Rescate:** un administrador lo sube con `rescatar_venta_sin_conexion`.
  Esa RPC usa la misma clave de idempotencia, por lo que una venta que el
  teléfono también sincronice no se duplica.
- La pantalla de exportar y rescatar es parte de OFF-1.3.

## Comprobante provisional

- El número `PROV-XXXX-000001` es **interno y no fiscal**: `XXXX` es el
  código corto del dispositivo y el correlativo es local.
- No usa ni reserva correlativos del CAI.
- El número de factura real lo asigna el servidor al registrar.
