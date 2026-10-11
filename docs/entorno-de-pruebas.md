# Entorno de pruebas aislado para el piloto sin conexión

Esta guía es para quien prepara y ejecuta las pruebas físicas de Camión 01. El
entorno se arma **sin tocar producción** (`qlzkriyibpbnesidtiiy`) y **sin
contratar nada**.

> **Estado:** documentado, **no creado**. Crear el proyecto de pruebas o
> instalar herramientas requiere tu autorización.

## Por qué los teléfonos necesitan HTTPS

El modo sin conexión usa funciones que el navegador solo habilita en un
**contexto seguro**, es decir, en HTTPS o en `localhost`:

- `crypto.randomUUID`, para la clave de cada venta;
- `crypto.subtle`, para el respaldo cifrado;
- el service worker, que permite instalar la PWA y abrirla sin red;
- `navigator.storage.persist` y Web Locks.

Abrir el sistema desde un teléfono en `http://192.168.x.x:5173` **no sirve**: la
venta sin conexión falla. Cualquier opción con teléfonos reales necesita una URL
`https://`.

## Opciones

| Opción | Qué es | Costo | Teléfonos reales | Varios dispositivos | Limitaciones |
|---|---|---|---|---|---|
| **A (recomendada)** | Proyecto **gratuito** de Supabase solo para pruebas, más el frontend compilado para pruebas en un hosting gratuito con HTTPS (Cloudflare Pages o Netlify) | $0 | Sí, con URL HTTPS estable | Sí | El proyecto gratuito se pausa tras 7 días sin uso (se reactiva gratis desde el panel). Límite de 500 MB de base, de sobra para pruebas. |
| **B** | Supabase **local** con Docker y la CLI, más túneles gratuitos de Cloudflare (`cloudflared`) para dar HTTPS a los teléfonos | $0 (Docker Desktop es gratis para uso personal y empresas pequeñas) | Sí, mientras la PC esté encendida | Sí | Hay que instalar Docker Desktop y WSL2, con 8 GB de RAM recomendados. La URL del túnel cambia en cada sesión y hay que recompilar el frontend. |
| **C** | Solo la PC: el frontend en `localhost`, que ya es contexto seguro, contra el backend de A o B | $0 | No | Pestañas y perfiles de Chrome o Edge | No prueba Android ni iPhone, ni la PWA instalada. Sirve como ensayo previo. |
| **Pago (no necesario)** | Supabase Pro con *branching*, o ngrok de pago con dominio fijo | Desde unos USD 25/mes (Pro) más el uso de cada rama; ngrok unos USD 8–10/mes | Sí | Sí | No aporta nada esencial para este piloto. |

### Datos que condicionan la opción A

- La organización de Supabase está en el **plan gratuito**. El plan gratuito
  permite **dos proyectos activos**.
- Hoy hay uno activo (`sistemalunacell`, producción) y otro **pausado**
  (`software-2`). Los pausados no cuentan para ese límite, así que **cabe un
  proyecto de pruebas gratuito**.
- **No conviene reutilizar `software-2`** sin revisar qué contiene:
  probablemente es el proyecto anterior, con datos viejos.
- Si en el futuro se reactiva `software-2`, ya no cabrían tres proyectos
  activos: habría que pausar el de pruebas.

## Cómo evitar conectarse a producción por accidente

1. **Un archivo de entorno solo para pruebas:** `.env.pruebas`. Está ignorado
   por git (`.env.*` está en `.gitignore`).
   - Define **las dos** variables. Vite carga además `.env.local`, que
     probablemente apunta a producción, pero `.env.pruebas` tiene prioridad
     solo para las claves que define.
2. **Compilar siempre con `--mode pruebas`** y verificar el resultado antes de
   publicarlo (paso A5).
3. **Usuarios que solo existen en pruebas.** Si por error el frontend apuntara a
   producción, esos usuarios no podrían iniciar sesión, y no se haría ninguna
   venta.
4. **Doble seguro de la base de producción.** Ahí `vende_sin_conexion` es
   `false` en todas las ubicaciones. Aunque algo apuntara a producción, el POS
   no permitiría vender sin conexión.
5. **Nunca** se agrega el host de pruebas a la CSP de `vercel.json`, ni se usan
   las variables de pruebas en Vercel. El sitio de pruebas va en otro hosting.

## Opción A paso a paso (recomendada)

### A1. Crear el proyecto de pruebas (requiere autorización)

- En el panel de Supabase: **New project**, en la organización `oviedoarnold`.
- **Nombre:** `lunacell-pruebas`. **Región:** `us-west-2`, la misma que
  producción.
- **Plan:** Free. **No** activar ningún complemento de pago.
- Anota la **URL** (`https://<ref-pruebas>.supabase.co`) y la **clave
  publicable**. El `ref` de pruebas **nunca** es `qlzkriyibpbnesidtiiy`.

### A2. Aplicar las migraciones 0001 a 0029, en orden, solo en pruebas

