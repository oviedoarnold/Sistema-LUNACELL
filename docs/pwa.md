# PWA y funcionamiento sin conexión

## Datos exactos

| Dato | Valor |
|---|---|
| Ruta del service worker | `public/sw.js` → servido en `/sw.js` |
| Nombre del caché en `caches.open()` | `lunacell-v1` |
| Manifest | `public/manifest.webmanifest` → servido en `/manifest.webmanifest` |
| `id` | `/` (identidad de la app instalada; no cambia con `start_url`) |
| `start_url` | `/pos`: con red y sin sesión, el middleware la manda al login; sin red, entra al POS con el perfil sin conexión vigente |
| `scope` | `/` |
| `display` | `standalone` |
| Iconos | 192×192, 512×512 y 512×512 maskable |
| Registro | `src/registrarServiceWorker.js`, llamado desde `src/main.jsx` |
| Actualización | `src/components/AvisoDeActualizacion.jsx` y `src/lib/actualizacion/` |
| Versión publicada | `/version.json`, sin caché |

## Estrategia principal

**Stale-while-revalidate** sobre los archivos propios del sitio.

Se responde de inmediato con lo que hay en caché y en segundo plano se descarga la
versión nueva para el próximo arranque. En un mostrador importa más abrir rápido que
tener el último byte: el cajero necesita cobrar, no la versión más reciente del CSS.

La navegación tiene un caso aparte: siempre resuelve a `/index.html`, porque la
aplicación es de una sola página y el enrutado ocurre en el navegador. Si no hay red
ni copia en caché, se sirve `/offline.html`.

Como `/index.html` solo se guarda una página servida bien y sin redirección: el 307
del middleware hacia `/login` no se guarda, porque sin red la aplicación respondería
con esa redirección en vez de abrir.

## Actualización automática

Cuando se publica una versión nueva, la aplicación abierta avisa y se instala sola
en 15 segundos. El vendedor no pulsa nada y no puede posponerla.

**Cómo sabe que hay versión nueva.** La compilación escribe su versión en dos
lugares: dentro del JavaScript y en `/version.json`. Las dos salen del mismo commit y
con la misma forma que `/api/health` (`scripts/versionDeLaCompilacion.mjs`). La
aplicación compara la suya con la publicada al abrir, al volver a la pestaña, al
recuperar la conexión y cada cinco minutos con la pantalla a la vista, con un mínimo de
un minuto entre consultas.

`/version.json` se sirve con `no-store` y el service worker no lo guarda. No se usa
`/api/health` para esto, porque revisa la base y la autenticación en cada llamada.

**La cuenta.** Aparece «Hay una nueva versión de LUNACELL disponible. Se instalará
automáticamente en 15 segundos.» y cuenta hasta cero. Al llegar a cero:
- Si hay un service worker nuevo esperando, se le pide que se active (`{tipo: "ACTIVAR"}`).
- La página se recarga cuando el service worker nuevo ya la controla.

**Lo que no se interrumpe.** Mientras exista alguna de estas operaciones, la cuenta
termina pero la recarga espera, con el aviso «Actualización pendiente. Se instalará
automáticamente al finalizar la operación actual.»:
- un carrito con productos: venta, pedido, cotización o precio negociado;
- una venta o un pedido enviándose;
- un abono abierto;
- la factura de un pedido en curso;
- una sincronización de ventas sin conexión.

En cuanto termina, se instala sola. Cada pantalla marca su operación con
`useBloqueoDeActualizacion`. Sin conexión también espera, y se instala al recuperarla.

**Lo que se conserva.** La recarga no borra `localStorage`, la base local (perfil y
ventas sin conexión) ni la sesión.

**Sin ciclos.** Si después de recargar sigue la versión vieja, no vuelve a recargar
enseguida. Espera 2, 4, 8… minutos, hasta un máximo de 30, y sigue intentándolo. El
registro vive en `sessionStorage` y se borra al llegar a la versión buscada.

**El service worker.** Ya no se activa solo al instalarse. Precarga la versión nueva y
espera a que la aplicación le diga que es seguro. La primera instalación no espera.

### Instalaciones anteriores al aviso (antes del PR #89)

Una PWA instalada casi nunca se recarga. Al tocar el ícono, el sistema retoma la ventana
que estaba en segundo plano, con el JavaScript que ya tenía. El código anterior al PR #89
no sabe buscar versiones ni pedirle al service worker que se active. Por eso esas
instalaciones seguían en la versión vieja aunque el navegador ya mostrara la nueva: abrir
la dirección en el navegador es siempre una navegación nueva, y retomar la PWA no.

El service worker las recarga él mismo:

- **Reconoce las páginas antiguas.** Pregunta a cada ventana `{tipo: "IDENTIFICATE"}`.
  Las actuales contestan `{tipo: "SOY_ACTUAL"}` (`src/registrarServiceWorker.js`) o
  consultan `/version.json`, y nunca se recargan desde ahí: se actualizan con su
  propio aviso.
- **Se activa aunque nadie se lo pida.** Si ninguna página abierta contesta, se activa
  solo al instalarse, porque nadie le pediría hacerlo. Si hay una página actual abierta,
  espera su orden, que protege el carrito.
- **Juzga solo con la página a la vista.** Una página oculta puede estar congelada por el
  sistema y no contestar.
