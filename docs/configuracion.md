# Configuración del entorno

El sistema necesita dos variables para hablar con Supabase. En desarrollo van
en un archivo `.env.local` en la raíz del proyecto; en producción, en las
variables del proyecto de Cloudflare Pages, y con los mismos valores en Vercel
mientras sea el respaldo (ver [Alojamiento](cloudflare-pages.md#variables-del-build)).

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Las dos se obtienen en Supabase → *Project Settings* → *API Keys*.

Vite las hornea en el paquete al compilar, así que **cambiarlas exige volver
a desplegar**: guardarlas en Pages o en Vercel no basta si no se reconstruye.

## Cuál de las dos claves va aquí

Supabase entrega dos, y la diferencia importa.

**La clave publicable** (`sb_publishable_...`) es pública por diseño: viaja
dentro del JavaScript que descarga cualquier visitante y se puede leer con
ver el código fuente de la página. No es un secreto y no protege nada por sí
sola. Lo que limita qué ve cada usuario son las políticas de acceso de la
base, que se evalúan en el servidor contra la sesión de quien pregunta. Esta
es la que va en la configuración.

**La clave secreta** (la que empieza con `sb_secret`) se salta todas esas
políticas: quien la tenga lee y escribe cualquier fila de cualquier empresa.
Nunca va en el frontend, ni en este archivo, ni en el repositorio, ni pegada
en un chat. Si alguna vez se expone, hay que rotarla en Supabase de
inmediato; cambiar de lugar el archivo no sirve, porque la clave expuesta
sigue siendo válida hasta que se rote.

## El proyecto de Supabase también está escrito en la CSP

Cambiar las dos variables de arriba **no basta** para mudarse a otro
proyecto de Supabase. La política de seguridad de contenido (CSP) nombra el
host una por una. Está en [`public/_headers`](../public/_headers), que usa
Cloudflare Pages, y repetida en [`vercel.json`](../vercel.json) para el
respaldo:

```
connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co
img-src    'self' data: blob: https://<ref>.supabase.co
```

Hoy ese `<ref>` es `qlzkriyibpbnesidtiiy`, el proyecto de LUNACELL.
`connect-src` cubre las consultas y el tiempo real; `img-src`, las fotos
de producto que se sirven desde Storage.

**Ni Pages interpola variables de entorno dentro de `_headers` ni Vercel
dentro de `vercel.json`**, así que el host no se puede leer de
`VITE_SUPABASE_URL`: hay que escribirlo a mano.

Esto ya nos costó una tarde. Con las variables bien puestas pero la CSP
apuntando al proyecto anterior, el navegador bloqueaba cada petición antes
de que saliera; `signInWithPassword` fallaba por red,
[`AuthContext`](../src/context/AuthContext.jsx) no distingue ese caso del
de credenciales malas, y el login respondía *"Correo o contraseña
incorrectos"* con la contraseña correcta. Contra `curl` no se reproducía
nunca, porque la CSP solo la aplica el navegador.

**Al cambiar de proyecto de Supabase hay que tocar:** las dos variables de
entorno en Pages (y en Vercel mientras sea el respaldo), y los dos hosts en
`public/_headers` y en `vercel.json`. La prueba
`src/routes/despliegueCloudflare.test.js` falla si los dos archivos no
coinciden.

### Y después, forzar la recarga

Si el arreglo solo toca cabeceras y no el HTML, el ETag no cambia. El
navegador revalida, y con Vercel el servidor respondía `304 Not Modified`
—que **no reenviaba la cabecera CSP**— y el navegador seguía aplicando la que
tenía guardada. En Cloudflare Pages no está comprobado si pasa lo mismo, así
que se toma la misma precaución.
Un `F5` no alcanza: hace falta `Ctrl`+`Shift`+`R`, o vaciar los datos del
sitio.

## Por qué no hay un `.env.example` en el repositorio

Un archivo de ejemplo con nombre de archivo de entorno invita a un accidente
concreto: alguien lo abre, escribe sus credenciales de verdad dentro en vez
de copiarlo a otro nombre, y lo commitea. El `.gitignore` no lo detiene,
porque el ejemplo está versionado a propósito.

Por eso la plantilla vive aquí, en documentación, y `.gitignore` bloquea
cualquier archivo `.env` salvo este documento.

## Verificar que quedó bien

Con la aplicación desplegada:

```
curl https://lunacell.oviedoarnold.lat/api/health
```

Debe responder `"estado": "ok"` con la base y la autenticación arriba, y
`version` con el commit de `main`. Si
devuelve `"sin configurar"`, faltan las variables; si devuelve
`"inalcanzable"`, están puestas pero el proyecto de Supabase no responde.
