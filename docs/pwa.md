# PWA y funcionamiento sin conexión

Código de verificación: `LEARN-CAP-50768C03`

## Datos exactos

| Dato | Valor |
|---|---|
| Ruta del service worker | `public/sw.js` → servido en `/sw.js` |
| Nombre del caché en `caches.open()` | `ferreteria-v1` |
| Manifest | `public/manifest.webmanifest` → servido en `/manifest.webmanifest` |
| `start_url` | `/` |
| `scope` | `/` |
| `display` | `standalone` |
| Iconos | 192×192, 512×512 y 512×512 maskable |
| Registro | `src/registrarServiceWorker.js`, llamado desde `src/main.jsx` |

## Estrategia principal

**Stale-while-revalidate** sobre los archivos propios del sitio.

Se responde de inmediato con lo que hay en caché y en segundo plano se descarga la
versión nueva para el próximo arranque. En un mostrador importa más abrir rápido que
tener el último byte: el cajero necesita cobrar, no la versión más reciente del CSS.

La navegación tiene un caso aparte: siempre resuelve a `/index.html`, porque la
aplicación es de una sola página y el enrutado ocurre en el navegador. Si no hay red
ni copia en caché, se sirve `/offline.html`.

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

Esto es un retroceso deliberado y no es el estado final. **Cobrar no debería
depender del Internet**: un mostrador desconectado tiene que poder facturar, y que
esa factura tarde unos minutos en aparecer en la computadora del dueño es
aceptable. Lo que falta para volver a esa frontera es una caché local con cola de
sincronización, que el [ADR-1](adr/adr-001-postgresql-multiempresa.md) ya
anticipaba. Mientras no exista, una ferretería con Internet inestable va a sentirlo,
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
caché `ferreteria-v1` se crea y que la aplicación abre sin conexión. Esa comprobación
coincide con la evidencia que pide el requisito 12: la PWA instalada en un teléfono
real.
