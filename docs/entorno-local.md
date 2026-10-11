# Entorno local de pruebas: guía paso a paso (Windows y teléfonos)

Esta guía es para quien prueba el piloto de Camión 01 en su computadora y en
teléfonos reales, sin tocar producción. Los motivos de esta estrategia están en
[entorno-de-pruebas.md](entorno-de-pruebas.md).

**Qué obtienes:** una copia funcional de LUNACELL en tu PC.

- Supabase local en Docker, con las migraciones del repositorio aplicadas en
  orden.
- Datos ficticios (`supabase/seed.sql`): una empresa sin CAI, «Camión 01
  Pruebas» habilitado para vender sin conexión y usuarios de prueba.
- El frontend compilado en modo de pruebas, servido solo en tu PC.
- Acceso con HTTPS desde tus teléfonos por **Tailscale Serve**: una red privada,
  no Internet.

> **Nunca:** `supabase link`, `supabase db push`, `--linked` ni
> `tailscale funnel`. Tampoco compartir la base (54322) ni Studio (54323).

## 1. Qué instalar (una sola vez)

| Herramienta | Para qué | Costo | Notas |
|---|---|---|---|
| **Docker Desktop** (con WSL2) | Ejecutar Supabase local | Gratis (uso personal o empresa pequeña) | Windows 10/11 de 64 bits, virtualización activada en la BIOS, 8 GB de RAM (16 recomendados) y unos 10 GB de disco para las imágenes. |
| **Node.js y Git** | Ya los usas con el repositorio | Gratis | Node 20 o superior. |
| **Tailscale** en la PC | Dar HTTPS privado a los teléfonos | Gratis (plan Personal) | Inicia sesión con tu cuenta. |
| **Tailscale** en cada teléfono | Llegar a la PC por la red privada | Gratis | App de Google Play o App Store, con la **misma** cuenta. |

**Instalación en la PC:**

1. Instala Docker Desktop y elige **Use WSL 2**. Reinicia si te lo pide.
   - Ábrelo y espera a que diga *Engine running*.
   - Comprueba en PowerShell: `docker --version`.
