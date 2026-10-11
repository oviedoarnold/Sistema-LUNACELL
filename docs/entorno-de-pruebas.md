# Entorno de pruebas aislado para el piloto sin conexión

Esta guía es para quien prepara y ejecuta las pruebas físicas de Camión 01. El
entorno se arma **sin tocar producción** (`qlzkriyibpbnesidtiiy`), **sin crear
proyectos en Supabase Cloud** y **sin contratar nada**.

## Estrategia

Los dos proyectos gratuitos de Supabase ya están ocupados: producción
(`sistemalunacell`) y `software-2`. **Ninguno de los dos se modifica**, y crear
un tercero sería de pago. Por eso el entorno de pruebas es **local**:

| Pieza | Herramienta | Costo |
|---|---|---|
| Base de datos, autenticación, API y funciones | **Supabase local** con Docker Desktop y la CLI de Supabase (`npx supabase`). Aplica las migraciones `0001`–`0029` del repositorio, en orden. | $0 (Docker Desktop es gratis para uso personal y empresas pequeñas) |
| Datos | Una semilla **ficticia**: una empresa de prueba sin CAI, ubicaciones con nombres "Pruebas", productos, clientes y usuarios de prueba. | $0 |
| Frontend | LUNACELL compilado en modo de pruebas (`--mode pruebas`) y servido con `vite preview`, solo en `127.0.0.1`. | $0 |
| HTTPS para Android e iPhone | **Tailscale Serve:** una red privada entre la PC y los teléfonos, con certificados HTTPS válidos. | $0 (plan Personal) |

### Opciones descartadas

- **Proyecto nuevo en Supabase Cloud:** no hay cupo gratuito y no se contrata.
- **`software-2`:** no se modifica.
- **Túneles públicos** (Cloudflare Quick Tunnel, ngrok): publican el sitio a
  cualquiera que tenga la URL.
- **`vite --host` o abrir puertos en la red local:** exponen el servidor de
  desarrollo, que tiene una vulnerabilidad conocida en Windows, y la base de
  datos local.

### Por qué Tailscale Serve

- Los teléfonos necesitan **HTTPS**. Sin un contexto seguro no funcionan
  `crypto.randomUUID`, el respaldo cifrado, el service worker (PWA) ni el
  almacenamiento persistente.
- **Serve** (no **Funnel**) publica solo dentro de la red privada: únicamente
  los dispositivos con la sesión de Tailscale del dueño lo ven. Nada queda
  abierto a Internet.
- El certificado es válido para Android e iOS sin instalar nada raro, porque
  Tailscale lo emite con Let's Encrypt para `*.ts.net`.
- **Solo se publican dos cosas:** el frontend de pruebas y la API local de
  Supabase. **Nunca** la base de datos (puerto 54322) ni el panel Studio
  (54323).

**Limitaciones:**

- Cada teléfono debe tener la app de Tailscale con la sesión iniciada.
- El nombre `*.ts.net` de la PC queda en los registros públicos de
  certificados (solo el nombre).
- La PC debe estar encendida durante las pruebas.
- Con el modo avión el teléfono también pierde Tailscale, que es justo lo que
  se quiere probar.

## Protección contra conectarse a producción por accidente

1. **`.env.pruebas`,** ignorado por git, con la URL de Tailscale de la PC y la
   clave publicable **local**.
2. **Script de compilación de pruebas.** Se niega a compilar si la URL
   contiene el ref de producción o no es local o de Tailscale. Además revisa
   que el resultado no mencione producción.
3. **La semilla se niega a ejecutarse** en una base con usuarios reales o con
   las ubicaciones de producción.
4. **Usuarios que solo existen en el entorno local.** Contra producción no
   podrían iniciar sesión.
5. **En producción, `vende_sin_conexion` es `false` en todas las
   ubicaciones.** Aunque algo apuntara allí, el POS no vendería sin conexión.

La guía paso a paso (instalación, comandos, datos, pruebas, registro y borrado)
está en **[entorno-local.md](entorno-local.md)**, junto con la configuración,
la semilla y el script que agrega su PR.
