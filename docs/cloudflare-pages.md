# Alojamiento en Cloudflare Pages

Desde el 2026-10-29, LUNACELL se sirve desde Cloudflare Pages. El proyecto de
Pages se llama `sistema-lunacell`. Vercel se conserva temporalmente como
respaldo.

| Pieza | Dónde vive |
|---|---|
| Dominio oficial | `https://lunacell.oviedoarnold.lat` |
| Frontend (archivos y funciones del borde) | Cloudflare Pages, proyecto `sistema-lunacell` |
| Base de datos, autenticación, archivos y Edge Functions | Supabase, proyecto `qlzkriyibpbnesidtiiy` |
| Zona DNS de `oviedoarnold.lat` | Vercel DNS (`ns1.vercel-dns.com` y `ns2.vercel-dns.com`) |
| Respaldo del frontend | Vercel, `lunacell.vercel.app`, sin el dominio oficial |
| Código | GitHub, `oviedoarnold/Sistema-LUNACELL` |

El cambio de alojamiento no tocó Supabase. La base de datos, las claves, Auth y
las Edge Functions son las mismas.

## Despliegue desde GitHub

Pages está conectado al repositorio mediante la aplicación de Cloudflare en
GitHub, autorizada solo para `Sistema-LUNACELL`.

- **Cada push a `main` despliega producción.** El commit aparece en GitHub con
  el check **Cloudflare Pages**.