**Con la CLI (no necesita Docker para esto):**

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <ref-pruebas>
npx supabase@latest db push
```

- Antes de `db push`, confirma que el enlace apunta al ref de pruebas:
  `npx supabase@latest projects list` muestra cuál está vinculado.
- **Nunca** ejecutes `link` ni `db push` con el ref de producción.

**Sin la CLI:** pega cada archivo de `supabase/migrations/` en el SQL Editor del
**proyecto de pruebas**, en orden (0001, 0002, …, 0029).

### A3. Desplegar la función `acceso` en pruebas

```bash
npx supabase@latest functions deploy acceso --project-ref <ref-pruebas> --no-verify-jwt --use-api
npx supabase@latest secrets set --project-ref <ref-pruebas> ORIGENES_PERMITIDOS=https://<sitio-de-pruebas>
```

`SUPABASE_URL` y las claves las pone Supabase en cada proyecto.
`ORIGENES_PERMITIDOS` debe ser la URL del sitio de pruebas (paso A6).

### A4. Datos de prueba (solo en el proyecto de pruebas)

1. En **Authentication**, ajusta **Site URL** y **Redirect URLs** a la URL del
   sitio de pruebas.
2. Crea un administrador de pruebas.
   - La migración `0006_demo_admin_y_fiscal` deja datos de demostración.
     Revísala, o crea el administrador como en producción.
3. Desde la aplicación de pruebas, con ese administrador:
   - crea Camión 01 (tipo camión), Camión 02 y una tienda;
   - crea productos con existencias en Camión 01, dos vendedores asignados a
     Camión 01 y un cliente.
4. Habilita Camión 01 **en pruebas** con el SQL de la sección 12 de
   [piloto-camion-01.md](piloto-camion-01.md#12-activación), ejecutado en el SQL
   Editor del **proyecto de pruebas**.

### A5. Compilar el frontend para pruebas

Crea `.env.pruebas` en la raíz del repositorio (no se sube a git):

```
VITE_SUPABASE_URL=https://<ref-pruebas>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<clave-publicable-de-pruebas>
```

Compila y verifica que el resultado **no** apunte a producción:

```bash
npx vite build --mode pruebas
node -e "const fs=require('fs'),p=require('path');const t=[];(function r(d){for(const f of fs.readdirSync(d)){const x=p.join(d,f);fs.statSync(x).isDirectory()?r(x):t.push(fs.readFileSync(x,'utf8'))}})('dist');const s=t.join('');if(s.includes('qlzkriyibpbnesidtiiy')){console.error('PELIGRO: el build apunta a producción');process.exit(1)}if(!s.includes('<ref-pruebas>')){console.error('El build no contiene el proyecto de pruebas');process.exit(1)}console.log('OK: build de pruebas')"
```

Reemplaza `<ref-pruebas>` también dentro del comando. Si dice **PELIGRO**, no se
publica.

Para que funcionen las rutas de la aplicación en el hosting, crea
`dist/_redirects` con:

```
/login /login.html 200
/* /index.html 200
```

### A6. Publicar el sitio de pruebas con HTTPS (gratis)

- **Cloudflare Pages:** con una cuenta gratuita,
  `npx wrangler pages deploy dist --project-name lunacell-pruebas` publica en
  `https://lunacell-pruebas.pages.dev`.
- **Netlify Drop:** también gratis. Arrastra la carpeta `dist` en
  app.netlify.com/drop.

Después actualiza `ORIGENES_PERMITIDOS` (A3) y las URLs de Auth (A4) con esa
dirección.

### A7. Probar

- En cada teléfono abre la URL HTTPS del sitio de pruebas, instala la PWA y
  sigue las 12 pruebas de [matriz-validacion-sin-conexion.md](matriz-validacion-sin-conexion.md).
- Registra modelo, sistema, navegador, fecha y resultado.

### A8. Al terminar

- Pausa o borra el proyecto de pruebas desde el panel.
- Borra `dist` y `.env.pruebas` si ya no se usan.
- En producción no se hizo nada.

## Opción B paso a paso (todo local, sin cuentas nuevas)

1. Instala **Docker Desktop** (con WSL2) y **cloudflared**
   (`winget install Cloudflare.cloudflared`).
2. En la raíz del repositorio:
   - `npx supabase@latest init`, la primera vez. Crea `supabase/config.toml`,
     que **no** se sube a git sin revisión.
   - `npx supabase@latest start`. Levanta Postgres, Auth y PostgREST, y aplica
     `supabase/migrations/` en orden.
   - `npx supabase@latest functions serve acceso --no-verify-jwt`.
3. Crea un túnel HTTPS para la API: `cloudflared tunnel --url http://localhost:54321`.
   Muestra una URL `https://….trycloudflare.com`.
4. Crea `.env.pruebas` con esa URL y la clave publicable que mostró
   `supabase start`.
   - Compila con `npx vite build --mode pruebas` y haz la verificación de A5.
   - Sirve el resultado con `npx vite preview --port 4173`.
5. Crea un segundo túnel para el sitio: `cloudflared tunnel --url http://localhost:4173`.
   Esa URL HTTPS es la que se abre en los teléfonos.
6. Las URLs de los túneles cambian en cada sesión: repite los pasos 3 a 5 y
   vuelve a instalar la PWA.

Usa `vite preview` (sirve solo `dist`) y **no** `vite --host`. El servidor de
desarrollo de Vite 8.0.15 tiene una vulnerabilidad conocida en Windows que
podría exponer archivos a la red local (ver
[revision-seguridad-y-fiscal.md](revision-seguridad-y-fiscal.md)).

## Requisitos de los teléfonos

| Requisito | Android | iPhone |
|---|---|---|
| Navegador | Chrome actualizado | Safari, iOS 15.4 o posterior |
| PWA | Menú ⋮ → Instalar aplicación | Compartir → Agregar a inicio. Imprescindible: sin instalar, Safari puede borrar los datos tras 7 días sin uso. |
| Fecha y hora | Automáticas | Automáticas |
| Espacio libre | 1 GB o más | 1 GB o más |
| Navegación privada o incógnito | No | No |
| Cantidad para las pruebas | 2 teléfonos, para las pruebas de varios dispositivos | 1, si el piloto usará iPhone |

## Pruebas entre varios dispositivos

Todos los dispositivos abren la misma URL HTTPS de pruebas y usan los vendedores
de pruebas de Camión 01:

- dos teléfonos;
- o un teléfono y la PC.

Así se prueban la última unidad entre dos dispositivos, la sincronización
cruzada y la conciliación.
