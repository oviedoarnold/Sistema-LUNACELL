# Cloudflare Pages

LUNACELL puede servirse desde Cloudflare Pages con la misma compilación que hoy
publica Vercel. Las dos configuraciones conviven: Vercel sigue siendo producción
hasta que se apruebe el cambio, y Pages se prueba antes en una dirección
`*.pages.dev`.

## Qué hace cada archivo

| En Vercel | En Cloudflare Pages | Qué hace |
|---|---|---|
| `middleware.js` | `functions/[[ruta]].js`, que importa `middleware.js` | Sin la marca de sesión, manda al login con un 307 desde el borde |
| `rewrites` de `vercel.json` (las pantallas privadas) | `functions/[[ruta]].js` | Con la marca, sirve el armazón de la aplicación |
| `rewrites` de `vercel.json` (`/demo` y las subrutas) | `public/_redirects` | Las sirve como la aplicación, sin cambiar la dirección |
| `headers` de `vercel.json` | `public/_headers` | La misma CSP, los mismos encabezados de seguridad y la misma caché |
| `api/health.js` | `functions/api/health.js` | El healthcheck. Los dos usan `api/_salud.js` |
| — | `public/_routes.json` | Limita las funciones a las pantallas privadas y al healthcheck |

`src/routes/despliegueCloudflare.test.js` comprueba que las dos configuraciones
digan lo mismo. Si se agrega una pantalla privada y se olvida en Pages, falla.

### Dos diferencias de Pages que ya están resueltas

- **Pages redirige `x.html` a `x`.** Con un 308, `/index.html` va a `/` y
  `/login.html` va a `/login`. El service worker precarga esos dos archivos por su
  nombre, así que guardaría redirecciones, y un navegador no entrega una respuesta
  redirigida a una navegación: sin red, la aplicación instalada no abriría. Por eso
  `_redirects` sirve esos dos archivos con un 200, sin redirección. Está comprobado
  con `wrangler pages dev`: sin esas dos reglas responden 308; con ellas, 200.
- **Con un `404.html` en la raíz, Pages no hace el respaldo de aplicación de una
  sola página.** Es lo mismo que hoy hace Vercel: una dirección que no existe
  responde 404 con `404.html`, y cada pantalla de la aplicación se declara
  explícitamente.

## Plan gratuito

Datos de la documentación oficial, consultada el 2026-10-28:

- Las peticiones a archivos estáticos son **gratuitas e ilimitadas**, y también el
  ancho de banda.
- Las funciones cuentan contra el plan gratuito de Workers: **100 000 peticiones al
  día**, que se reinician a medianoche UTC. Aquí solo pasan por una función las
  navegaciones a las pantallas privadas y `/api/health`. Los archivos, el login y
  los datos, que van directo a Supabase, no gastan.
- **10 ms de CPU por petición.** La función solo lee una cookie, así que no se
  acerca a ese límite.
- **500 compilaciones al mes**, una a la vez, de 20 minutos como máximo.
- **20 000 archivos** por sitio y **25 MiB** por archivo. El build actual tiene
  menos de 30 archivos y el más grande pesa 1,4 MB.
- **100 dominios propios** por proyecto.
- Las condiciones del plan gratuito no prohíben el uso comercial. Vercel Hobby, en
  cambio, es solo para uso personal y no comercial.

Si se pasa del límite diario, Workers responde con el error 1027 en las rutas que
pasan por una función. Esas rutas son las pantallas privadas, y para salir de ahí
habría que pasar al plan de pago.

## Primera publicación en pages.dev

Estos pasos los hace la persona dueña de la cuenta de Cloudflare. No tocan el
dominio oficial ni Vercel.

1. **Crear el proyecto.** Entrar en Cloudflare y abrir **Workers & Pages →
   Create → Pages → Connect to Git**. Autorizar la aplicación de Cloudflare en
   GitHub **solo para el repositorio `Sistema-LUNACELL`**.
2. **Nombre del proyecto.** El nombre da la dirección: con `lunacell` sería
   `lunacell.pages.dev`, si está libre.
3. **Rama de producción.** Usar `main`.
4. **Configuración de compilación:**
   - Framework preset: `None`.
   - Build command: `npm ci --ignore-scripts && npm run build`. Es la misma
     instalación que el CI.
   - Build output directory: `dist`.
   - Root directory: el directorio raíz del repositorio.
