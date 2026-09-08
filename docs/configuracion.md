# Configuración del entorno

El sistema necesita dos variables para hablar con Supabase. En desarrollo van
en un archivo `.env.local` en la raíz del proyecto; en producción, en las
variables de entorno de Vercel.

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Las dos se obtienen en Supabase → *Project Settings* → *API Keys*.

Vite las hornea en el paquete al compilar, así que **cambiarlas exige volver
a desplegar**: guardarlas en Vercel no basta si no se reconstruye.

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

## El proyecto de Supabase también está escrito en vercel.json

Cambiar las dos variables de arriba **no basta** para mudarse a otro
proyecto de Supabase. La política de seguridad de contenido (CSP) que
declara [`vercel.json`](../vercel.json) nombra el host una por una:

```
connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co
img-src    'self' data: blob: https://<ref>.supabase.co
```

Hoy ese `<ref>` es `qlzkriyibpbnesidtiiy`, el proyecto de LUNACELL.
`connect-src` cubre las consultas y el tiempo real; `img-src`, las fotos
de producto que se sirven desde Storage.

**Vercel no interpola variables de entorno dentro de `vercel.json`**, así
que el host no se puede leer de `VITE_SUPABASE_URL`: hay que escribirlo a
mano en los dos sitios.

Esto ya nos costó una tarde. Con las variables bien puestas pero la CSP
apuntando al proyecto anterior, el navegador bloqueaba cada petición antes
de que saliera; `signInWithPassword` fallaba por red,
[`AuthContext`](../src/context/AuthContext.jsx) no distingue ese caso del
de credenciales malas, y el login respondía *"Correo o contraseña
incorrectos"* con la contraseña correcta. Contra `curl` no se reproducía
nunca, porque la CSP solo la aplica el navegador.

**Al cambiar de proyecto de Supabase hay que tocar tres lugares:** las dos
variables de entorno en Vercel, y estos dos hosts en `vercel.json`.

### Y después, forzar la recarga

Si el arreglo solo toca cabeceras y no el HTML, el ETag no cambia. El
navegador revalida, Vercel responde `304 Not Modified` —que **no reenvía
la cabecera CSP**— y el navegador sigue aplicando la que tenía guardada.
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

Debe responder `"estado": "ok"` con la base y la autenticación arriba. Si
devuelve `"sin configurar"`, faltan las variables; si devuelve
`"inalcanzable"`, están puestas pero el proyecto de Supabase no responde.