2. Instala Tailscale e inicia sesión.
3. En la [consola de Tailscale](https://login.tailscale.com/admin/dns) activa
   **MagicDNS** y **HTTPS Certificates**.
4. Anota el nombre DNS de tu PC (se ve como `mi-pc.tailXXXX.ts.net`). Lo muestra
   este comando:

   ```powershell
   tailscale status --json | Select-String DNSName
   ```

**Protección de red (recomendada).** Docker puede publicar los puertos de
Supabase para toda la red local. Bloquéalos para que solo los use tu PC.
Tailscale Serve sigue funcionando, porque entra por `127.0.0.1`. Ejecuta en
PowerShell **como administrador**:

```powershell
New-NetFirewallRule -DisplayName "LUNACELL local: bloquear Supabase desde la red" -Direction Inbound -Protocol TCP -LocalPort 54320-54329,8083,4173 -Action Block
```

Si Docker pregunta por el acceso a la red, **no** marques las redes públicas.

## 2. Levantar Supabase local

En PowerShell, desde la carpeta del repositorio:

```powershell
npx supabase@2.120.0 start
```

- **La primera vez** descarga las imágenes y tarda varios minutos. Aplica
  `supabase/migrations/` en orden (avisa que se salta `README.md`, es normal) y
  carga `supabase/seed.sql`.
- **Al terminar** muestra `API URL` (`http://127.0.0.1:54321`), `Publishable
  key` y `Studio URL`. Puedes volver a verlos con `npx supabase@2.120.0 status`.
- **Studio** (`http://127.0.0.1:54323`) se abre solo en tu PC. Ahí puedes mirar
  las tablas de prueba.

**Función de inicio de sesión (`acceso`).**

1. Crea `supabase\functions\.env`. Git lo ignora, igual que todos los `.env`.
   Pon tu nombre DNS de Tailscale:

   ```
   ORIGENES_PERMITIDOS=https://mi-pc.tailXXXX.ts.net,http://127.0.0.1:4173
   ```

2. En **otra** ventana de PowerShell, que se queda abierta:

   ```powershell
   npx supabase@2.120.0 functions serve --env-file supabase/functions/.env --no-verify-jwt
   ```

## 3. Publicar en tu red privada (Tailscale Serve)

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:4173
tailscale serve --bg --https=8443 http://127.0.0.1:54321
tailscale serve status
```

| Dirección | Qué sirve |
|---|---|
| `https://mi-pc.tailXXXX.ts.net` | Frontend de pruebas |
| `https://mi-pc.tailXXXX.ts.net:8443` | API de Supabase local |

Solo las ven los dispositivos con tu sesión de Tailscale. La base (54322) y
Studio (54323) **no** se publican.

## 4. Iniciar LUNACELL en modo de pruebas

1. Crea `.env.pruebas` en la raíz del repositorio (git lo ignora):

   ```
   VITE_SUPABASE_URL=https://mi-pc.tailXXXX.ts.net:8443
   VITE_SUPABASE_PUBLISHABLE_KEY=<la Publishable key que mostró "supabase status">
   ```

2. Compila y sirve:

   ```powershell
   npm run pruebas:compilar
   npm run pruebas:servir
   ```

   - **`pruebas:compilar`** primero comprueba `.env.pruebas`. **Se niega** si la
     URL apunta a producción, a cualquier proyecto en la nube (incluido
     `software-2`) o a algo que no sea el Supabase local o tu `*.ts.net`.
     Después compila en `dist-pruebas\` y revisa que el resultado no apunte a
     la nube; si lo encuentra, lo borra.
   - **`pruebas:servir`** sirve `dist-pruebas\` solo en `127.0.0.1:4173`. Deja
     esa ventana abierta.
3. En la PC abre `https://mi-pc.tailXXXX.ts.net`.

**Usuarios de prueba** (contraseña de todos: `Pruebas-Local-2026`):

| Usuario | Rol | Para qué |
|---|---|---|
| `admin.pruebas` | Administrador | Conciliación, rescate y cambio de ubicación |
| `camion01.pruebas` | Vendedor de Camión 01 Pruebas | Teléfono 1 |
| `camion01b.pruebas` | Vendedor de Camión 01 Pruebas | Teléfono 2 (dos dispositivos) |
| `camion02.pruebas` | Vendedor de Camión 02 Pruebas | Ubicación sin modo sin conexión |

**Productos en Camión 01 Pruebas:**

- Cargador ×10
- Cable ×5
- Audífonos ×1 (para probar la última unidad entre dos teléfonos)
- Protector ×20

Clientes: «Cliente Crédito Prueba» y «Cliente Contado Prueba».

## 5. Verificar que está aislado de producción

Hazlo **antes de cada sesión**:

1. `npm run pruebas:verificar` debe decir **✔ .env.pruebas apunta solo al
   Supabase local**.
2. Al entrar con `admin.pruebas`, la empresa se llama **LUNACELL PRUEBAS
   (ficticia)** y las ubicaciones terminan en **«Pruebas»**.
3. En el navegador de la PC (F12 → Red), todas las peticiones van a
   `mi-pc.tailXXXX.ts.net:8443`. **Ninguna** va a `supabase.co`.
4. Un usuario real de producción **no** puede entrar: no existe en el entorno
   local.
5. En producción no cambia nada. Si quieres, el administrador puede comprobarlo
   en modo de solo lectura (sección 14 de
   [piloto-camion-01.md](piloto-camion-01.md)).

## 6. Preparar los teléfonos

1. Instala **Tailscale** e inicia sesión con la misma cuenta. Actívalo.
2. Abre `https://mi-pc.tailXXXX.ts.net`:
   - **Android:** en Chrome.
   - **iPhone:** en Safari.
3. Instala la app:
   - **Android:** menú ⋮ → **Instalar aplicación**.
   - **iPhone:** Compartir → **Agregar a inicio**.
   - Abre siempre **desde el ícono**.
4. Activa la **fecha y hora automáticas** y deja al menos 1 GB libre.
5. Entra con `camion01.pruebas` (en el segundo teléfono, `camion01b.pruebas`) y
   abre **Facturar**. Debe verse **En línea · Sin ventas pendientes**.

## 7. Hacer las pruebas sin conexión

Sigue las 12 pruebas manuales de
[matriz-validacion-sin-conexion.md](matriz-validacion-sin-conexion.md). En
resumen:

1. **Modo avión.** Corta Internet y Tailscale, que es justo lo que se quiere
   probar.
   - Vende al contado, con varios productos, y a crédito a «Cliente Crédito
     Prueba».
   - Cada venta debe dar un comprobante `PROV-…`.
2. **Cierra y reabre** la app sin red: las ventas siguen pendientes. Repítelo
   **reiniciando el teléfono**.
3. **Respaldo cifrado:** genéralo y ábrelo en la PC (Conciliación → Rescate con
   `admin.pruebas`).
4. **Quita el modo avión:** las ventas se sincronizan solas en menos de un
   minuto.
5. **Última unidad:** los dos teléfonos venden los Audífonos sin red y luego se
   reconectan.
   - Una venta queda registrada y la otra en conciliación.
   - Resuélvela con `admin.pruebas` y comprueba que el teléfono muestra la
     decisión.
6. **Sesión vencida:** la app abierta sin red más de 1 hora.
   - **Cierre de sesión** con ventas pendientes: debe aparecer el aviso.
   - **Cambio de ubicación:** desde Configuración, con `admin.pruebas`.
   - **Varias pestañas** en la PC.

## 8. Registrar los resultados

Copia esta tabla en un archivo nuevo, por ejemplo
`resultados-piloto-AAAA-MM-DD.md`. **No** incluyas datos reales. Entrega una
copia al revisar la [lista de aprobación](lista-aprobacion-piloto.md).

```
Fecha: ____  Persona: ____  Commit de LUNACELL: ____ (git rev-parse --short HEAD)

| # | Prueba | Dispositivo (modelo / sistema / navegador) | PWA instalada | Resultado (OK / FALLA) | Observaciones y capturas |
|---|--------|--------------------------------------------|---------------|------------------------|--------------------------|
| 1 | Ventas en modo avión con comprobante PROV | | | | |
| 2 | Cerrar y reabrir sin red | | | | |
| 3 | Reiniciar el teléfono | | | | |
| 4 | Respaldo cifrado y rescate en la PC | | | | |
| 5 | Sincronización automática al volver la red | | | | |
| 6 | Última unidad en dos teléfonos y conciliación | | | | |
| 7 | Más de 1 hora sin red y reconexión | | | | |
| 8 | Cierre de sesión con pendientes | | | | |
| 9 | Wifi sin Internet (portal cautivo) | | | | |
| 10 | Varias pestañas en la PC | | | | |
| 11 | Cambio de ubicación con pendientes | | | | |
| 12 | Crédito a cliente existente | | | | |
```

## 9. Iniciar, detener, reconstruir y borrar

| Quiero… | Comandos |
|---|---|
| **Detener** sin perder los datos de prueba | Cierra las ventanas de `functions serve` y `pruebas:servir` (Ctrl+C). Luego `npx supabase@2.120.0 stop` y `tailscale serve reset`. |
| **Volver a iniciar** | `npx supabase@2.120.0 start`, `functions serve …` (sección 2), los dos `tailscale serve …` (sección 3) y `npm run pruebas:servir`. |
| **Empezar de cero**, solo con los datos de prueba | `npx supabase@2.120.0 db reset` borra la base **local**, vuelve a aplicar las migraciones y la semilla. **Nunca** con `--linked`. |
| **Borrar todo el entorno** | `npx supabase@2.120.0 stop --no-backup` (borra los volúmenes locales de Docker) y `tailscale serve reset`. Borra `dist-pruebas\`, `.env.pruebas` y `supabase\functions\.env`. |
| **Borrar los datos de prueba de un teléfono** | Desinstala la app de LUNACELL de pruebas. Borra los datos del sitio `mi-pc.tailXXXX.ts.net`: en **Chrome**, Configuración → Configuración de sitios → Datos almacenados; en **iPhone**, Ajustes → Safari → Avanzado → Datos de sitios web. Solo afecta a esa dirección de pruebas, no a la app de producción. |

## 10. Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| "Correo o contraseña incorrectos" con un usuario de prueba | La función `acceso` no está corriendo, o falta tu dirección en `ORIGENES_PERMITIDOS` | Sección 2; reinicia `functions serve` |
| El teléfono no abre la dirección | Tailscale apagado en el teléfono, o HTTPS no activado en la consola | Activa Tailscale; revisa `tailscale serve status` |
| "No se pudo guardar la venta" o falla el respaldo | La página no se abrió por HTTPS | Usa siempre `https://…ts.net`, nunca la IP |
| `pruebas:compilar` dice ✖ | `.env.pruebas` apunta a la nube | Corrige la URL (sección 4) |
| `supabase start` falla | Docker Desktop no está corriendo | Ábrelo y espera *Engine running* |
| No aparece la barra «En línea» en Facturar | El usuario no es de Camión 01 Pruebas | Entra con `camion01.pruebas` |