5. **Variables de entorno.** Ponerlas en Production y en Preview:
   - `NODE_VERSION` = `22`. Pages no lee `engines` de `package.json`.
   - `SKIP_DEPENDENCY_INSTALL` = `1`, para que no instale dos veces.
   - `VITE_SUPABASE_URL` = la misma que en Vercel.
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = la misma clave publicable que en Vercel.
     Nunca la `service_role`.

   La compilación y las funciones leen las mismas variables.
6. **Preparar la primera prueba.** Mientras esta rama no esté en `main`, la
   primera prueba se hace con la vista previa de la rama `feat/cloudflare-pages`.
   Su dirección es `<hash>.<proyecto>.pages.dev` o
   `feat-cloudflare-pages.<proyecto>.pages.dev`.

### Para poder iniciar sesión desde pages.dev

El inicio de sesión pasa por la Edge Function `acceso`. Esa función solo acepta los
orígenes de `ORIGENES_PERMITIDOS`, y si no se configura, solo el dominio oficial.
Desde pages.dev se puede abrir la aplicación, pero entrar falla hasta que se
agregue ese origen.

La variable es un secreto de la Edge Function en Supabase de producción, y
cambiarla requiere autorización. El valor sería:

```
https://lunacell.oviedoarnold.lat,https://<proyecto>.pages.dev
```

El dominio oficial va primero y se conserva. Hay que agregar una sola dirección
fija, no las de cada vista previa: con un comodín, cualquier proyecto ajeno en
pages.dev podría llamar a la función. Al terminar las pruebas se quita.

### Qué comprobar en pages.dev

- `/login` llega con el formulario ya dibujado.
- `/pos` sin sesión manda a `/login` con un 307.
- Entrar, recorrer las pantallas y recargar en cada una.
- `/api/health` responde `"estado": "ok"`.
- Los encabezados de seguridad: `curl -I https://<proyecto>.pages.dev/`.
- Instalar la PWA, cortar la red y comprobar que abre. Sin red solo se abre la
  aplicación. **No se registran ventas.**

pages.dev es otro origen para el navegador. Su sesión, su caché y su base local
son independientes de las del dominio oficial. Lo que se haga ahí no toca las
ventas pendientes de ningún equipo real. Por eso mismo, en pages.dev **no se
venden ni se sincronizan ventas**: irían a la base de producción.

## Cambio del dominio oficial

Este paso necesita autorización aparte. El dominio no cambia, solo el servidor
que lo atiende.

**Por qué no se pierden las ventas pendientes.** Las ventas sin conexión viven en
IndexedDB del navegador, y su clave es el origen
`https://lunacell.oviedoarnold.lat`, no el servidor. Si se conserva el mismo
dominio, cada equipo sigue viendo su base local, su sesión, su cookie y su caché.
Si se cambiara de dominio, cada equipo empezaría vacío y lo pendiente se quedaría
en el origen viejo. Por eso el dominio no se cambia.

**El DNS hoy.** `oviedoarnold.lat` usa los nameservers de Vercel
(`ns1.vercel-dns.com` y `ns2.vercel-dns.com`). Al ser un subdominio, Pages no
exige mover el dominio a Cloudflare: basta con un CNAME. Ese registro se edita en
el DNS de Vercel, aunque la aplicación ya no se sirva desde ahí.

**Procedimiento previsto:**

1. Antes del día del cambio, **sincronizar todo lo pendiente** en cada equipo, con
   red y desde el dominio oficial. Comprobar en Conciliación que no queden ventas
   por resolver.
2. Elegir un momento sin ventas. Las ventas pendientes que hubiera de todos modos
   no se pierden, pero así no queda nada a medias.
3. En Pages, abrir **Custom domains → Set up a domain** y escribir
   `lunacell.oviedoarnold.lat`. Este paso va primero: un CNAME sin el dominio
   asociado en Pages da el error 522.
4. En el DNS de Vercel, reemplazar el registro de `lunacell` por un CNAME hacia
   `<proyecto>.pages.dev`. El TTL del dominio es de 10 minutos.
5. Esperar a que Pages marque el dominio como activo y emita el certificado. Luego
   comprobar `/login`, `/api/health`, los encabezados, el inicio de sesión y la
   PWA.
6. En cada equipo, abrir la aplicación con red. El service worker se actualiza
   solo: hay `skipWaiting` y `clients.claim`, y `sw.js` se revalida en cada
   visita. Las ventas pendientes siguen en IndexedDB y se sincronizan como
   siempre.
7. Dejar Vercel conectado unos días, sin el dominio, como vuelta atrás.

**Vuelta atrás:** devolver el registro de `lunacell` a lo que tenía en Vercel. El
origen sigue siendo el mismo, así que tampoco se pierde nada.
