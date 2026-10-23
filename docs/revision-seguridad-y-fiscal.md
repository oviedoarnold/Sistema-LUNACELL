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
| `vite` 8.0.15 (directa) | Alta | El servidor **de desarrollo** en Windows permite saltarse `server.fs.deny`. **Importa para las pruebas físicas:** no exponer `vite` (modo desarrollo) a la red local. Usar `vite preview` sobre `dist`, solo en `127.0.0.1` (ver [entorno-de-pruebas.md](entorno-de-pruebas.md)). Corregido después de 8.0.15. |
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

### Decisión

- **No se modifica `emite_fiscal`** ni se configura un CAI real. Marcar Store
  como fiscal queda descartado mientras no termine la revisión fiscal.
- La protección debe ser **técnica** y **no depender del nombre** de la
  ubicación.

### Propuesta: migración 0030 (en un PR aparte, sin aplicar en producción)

Dos reglas en la base que no dependen del nombre:

1. **Restricción por tipo.** Solo los camiones y las bodegas pueden vender sin
   conexión:

   ```sql
   check (not vende_sin_conexion or tipo in (camion, bodega))
   ```

   Lunacell Store es de tipo `tienda`: la base rechaza habilitarla, la pida
   quien la pida desde la aplicación o desde el SQL Editor.

2. **El tipo `tienda` no se cambia desde la aplicación.** Un disparador impide
   que `authenticated` (ni siquiera un administrador) cambie el tipo de una
   ubicación **desde** o **hacia** `tienda`. Sin esto, alguien podría
   convertir la tienda en bodega y habilitarla.

**Qué hace falta para habilitar Store** después de la autorización fiscal: una
migración nueva, revisada y aplicada con el procedimiento de migraciones. Esa
es la autorización explícita, escrita en el código.

**Seguro para producción:**

- hoy ninguna ubicación tiene `vende_sin_conexion = true`, así que la
  restricción se valida sin cambiar datos;
- Camión 01, Camión 02 y Bodega siguen pudiendo habilitarse cuando se
  autorice;
- no modifica 0027–0029.

**Estado:** preparada en `supabase/migrations/0030_tienda_sin_conexion_bloqueada.sql`, con 8 pruebas SQL en `pruebas-sql/tienda-sin-conexion.test.mjs`. **No aplicada a producción:** se aplica con el procedimiento de migraciones, solo con autorización.

## 3. Correlativos: solo los mueve el registro de un documento (A-1 y A-1b)

Hallazgos de la auditoría final (2026-10-23). Los dos permitían dejar huecos
en el rango autorizado del CAI desde la aplicación, sin crear ningún
documento.

| | Qué pasaba | Quién podía | Corrección | Estado |
|---|---|---|---|---|
| **A-1** | `siguiente_correlativo('factura')` o `('interno')` por RPC subía el contador | Cualquier usuario con sesión | 0031: la función pasa a SECURITY INVOKER y la aplicación solo puede pedir `'cotizacion'` | Aplicada en producción (versión `20261023210617`) |
| **A-1b** | Un `UPDATE` directo de `empresas.proximo_correlativo_*` por la API | El administrador (`empresas_update`) | 0032: un disparador impide a `authenticated` y `anon` cambiar cualquiera de los tres contadores | Preparada, sin aplicar |

**Quién mueve los contadores después de las dos:**

- `registrar_venta_ubicacion()` (factura o interno), `conciliar_venta()`
  (interno) y `siguiente_correlativo_de_cotizacion()` (cotización), que corren
  como el dueño de la base;
- el dueño de la base, desde el SQL Editor o una migración.

**Ajustar el contador al inicio de un rango autorizado.** Con la 0032 ya no se
hace desde la aplicación. Cuando el cliente reciba su CAI, el contador fiscal
debe quedar en el `rango_desde` autorizado: hoy está en 9 por las facturas de
prueba anteriores a la 0017, y ningún proceso lo alinea solo. Se hace una vez,
como dueño de la base y con autorización:

```sql
update public.empresas
   set proximo_correlativo_factura = <rango_desde>
 where id = '<empresa>'
returning proximo_correlativo_factura;
```

Solo si no se emitió ninguna factura fiscal con ese CAI. Si ya hay, el
contador no se baja nunca.
