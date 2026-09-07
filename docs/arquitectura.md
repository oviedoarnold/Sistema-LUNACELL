# Arquitectura — Sistema Ferretería

Código de verificación: `LEARN-CAP-50768C03`

Producto publicado: https://www.oviedoarnold.lat/
Repositorio: https://github.com/oviedoarnold/Sistema-Ferreteria

---

## 1. El problema que resuelve

Una ferretería de mostrador lleva el inventario en cuadernos o en hojas de cálculo
sueltas. Nadie sabe con certeza qué queda en bodega hasta que un cliente lo pide.
Las ventas al crédito se anotan aparte y los abonos se pierden. Al cierre del mes
no hay forma rápida de saber cuánto se vendió ni cuánto deben.

El sistema reúne inventario, facturación, cotizaciones, abonos y clientes en una
sola aplicación, con control de acceso por sección para que el dueño decida qué ve
cada empleado.

---

## 2. Diagrama C4 — Nivel 1: Contexto

```mermaid
C4Context
  title Contexto del Sistema Ferretería

  Person(cajero, "Cajero", "Factura y cotiza en el mostrador")
  Person(duenio, "Dueño", "Revisa números y administra usuarios")
  Person(cliente, "Cliente de la ferretería", "Recibe factura o cotización")

  System(sistema, "Sistema Ferretería", "Inventario, facturación, cotizaciones y abonos")

  System_Ext(sar, "SAR", "Autoriza el CAI y el rango de numeración")
  System_Ext(vercel, "Vercel", "Publica la aplicación con HTTPS")

  Rel(cajero, sistema, "Factura, cotiza y consulta existencias")
  Rel(duenio, sistema, "Revisa ventas y asigna permisos")
  Rel(sistema, cliente, "Entrega factura o cotización en PDF")
  Rel(duenio, sar, "Tramita el CAI y el rango autorizado")
  Rel(sistema, vercel, "Se despliega en")
```

## 3. Diagrama C4 — Nivel 2: Contenedores

Una aplicación de una sola página contra PostgreSQL en Supabase. El aislamiento
entre ferreterías no lo hace el frontend: lo aplican las políticas de acceso de
la base, como decidió el ADR-1.

```mermaid
flowchart TB
  subgraph navegador["Navegador del cajero"]
    spa["Aplicación React 19 + Vite<br/>Rutas protegidas por permiso"]
    sw["Service Worker<br/>Caché de la aplicación"]
  end

  subgraph vercel["Vercel"]
    cdn["CDN estático<br/>HTTPS + headers de seguridad"]
  end

  subgraph supabase["Supabase"]
    api["PostgREST<br/>API sobre el esquema"]
    db[("PostgreSQL<br/>multi-empresa con RLS<br/>inventario como libro de movimientos")]
    auth["Supabase Auth<br/>sesiones y contraseñas"]
  end

  spa -->|"registra"| sw
  sw -->|"sirve sin conexión"| spa
  cdn -->|"entrega"| spa
  spa -->|"lee y escribe"| api
  api --> db
  spa -->|"inicia sesión"| auth
  auth --> db
```

## 4. Diagrama C4 — Nivel 3: Componentes del frontend

```mermaid
flowchart LR
  subgraph paginas["Páginas"]
    pos["POS<br/>Facturar"]
    cot["Quotes<br/>Cotizar"]
    hist["SalesHistory<br/>Historial y abonos"]
    inv["Products<br/>Inventario"]
    conf["Settings<br/>Usuarios y datos fiscales"]
  end

  subgraph contextos["Estado global"]
    auth["AuthContext<br/>sesión, roles, permisos"]
    prod["ProductContext<br/>productos y empresa"]
    ventas["SalesContext<br/>ventas y abonos"]
    clientes["ClientsContext"]
  end

  subgraph logica["Lógica pura — 98% cubierta por pruebas"]
    cart["cart.js<br/>carrito y existencias"]
    sales["salesUtils.js<br/>saldos y abonos"]
    fiscal["fiscal.js<br/>CAI y rango autorizado"]
    quotes["quotes.js<br/>vigencia y conversión"]
    format["format.js<br/>dinero y fechas"]
  end

  guard["ProtectedRoute<br/>verifica permiso por ruta"]

  guard --> paginas
  auth --> guard
  pos --> cart
  pos --> ventas
  cot --> cart
  cot --> quotes
  hist --> sales
  conf --> fiscal
  ventas --> fiscal
  ventas --> sales
  paginas --> format
  paginas --> contextos
```

---

## 5. Decisiones de arquitectura

| ADR | Título | Estado |
|---|---|---|
| [ADR-1](adr/adr-001-postgresql-multiempresa.md) | PostgreSQL multi-empresa con seguridad a nivel de fila | Aceptada |
| [ADR-2](adr/adr-002-permisos-por-ruta.md) | Control de acceso verificado en cada ruta, no solo en el menú | Aceptada e implementada |

---

## 6. Calidad

| Métrica | Valor |
|---|---|
| Pruebas automatizadas | 317 |
| Cobertura de líneas | 63,3 % |
| Avisos de ESLint | 0 |
| Integración continua | GitHub Actions, bloquea en lint, pruebas y build |

El pipeline está en [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) y corre
en cada push a `main`.

### Qué se decidió no probar

`src/utils/documentUtils.js` genera los PDF con jsPDF y html2canvas. Probarlo en
jsdom verificaría que las funciones se ejecutan, no que el archivo resultante sea
correcto — eso se comprueba abriendo el PDF. Está excluido de la medición de
cobertura con esa justificación en [`vite.config.js`](../vite.config.js).

---

## 7. Seguridad

Los headers se declaran en [`vercel.json`](../vercel.json):

| Header | Protege contra |
|---|---|
| `Content-Security-Policy` | Inyección de scripts de terceros (XSS) |
| `X-Frame-Options: DENY` | Clickjacking mediante iframes |
| `X-Content-Type-Options: nosniff` | Ejecución de archivos con MIME adivinado |
| `Referrer-Policy` | Fuga de rutas privadas hacia sitios externos |
| `Permissions-Policy` | Acceso silencioso a cámara, micrófono y ubicación |

### Dónde se aplica el control de acceso

Ocultar botones en el frontend es comodidad, no seguridad. Lo que contiene a un
usuario que abra las herramientas de desarrollo son las políticas de la base:
cada tabla filtra por `empresa_del_usuario()`, y `permisos_usuario` además
filtra por el usuario, de modo que un vendedor no puede leer ni asignarse
permisos ajenos.

Las vistas llevan `security_invoker = on`. Sin eso una vista corre con los
permisos de quien la creó y devuelve las filas de todas las empresas: con un
solo cliente cargado el fallo no se nota, y aparece el día que entra el segundo.

Queda una limitación real: la separación entre empresas depende de que
`empresa_del_usuario()` y las políticas sean correctas. Es un punto único, y
por eso conviene que cualquier cambio al esquema se pruebe con dos empresas
cargadas, no con una.
