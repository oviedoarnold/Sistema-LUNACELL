# Revisión de seguridad y restricción fiscal antes del piloto (OFF-1.4)

## 1. Vulnerabilidades de `npm audit`

Resultado de `npm audit` sobre `main` en `bfa0b14`. OFF-1.4 no cambió
dependencias: todas estas vulnerabilidades ya existían.

### Dependencias que llegan al navegador (producción)

| Paquete | Versión instalada | Corregida en | Gravedad | ¿Afecta a LUNACELL? |
|---|---|---|---|---|
| `react-router` / `react-router-dom` (directa) | 7.16.0 | 7.18.2 (última 7.18.4) | Alta | **Bajo riesgo hoy.** La aplicación es una SPA sin SSR ni RSC, así que los avisos de SSR, RSC y CSRF de acciones no aplican. Quedan dos: redirección abierta con `\` en `<Link>` y `useNavigate`, y denegación de servicio en el emparejamiento de rutas. La app solo navega a rutas internas fijas, y el destino tras el login sale del estado del router, no de la URL. Conviene actualizar dentro de la misma versión mayor. |
| `dompurify` (vía `jspdf` 4.2.1) | 3.4.8 | 3.4.16 | Moderada | **Bajo.** La app no usa `jspdf.html()` ni DOMPurify con HTML externo. Genera los PDF con `html2canvas` a partir de su propio DOM. |

### Solo de desarrollo, compilación o pruebas (no llegan al navegador)

| Paquete | Gravedad | Nota |
|---|---|---|
| `vite` 8.0.15 (directa) | Alta | El servidor **de desarrollo** en Windows permite saltarse `server.fs.deny`. **Importa para las pruebas físicas:** no exponer `vite` (modo desarrollo) a la red local. Usar `vite preview` sobre `dist` (ver [entorno-de-pruebas.md](entorno-de-pruebas.md)). Corregido después de 8.0.15. |
| `brace-expansion`, `browserslist`, `nanoid`, `postcss`, `source-map-js`, `undici`, `baseline-browser-mapping` | Alta o moderada | Denegación de servicio o lectura de archivos `.map` con entradas maliciosas en herramientas de compilación y pruebas. No se ejecutan con datos de usuarios. |

### Evaluación

- **No bloquean el piloto.** Ninguna permite leer ni escribir datos del sistema
  desde el navegador en la forma en que LUNACELL usa esas librerías.
- **Recomendación:** antes del piloto, una tarea de seguridad aparte (con su
  propio PR y autorización) que haga lo siguiente.
  1. `npm install react-router-dom@^7.18.4`, misma versión mayor.
  2. `npm audit fix`, sin `--force`. Corrige `vite`, `dompurify` (vía
     `jspdf`) y los paquetes de compilación dentro de rangos compatibles.
  3. Suite completa, pruebas SQL, lint, build, CI y SonarCloud.
- **No se aplicó aquí** porque es un cambio de alcance distinto.

## 2. Impedir técnicamente que Lunacell Store venda sin conexión

### Situación en producción (lectura del 10/10/2026)

| Ubicación | Tipo | Emite fiscal | Vende sin conexión |
|---|---|---|---|
| Camión 01 | camion | no | no |
| Camión 02 | camion | no | no |
| Lunacell Bodega | bodega | no | no |
| Lunacell Store | tienda | **no** | no |

La base ya prohíbe `vende_sin_conexion` en una ubicación con
`emite_fiscal = true` (restricción de 0027). Pero Store hoy **no** está marcada
como fiscal, así que nada técnico impide habilitarla. Hoy solo la protege el
procedimiento: la lista de aprobación.

### Opción 1 (recomendada, sin código): marcar Store como fiscal

Basta con un cambio de configuración que hace un administrador:

```sql
-- SOLO con autorización. No se ejecutó.
update public.ubicaciones
   set emite_fiscal = true
 where nombre = 'Lunacell Store'
   and tipo = 'tienda'
   and vende_sin_conexion = false
returning id, nombre, emite_fiscal, vende_sin_conexion;
```

- **Efecto inmediato:** la restricción de 0027 impide habilitar Store sin
  conexión. La copia local nunca la habilita, y la conciliación rechaza aplicar
  sus ventas como documento interno (CV007).
- **Ventas en línea de Store: no cambian hoy.** Con el CAI vacío, 0017 sigue
  emitiendo documentos internos aunque la ubicación sea fiscal.
- **Cuando se configure el CAI,** Store empezará a emitir facturas fiscales.
  Eso es lo que se espera de la tienda, pero **requiere confirmarlo con la
  revisión fiscal**, porque es una decisión de negocio.
- **Reversible:** `emite_fiscal = false` con el mismo procedimiento.

### Opción 2 (si Store no debe marcarse fiscal todavía): restricción por tipo

Una migración nueva, la 0030. No modifica 0027–0029: agrega una restricción
para que solo los camiones y las bodegas puedan vender sin conexión.

```sql
-- Propuesta, NO creada ni aplicada.
alter table public.ubicaciones
  add constraint ubicaciones_sin_conexion_solo_camion_o_bodega
  check (not vende_sin_conexion or tipo in ('camion', 'bodega'));
```

- **Seguro hoy:** todas las ubicaciones tienen `false`, así que la restricción
  se valida sin cambiar nada.
- **Habilitar Store más adelante** exigirá otra migración revisada, que es la
  autorización fiscal escrita en el código.
- **Requisitos:**
  - prueba SQL;
  - PR y aplicación en producción con el procedimiento de migraciones;
  - autorización.
- **Límite:** un administrador podría cambiar el tipo de Store a `bodega`. Es
  un paso deliberado y quedaría a la vista, no un descuido.

### Recomendación

- Si la revisión fiscal confirma que Store emitirá facturas fiscales, aplicar la
  **Opción 1** antes de activar cualquier piloto: es mínima, usa la regla que ya
  existe y no requiere código.
- Si todavía no se sabe, aplicar la **Opción 2**.
- En ambos casos, **no se cambia nada sin autorización.**
