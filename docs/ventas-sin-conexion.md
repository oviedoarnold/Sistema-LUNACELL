# Ventas sin conexión — motor del dispositivo (OFF-1.2)

El servidor (OFF-1.1, migraciones 0027–0029) ya acepta ventas hechas sin
conexión de forma idempotente y manda a conciliación las que no cuadran. Este
documento describe la otra mitad: lo que corre en el teléfono (motor, OFF-1.2)
y su integración con el POS y la conciliación (OFF-1.3). **Ninguna ubicación está habilitada**
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
| `candado.js` | Solo una pestaña sincroniza a la vez (Web Locks, o un turno de 60 s en IndexedDB que se renueva antes de cada envío; si otra pestaña lo tomó al vencer, la ronda vieja se detiene). |
| `sincronizador.js` | La ronda: envía en orden las ventas pendientes del usuario en sesión y guarda la respuesta. Cada envío tiene un límite de 30 s: si el servidor no responde, la petición se aborta y la venta queda pendiente (cuenta como falta de red). Cada venta se toma y se suelta en una transacción que mira su estado actual: una venta confirmada por otra pestaña no se reenvía ni retrocede. |
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
- **Importar valida antes de calcular:**
  - antes de derivar la llave, comprueba el formato, el algoritmo y las iteraciones (entero entre 310 000 y 1 000 000);
  - comprueba también la sal (16 bytes), el iv (12 bytes), los datos en base64 y el tamaño del archivo (20 MB como máximo);
  - un archivo manipulado se rechaza con un mensaje claro y nunca congela el navegador;
  - importar solo lee: no toca la cola del teléfono.
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

## Integración con el POS (OFF-1.3)

La guía de uso para vendedores y administradores está en
[guia-ventas-sin-conexion.md](guia-ventas-sin-conexion.md).

### Piezas

| Archivo | Qué hace |
|---|---|
| `src/context/SinConexionContext.jsx` | Une motor, sesión y pantalla: comprueba que el servidor responda, descarga la copia local, sincroniza sola y a mano, guarda ventas, exporta el respaldo, pide almacenamiento persistente y avisa si hay una versión nueva del almacén. Sin este proveedor, el POS funciona solo en línea, exactamente como antes. |
| `src/lib/api/copiaSinConexion.js` | Descarga la copia de la ubicación del vendedor con las mismas consultas que usa la aplicación. Trae catálogo, existencias y clientes solo si la ubicación está habilitada. Nunca habilita una ubicación fiscal. |
| `src/lib/sinConexion/perfilLocal.js` y `sesionSinConexion.js` | Perfil para entrar al POS sin conexión. |
| `src/lib/sinConexion/rescate.js` | Rescate administrativo: validación, duplicados y la respuesta `rechazado`. |
| `src/lib/api/conciliacion.js` | Ventas por conciliar, `conciliar_venta` y la auditoría de rescates. |
| `src/pages/POS.jsx` y `src/components/sinConexion/` | Modo sin conexión del POS, comprobante provisional, barra de estado, ventas del teléfono y respaldo cifrado. |
| `src/pages/Conciliacion.jsx` y `src/components/conciliacion/` | Pantalla administrativa en `/reconciliation`, solo para administradores. |

### Cuándo el POS vende sin conexión

Se cumplen las dos condiciones:

- **No hay servidor:** `navigator.onLine` es falso, `/auth/v1/health` no
  responde, o la sesión es el perfil sin conexión.
- **La copia local permite vender:** la ubicación tiene `vende_sin_conexion`,
  está activa, vende y no es fiscal.

Sin servidor y sin habilitación, el POS bloquea la venta y explica por qué. Con
servidor, el POS es el de siempre.

### Entrar sin conexión

Sin red, Supabase no puede renovar el token y la sesión se ve vacía. Para que el
vendedor pueda entrar, cada vez que el servidor confirma su perfil se guarda lo
mínimo:

- empresa;
- usuario;
- ubicación;
- rol y permisos.

No se guarda el correo. Ese perfil se usa solo si:

- el navegador todavía guarda la sesión del **mismo** usuario (Supabase la borra
  al cerrar sesión o si el servidor la revoca), y
- el servidor **no respondió** (falta de red). Si respondió que no hay perfil,
  no se usa.

