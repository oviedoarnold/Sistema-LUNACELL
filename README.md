# LUNACELL

Sistema de gestión para LUNACELL: inventario, facturación al contado y al crédito,
cotizaciones en PDF, control de abonos y administración de usuarios con permisos.

**Producto publicado:** https://lunacell.oviedoarnold.lat/

---

## El problema

LUNACELL vende accesorios para celulares desde una bodega, una tienda y camiones en ruta.
Sin un sistema, nadie sabe con certeza qué queda en cada lugar hasta que un cliente lo pide.
Las ventas al crédito se anotan aparte y los abonos se pierden. Al cierre del mes no hay
forma rápida de saber cuánto se vendió ni cuánto deben.

## La solución

Una sola aplicación donde el mostrador factura, cotiza y consulta existencias, y donde el
dueño ve los números sin pedirle nada a nadie.

### Funcionalidades

| Módulo | Qué resuelve |
|---|---|
| **Inventario** | Productos por categoría y precio, con alerta de stock bajo y agotado |
| **Facturar** | Punto de venta con carrito, al contado o al crédito, que descuenta existencias |
| **Cotizar** | Cotizaciones con vigencia, exportables a PDF con el formato de la empresa |
| **Abonos** | Registro de pagos parciales sobre facturas a crédito, con saldo y paso a cancelada |
| **Clientes** | RTN, teléfono y dirección, que se autocompletan en facturas y cotizaciones |
| **Proveedores** | Directorio de proveedores |
| **Historial** | Todas las facturas, con filtro por forma de pago y saldo por cobrar |
| **Configuración** | Usuarios, roles y permisos por sección |

### Control de acceso

El administrador crea usuarios y habilita secciones una por una. Las ocho rutas privadas
verifican el permiso antes de renderizar, no solo ocultan la pestaña del menú: escribir la
URL directamente redirige a la primera sección que el usuario sí tenga habilitada.

---

## Stack

- **React 19** con React Router 7
- **Vite 8** como bundler
- **Tailwind 4** disponible, aunque la interfaz usa un sistema de estilos propio
  (`src/styles/lunacell.css`) con tokens CSS
- **jsPDF** y **html2canvas** para exportar facturas y cotizaciones
- **SweetAlert2** para confirmaciones
- Desplegado en **Vercel** con HTTPS

## Cómo correrlo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de producción
npm run lint     # ESLint
```

Antes del primer arranque hacen falta las dos variables de Supabase, en un
`.env.local` que no se versiona. La plantilla y la diferencia entre las dos
claves están en [Configuración](docs/configuracion.md).

## Estructura

```
src/
├── components/     Plantillas de factura y cotización, navbar, modales
├── context/        Estado global: auth, productos, clientes, ventas
├── layouts/        Layout del portal privado
├── pages/          Una por sección del sistema
├── routes/         Router y control de acceso por permiso
├── styles/         Sistema de diseño con tokens CSS
└── utils/          Lógica pura: cálculo de saldos y abonos, documentos
```

## Seguridad

Los headers se configuran en [`vercel.json`](vercel.json):

| Header | Protege contra |
|---|---|
| `Content-Security-Policy` | Inyección de scripts de terceros (XSS) |
| `X-Frame-Options: DENY` | Clickjacking mediante iframes |
| `X-Content-Type-Options: nosniff` | Ejecución de archivos con MIME type adivinado |
| `Referrer-Policy` | Fuga de rutas privadas hacia sitios externos |
| `Permissions-Policy` | Acceso silencioso a cámara, micrófono y ubicación |

## Estado del proyecto

Los datos viven en PostgreSQL gestionado por Supabase, con aislamiento por
empresa aplicado con *row-level security* en el motor y no en el frontend
(ver [ADR-1](docs/adr/adr-001-postgresql-multiempresa.md)). La autenticación
es Supabase Auth y las fotos de producto van a Supabase Storage.

En curso: separar el inventario del producto para que cada ubicación
—bodega, tienda y camiones— lleve sus propias existencias sobre el mismo
catálogo. Las ubicaciones ya existen como entidad; el inventario todavía es
uno solo.

## Recorrido

[`/demo`](https://lunacell.oviedoarnold.lat/demo) repasa los módulos del
sistema y separa los que ya funcionan de los que están planificados. Es una
página pública y **no publica credenciales**: el acceso es por
[`/login`](https://lunacell.oviedoarnold.lat/login), con cuenta propia.

## Documentación

| Documento | Contenido |
|---|---|
| [Configuración](docs/configuracion.md) | Variables de entorno y cuál clave va dónde |
| [Arquitectura](docs/arquitectura.md) | Diagramas C4 y decisiones |
| [ADR-1](docs/adr/adr-001-postgresql-multiempresa.md) | PostgreSQL multi-empresa |
| [ADR-2](docs/adr/adr-002-permisos-por-ruta.md) | Permisos por ruta |
| [PWA](docs/pwa.md) | Service worker y funcionamiento sin conexión |
| [Recorrido](docs/demo.md) | Qué muestra la página pública /demo |

## Autor

Arnold Oviedo — [github.com/oviedoarnold](https://github.com/oviedoarnold)