- **Recarga en un momento seguro.** Una página antigua se recarga cuando pasa a segundo
  plano, nunca mientras se usa, y solo si no envió nada (una venta, un cobro) en los
  últimos 15 segundos. Si ya estaba en segundo plano cuando se activó la versión nueva,
  se recarga en cuanto vuelve a abrirse.
- **Conserva los datos.** La recarga no borra la sesión, `localStorage` ni la base local
  con las ventas sin conexión.

**Límites:**

- **Cuándo llega la versión nueva.** El navegador revisa el service worker al navegar o,
  como máximo, una vez cada 24 horas mientras la aplicación hace peticiones. Una
  instalación que solo se retoma recibe la versión nueva dentro de ese plazo.
- **Carrito en memoria.** El código anterior al PR #89 no avisa de su carrito. Si una
  venta quedó a medio armar y la app pasa a segundo plano, al recargarse se pierde ese
  carrito no enviado. Lo que se guardó, incluidas las ventas sin conexión, se conserva.

Desde que corre el código nuevo, cada actualización usa el aviso de 15 segundos.

## Dominio oficial

La aplicación se usa e instala solo desde `https://lunacell.oviedoarnold.lat`,
que hoy sirve Cloudflare Pages (ver [Alojamiento](cloudflare-pages.md)).

La aplicación también responde en direcciones técnicas, que **no son
direcciones de acceso**:

- `sistema-lunacell.pages.dev` y las vistas previas `*.sistema-lunacell.pages.dev`,
  de Cloudflare;
- `lunacell.vercel.app`, del respaldo en Vercel.

La función `acceso` solo acepta los orígenes de `ORIGENES_PERMITIDOS`, y sin ese
valor solo el dominio oficial. Desde una dirección que no esté en la lista no se
puede iniciar sesión.

Cada dominio es un origen distinto para el navegador: la cookie
`lunacell-sesion`, la sesión de Supabase, la caché del service worker y la base
local (perfil sin conexión y ventas pendientes) no se comparten. Una PWA
instalada desde otra dirección es otra aplicación, con sus propios datos, aunque
deje iniciar sesión.

Por la misma razón, **cambiar de servidor no borra nada si se conserva el
dominio**, y cambiar de dominio deja atrás las ventas pendientes. Las
precauciones para cambiar de servidor están en
[Alojamiento](cloudflare-pages.md#pwa-y-datos-sin-conexión-al-cambiar-de-alojamiento).

## Qué funciona sin Internet

- **Abrir la aplicación completa.** El HTML, el JavaScript, los estilos y los iconos
  están en caché, así que la pantalla carga sin red.
- **Instalarla como aplicación** en el escritorio o en el teléfono.

Nada más. Al mover los datos a PostgreSQL, facturar, cotizar, consultar el
inventario e iniciar sesión **pasaron a requerir conexión**. Antes funcionaban sin
red porque todo vivía en el navegador; esa es la contraparte de que dos cajas
compartan el mismo inventario.

## Qué no funciona sin Internet, y por qué se puso ahí la frontera

- **Las tipografías de Google.** Se cargan desde `fonts.googleapis.com`. Sin red el
  navegador cae en la tipografía de respaldo declarada en cada familia. Se decidió
  no empaquetarlas para no sumar cientos de kilobytes al primer arranque, que es
  justo cuando el cajero está esperando.
- **La primera visita.** Un equipo que nunca abrió el sistema no tiene nada en caché.
  El service worker se instala en la primera carga con red.
- **Facturar, cobrar y consultar datos.** Todo pasa por PostgREST. Sin red la
  pantalla abre pero no hay con qué llenarla.

**Actualización (OFF-1.3):**

- Las ubicaciones habilitadas para vender sin conexión pueden facturar sin
  Internet desde el POS.
- La venta se guarda en el teléfono con un comprobante provisional y se
  sincroniza sola al volver la conexión.
- Ver [guia-ventas-sin-conexion.md](guia-ventas-sin-conexion.md) y
  [ventas-sin-conexion.md](ventas-sin-conexion.md).
- Las demás pantallas siguen necesitando conexión.

Esto es un retroceso deliberado y no es el estado final. **Cobrar no debería
depender del Internet**: un mostrador desconectado tiene que poder facturar, y que
esa factura tarde unos minutos en aparecer en la computadora del dueño es
aceptable. Lo que falta para volver a esa frontera es una caché local con cola de
sincronización, que el [ADR-1](adr/adr-001-postgresql-multiempresa.md) ya
anticipaba. Mientras no exista, un negocio con Internet inestable va a sentirlo,
y conviene decírselo antes de venderle el sistema.

## Verificación pendiente

La activación del service worker **no se pudo confirmar en Chrome headless**: el
registro resuelve correctamente pero el navegador no persiste la instalación ni
crea el caché en ese modo. Lo verificado hasta ahora:

- `sw.js` se sirve con `Content-Type: text/javascript` y sintaxis válida
- El manifest se sirve y parsea, con los tres iconos accesibles
- El código de registro está en el bundle de producción y se ejecuta
- `offline.html` se sirve correctamente

**Queda confirmar en un navegador real** que el service worker se instala, que el
caché `lunacell-v1` se crea y que la aplicación abre sin conexión. Esa comprobación
coincide con la evidencia que pide el requisito 12: la PWA instalada en un teléfono
real.