- **Un push a otra rama genera una vista previa** en
  `<rama>.sistema-lunacell.pages.dev`, contra la misma base de producción.
  Ver [Vistas previas y orígenes](#vistas-previas-y-orígenes).
- **Para comprobar qué commit está en producción:**

  ```
  curl https://lunacell.oviedoarnold.lat/api/health
  ```

  `version` son los primeros 7 caracteres del commit desplegado y debe
  coincidir con `main`. La respuesta trae `Server: cloudflare` y un
  encabezado `CF-RAY`.

Mientras se conserve el respaldo, Vercel también despliega `main` por su cuenta.
Esos despliegues no atienden el dominio oficial.

### Configuración del proyecto en Pages

- Rama de producción: `main`.
- Framework preset: `None`.
- Build command: `npm ci --ignore-scripts && npm run build`. Es la misma
  instalación que el CI.
- Build output directory: `dist`.
- Root directory: la raíz del repositorio.

### Variables del build

Se definen en **Settings → Variables and Secrets**, en Production y en Preview:

| Variable | Valor | Para qué |
|---|---|---|
| `NODE_VERSION` | `22` | Pages no lee `engines` de `package.json` |
| `SKIP_DEPENDENCY_INSTALL` | `1` | Evita instalar dos veces: ya lo hace el build command |
| `VITE_SUPABASE_URL` | La URL del proyecto de Supabase | El build y `/api/health` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | La clave **publicable** | El build y `/api/health` |

- Las dos `VITE_` son públicas por diseño: viajan en el JavaScript.
- **Nunca** se pone la clave secreta ni la `service_role`.
- Vite las incorpora al compilar, así que cambiarlas exige volver a desplegar.
- El proyecto de Vercel tiene que tener los mismos valores mientras sea el
  respaldo.
- Detalle de las claves: [Configuración](configuracion.md).

## Qué hace cada archivo

El repositorio mantiene las dos configuraciones, la de Pages y la de Vercel, para
que el respaldo sirva lo mismo:

| En Vercel | En Cloudflare Pages | Qué hace |
|---|---|---|
| `middleware.js` | `functions/[[ruta]].js`, que importa `middleware.js` | Sin la marca de sesión, manda al login con un 307 desde el borde |
| `rewrites` de `vercel.json` (las pantallas privadas) | `functions/[[ruta]].js` | Con la marca, sirve el armazón de la aplicación |
| `rewrites` de `vercel.json` (`/demo` y las subrutas) | `public/_redirects` | Las sirve como la aplicación, sin cambiar la dirección |
| `headers` de `vercel.json` | `public/_headers` | La misma CSP, los mismos encabezados de seguridad y la misma caché |
| `api/health.js` | `functions/api/health.js` | El healthcheck. Los dos usan `api/_salud.js` |
| — | `public/_routes.json` | Limita las funciones a las pantallas privadas y al healthcheck |

`src/routes/despliegueCloudflare.test.js` comprueba que las dos configuraciones
digan lo mismo. Si se agrega una pantalla privada o se cambia un encabezado en
una sola, la prueba falla. Mientras Vercel sea el respaldo, **todo cambio de
rutas o encabezados se hace en los dos lados**.

### Dos diferencias de Pages que ya están resueltas

- **Pages redirige `x.html` a `x`.** Con un 308, `/index.html` va a `/` y
  `/login.html` va a `/login`. El service worker precarga esos dos archivos por su
  nombre, así que guardaría redirecciones, y un navegador no entrega una respuesta
  redirigida a una navegación: sin red, la aplicación instalada no abriría. Por eso
  `_redirects` sirve esos dos archivos con un 200, sin redirección. Está comprobado
  con `wrangler pages dev`: sin esas dos reglas responden 308; con ellas, 200.
- **Con un `404.html` en la raíz, Pages no hace el respaldo de aplicación de una
  sola página.** Vercel se comporta igual: una dirección que no existe responde
  404 con `404.html`, y cada pantalla de la aplicación se declara explícitamente.

## Vistas previas y orígenes

El inicio de sesión pasa por la Edge Function `acceso`, que solo acepta los
orígenes del secreto `ORIGENES_PERMITIDOS` de Supabase. Si el secreto no
existe, acepta solo el dominio oficial.

- **En producción basta con el dominio oficial.** Pages, el respaldo de Vercel
  y la vuelta atrás usan todos el mismo dominio.
- **Los orígenes de `pages.dev` se agregaron solo para las pruebas de la
  migración y se retiran al cerrarla.** Una dirección de rama autorizada
  publica, con cualquier push a esa rama, código que puede iniciar sesión
  contra producción.
- **Nunca un comodín** como `*.pages.dev`: cualquier proyecto ajeno en
  pages.dev podría llamar a la función.
- Cambiar el secreto es un cambio en producción y necesita autorización.

Para cambiarlo:

1. En Supabase, abrir **Edge Functions → Secrets**.
2. Editar `ORIGENES_PERMITIDOS`: orígenes completos, separados por comas, con
   el dominio oficial primero.
3. Guardar. No hace falta volver a desplegar la función, aunque el cambio
   puede tardar unos minutos en llegar a todas las instancias.
4. Comprobar con una consulta previa, que no ejecuta ninguna acción:

   ```
   curl -i -X OPTIONS -H "Origin: https://<origen>" \
     https://qlzkriyibpbnesidtiiy.supabase.co/functions/v1/acceso
   ```

   Un origen aceptado vuelve en `Access-Control-Allow-Origin`. Uno rechazado
   recibe el dominio oficial.

Las vistas previas usan la base de producción: en ellas **no se venden ni se
sincronizan ventas**.

## Recuperación

### Un despliegue malo en Pages

1. En Pages, ir a **Deployments**, elegir el último despliegue de producción
   que funcionaba y usar **Rollback to this deployment**. El cambio es
   inmediato y no toca el DNS.
2. Corregir en una rama y volver a integrar en `main` por PR, como siempre.
   Revertir el commit en `main` también despliega la versión anterior.

### Pages no responde y hay que volver a Vercel

Esta vuelta atrás solo existe mientras Vercel se conserve como se describe en la
sección siguiente.

1. **Antes de cambiar el DNS, comprobar que el último despliegue de producción
   de Vercel corresponde al `main` actual.** Si se desactivaron sus despliegues
   automáticos, primero hay que desplegar `main` en Vercel a mano. Un build
   viejo podría no corresponder al esquema actual de la base.
2. En el DNS de Vercel (**Domains → `oviedoarnold.lat`**), reemplazar el CNAME
   de `lunacell` por el registro que pide Vercel para su proyecto. El valor
   exacto se ve en **Settings → Domains** del proyecto de Vercel; conviene
   anotarlo antes de necesitarlo. El TTL actual del registro es de 60
   segundos.
3. Esperar a que Vercel marque el dominio como válido y sirva el certificado.
4. Comprobar `/api/health`: tiene que responder con `Server: Vercel` y el
   commit correcto. Después, `/login` y el inicio de sesión.

No hace falta tocar Supabase: el dominio es el mismo, así que
`ORIGENES_PERMITIDOS` sigue valiendo.

Para regresar a Pages, se restaura el CNAME hacia `sistema-lunacell.pages.dev`.

**Vercel Hobby es solo para uso personal y no comercial.** Usarlo como
producción es una medida de emergencia y tiene que durar lo mínimo.

### Supabase no responde

Cambiar de alojamiento no lo arregla: el frontend abre, pero no hay datos.
`/api/health` responde 503 e indica qué dependencia falla. Hay que revisar el
estado del proyecto en Supabase.

## PWA y datos sin conexión al cambiar de alojamiento

Las ventas sin conexión viven en IndexedDB del navegador. Su clave es el
**origen** (`https://lunacell.oviedoarnold.lat`), no el servidor. Lo mismo
ocurre con la cookie `lunacell-sesion`, la sesión de Supabase y la caché del
service worker.

**Mientras se conserve el dominio, cambiar de servidor no borra nada.**
**Cambiar de dominio sí deja todo atrás:** cada equipo empezaría vacío y las
ventas pendientes se quedarían en el origen viejo. Por eso el dominio no se
cambia, ni para volver a Vercel ni para ningún otro proveedor.

Precauciones en cada cambio de servidor:

1. **Antes del cambio, sincronizar todo lo pendiente** en cada equipo, con red
   y desde el dominio oficial. Comprobar en Conciliación que no queden ventas
   por resolver.
2. **Hacerlo en un momento sin ventas.** Lo pendiente no se perdería de todos
   modos, pero así no queda nada a medias.
3. **Los dos servidores tienen que servir el mismo commit.** Durante la
   propagación del DNS, un equipo puede ver cualquiera de los dos.
4. **Comprobar que el servidor nuevo cumple lo que necesita el service
   worker:**
   - `sw.js`, `/` e `/index.html` con `Cache-Control: max-age=0, must-revalidate`;
   - `/index.html` y `/login.html` con un 200, sin redirección;
   - las pantallas privadas sin sesión responden 307 a `/login`.

   Si `sw.js` se cacheara, un despliegue nuevo no llegaría a nadie. Si
   `/index.html` llegara redirigido, la aplicación instalada no abriría sin
   red.
5. **Después del cambio, abrir la aplicación con red en cada equipo.** El
   service worker se actualiza solo, porque usa `skipWaiting` y
   `clients.claim`. Las ventas pendientes siguen en IndexedDB y se sincronizan
   como siempre.

Más detalle sobre la PWA: [PWA](pwa.md).

## Costes y límites

Datos de la documentación oficial de Cloudflare, consultada el 2026-10-28.
Conviene revisarlos de nuevo antes de cualquier decisión comercial, porque los
planes cambian.

### Plan gratuito de Cloudflare Pages

- Las peticiones a archivos estáticos y el ancho de banda son **gratuitos e
  ilimitados**.
- **Funciones: 100 000 peticiones al día**, que se reinician a medianoche UTC.
  Aquí solo pasan por una función las navegaciones a las pantallas privadas y
  `/api/health`. Los archivos, el login y los datos, que van directo a
  Supabase, no gastan.
- Si se pasa del límite diario, Workers responde con el error 1027 en esas
  rutas. Para salir de ahí habría que pasar al plan de pago de Workers.
- **10 ms de CPU por petición.** La función solo lee una cookie.
- **500 compilaciones al mes**, una a la vez, de 20 minutos como máximo.
- **20 000 archivos** por sitio y **25 MiB** por archivo. Hoy el build tiene
  menos de 30 archivos y el más grande pesa 1,4 MB.
- **100 dominios propios** por proyecto.
- Las condiciones del plan gratuito no prohíben el uso comercial.

### Lo que el plan gratuito no garantiza

- **No ofrece un acuerdo de nivel de servicio (SLA)** de disponibilidad. Las
  garantías de disponibilidad y el soporte con tiempos de respuesta son de los
  planes empresariales.
- **El soporte del plan gratuito es la documentación y la comunidad.**
- Los límites y las condiciones los puede cambiar Cloudflare.

Para un negocio que depende de vender, eso significa que una caída de Pages se
resuelve con la vuelta atrás de arriba y no con un reclamo al proveedor. Si
LUNACELL pasa a uso comercial con varios clientes, conviene evaluar un plan de
pago.

### Fuera de Cloudflare

- **Supabase** tiene sus propios límites y su propio plan, que se revisan en
  su panel. Si el proyecto estuviera en el plan gratuito, Supabase pausa los
  proyectos sin actividad y las copias de seguridad son limitadas.
- **El dominio** `oviedoarnold.lat` se renueva con el registrador. Si caduca,
  la aplicación deja de responder, esté donde esté.
- **Vercel Hobby** no cobra: al llegar a un límite, se detiene. Conviene
  confirmar que la cuenta no tenga un plan de pago ni un método de pago
  activo.

## Retiro de Vercel

**La zona DNS de `oviedoarnold.lat` está en Vercel.** Si se borra el dominio
de la cuenta de Vercel, o la cuenta entera, se pierde el DNS y la aplicación
deja de responder, aunque Pages siga funcionando.

Mientras sea el respaldo:

- No quitar el dominio de la cuenta ni del proyecto de Vercel.
- No borrar el proyecto ni sus variables de entorno.
- Para dejar de compilar en cada push sin perder el respaldo, se puede usar
  **Settings → Git → Ignored Build Step** con `exit 0`. El último despliegue
  sigue disponible, pero hay que actualizarlo antes de usarlo; ver
  [Recuperación](#recuperación).

Orden previsto para retirarlo, con autorización en cada paso:

1. Un periodo estable en Pages.
2. Desactivar los despliegues automáticos de Vercel.
3. Mover la zona DNS fuera de Vercel, a Cloudflare o al registrador, con los
   mismos registros.
4. Solo después, quitar el dominio y el proyecto de Vercel. Con eso se pueden
   retirar `vercel.json`, `api/health.js` y la parte de la prueba de paridad
   que los compara. `middleware.js` se queda, porque lo importa
   `functions/[[ruta]].js`.

## Historia de la migración

| Fecha | Paso |
|---|---|
| 2026-10-28 | PR #69 integrado en `main` (`7818043`): configuración de Pages junto a la de Vercel, probada antes en `pages.dev` |
| 2026-10-29 | El CNAME de `lunacell` pasa a `sistema-lunacell.pages.dev`. Certificado de Google Trust Services emitido por Pages. `/api/health` responde desde Cloudflare con `7818043` |