Con ese perfil (`sinConexion: true`) solo se abre el POS y las demás pantallas
quedan ocultas. Vence a los 7 días de la última confirmación y se borra al
cerrar sesión. Para **enviar** ventas hace falta una sesión real del mismo
usuario: el sincronizador la pide a Supabase y el servidor vuelve a comprobarla.
Al volver la conexión, el perfil se confirma solo.

### Revocaciones mientras no hay conexión (límite inevitable)

Sin conexión no hay forma de saber si a un vendedor le quitaron el acceso: el
teléfono no puede preguntarle al servidor. Para que el perfil guardado no se
convierta en una forma de conservar permisos revocados:

- **Vigencia corta:** el perfil vale 7 días desde la última vez que el servidor
  lo confirmó. Se comprueba al entrar y también con la aplicación abierta: al
  vencer, deja de facturar sin necesidad de recargar.
- **El servidor manda en cuanto responde:**
  - si dice que la cuenta ya no tiene acceso (desactivada o sin perfil), se
    borran en el acto el perfil guardado y la copia local de ese usuario, y la
    sesión se cierra;
  - si le quitaron el permiso de POS, el perfil guardado se actualiza y sin
    conexión ya no puede facturar.
- **El perfil no da acceso al servidor:**
  - no es una sesión ni un token: solo abre el POS local;
  - cada RPC sigue usando la sesión real de Supabase y el servidor comprueba
    quién envía;
  - una venta hecha con un acceso revocado llega a conciliación (por ejemplo,
    "usuario-inactivo", "sin-permiso" o "ubicacion-cambiada") y no se aplica
    sola.
- **Riesgo que queda:** hasta 7 días de ventas sin conexión de alguien a quien
  se le revocó el acceso mientras estaba sin red. Todas quedan registradas y
  van a conciliación.
- **Mitigación operativa:**
  - al retirar a un vendedor, desactivarlo y pedirle el teléfono;
  - si no se puede, rescatar sus ventas con un respaldo cifrado.
- **Reloj del teléfono:** la vigencia se mide con ese reloj. Atrasarlo no sirve
  para alargarla sin control, porque el servidor rechaza a conciliación las
  ventas con el reloj desfasado o con más de 7 días.

### Datos al cerrar sesión

- **Se borran:** el perfil sin conexión y la copia local del usuario (catálogo,
  precios y clientes).
- **Se conservan:** sus ventas sin sincronizar. Se envían cuando vuelva a entrar
  con conexión, o un administrador las rescata con un respaldo cifrado.


### Venta en línea sin respuesta

`crearVenta` distingue "sin respuesta" (red caída o tiempo agotado) de un
rechazo. Con la ubicación habilitada, el POS ofrece dos opciones:

- **Reintentar** con la misma clave: es idempotente.
- **Guardar sin conexión:** la venta local lleva `claveEnLinea`. Antes de
  enviarla, el sincronizador busca esa clave en `ventas`. Si el intento en línea
  se registró, la venta local queda **registrada con esa factura y no se
  envía**. Si no se puede comprobar, espera. Nunca se envía a ciegas.

El vendedor ve las ventas de su ubicación (0029), que es donde quedó el intento.

### Copia local

- Se descarga con servidor, como máximo cada 15 minutos.
- Se descarga además al cambiar de usuario o de ubicación, después de cada venta
  en línea y después de sincronizar ventas.
- `tomadaEn` se fija antes de descargar, para no dejar sin descontar una venta
  confirmada durante la descarga.

### Límites conocidos

- **Venta en línea interrumpida y reasignación de ubicación:** si el vendedor
  cambia de ubicación antes de sincronizar, la verificación no ve la venta
  original. La venta local llega al servidor y queda en conciliación ("ubicación
  cambiada"). Su nota dice "Intento en línea sin respuesta: <clave>", y el
  administrador la anula si estaba duplicada.
- **Entrar sin conexión:** solo funciona si el usuario ya entró con conexión en
  ese teléfono durante los últimos 7 días.
- **Navegador y PWA:** valen los límites de arriba (almacenamiento que el
  navegador puede borrar, sin sincronización en segundo plano). Por eso existen
  el respaldo cifrado y los avisos al cerrar sesión.
