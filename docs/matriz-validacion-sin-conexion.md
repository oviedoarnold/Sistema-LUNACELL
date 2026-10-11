# Matriz de validación: ventas sin conexión (OFF-1.4)

Esta matriz dice qué se validó, cómo, y qué falta antes de iniciar el piloto en
Camión 01.

## Cómo leer la matriz

| Tipo | Qué es | Estado |
|---|---|---|
| **A** | Prueba automatizada. Corre en CI en cada cambio. | Hecha y en verde. |
| **B** | Prueba manual con teléfonos y navegadores reales. | **Pendiente.** No se probó ningún teléfono real. |
| **C** | Prueba en un entorno aislado con datos de prueba (otro proyecto o rama de Supabase y un despliegue de vista previa). Nunca en producción. | **Pendiente.** Los pasos están al final. |

Las pruebas automatizadas (A) no sustituyen a las físicas (B). Prueban la
lógica, pero no cómo se comporta un navegador real con poco espacio, una red
móvil inestable o el sistema de un teléfono concreto.

### Archivos de prueba citados

| Clave | Archivo |
|---|---|
| `motor` | `src/lib/sinConexion/*.test.js` |
| `pos` | `src/pages/POS.sinConexion.test.jsx` |
| `proveedor` | `src/context/SinConexionContext.test.jsx` |
| `auth` | `src/context/AuthContext.sinConexion.test.jsx` |
| `conciliacion` | `src/pages/Conciliacion.test.jsx` |
| `sql-sc` | `pruebas-sql/ventas-sin-conexion.test.mjs` |
| `sql-conc` | `pruebas-sql/conciliacion-de-ventas.test.mjs` |
| `sql-resc` | `pruebas-sql/rescate-sin-conexion.test.mjs` |
| `sql-piloto` | `pruebas-sql/piloto-sin-conexion.test.mjs` |

## Matriz por escenario

| Escenario | A (automatizada) | B (teléfono real) | C (entorno aislado) |
|---|---|---|---|
| Windows con Chrome y Edge | jsdom en CI (no es un navegador real) | Chrome y Edge: venta, sincronización y respaldo | Sí |
| Android con Chrome y la PWA instalada | — | Instalar, vender sin red, cerrar, reabrir, sincronizar | Sí |
| iPhone con Safari y la PWA instalada | — | Igual que Android, más el aviso de almacenamiento no garantizado | Sí |
| Una pestaña y varias pestañas | `motor` (candado: Web Locks y turno con vencimiento) | Dos pestañas abiertas: una sola envía | Sí |
| Uno y varios dispositivos por ubicación | `motor`, `sql-sc` 10 (última unidad), `pos` | Dos teléfonos en Camión 01 | Sí |
| Cierre y reapertura de la aplicación | `motor` (recuperar lo que quedó «sincronizando», almacén persistente) | Cerrar la app con ventas pendientes y reabrir | Sí |
| Pérdida y recuperación de Internet | `pos` (antes y durante la venta, reconexión), `motor` (espera progresiva, tiempo límite) | Modo avión, zona sin señal, wifi sin salida (portal cautivo) | Sí |
| Reinicio del teléfono con ventas pendientes | `motor` (IndexedDB persiste) | Reiniciar el teléfono con 3 ventas pendientes | Sí |
| Sesión vencida | `motor` (se detiene y conserva), `proveedor` (sin sesión real no envía) | Más de 1 hora sin red con la app abierta, luego reconectar | Sí |
| Cambio de usuario | `proveedor`, `motor` (no se mezclan las colas), `auth` | Dos usuarios en el mismo teléfono | Sí |
| Cambio de ubicación | `proveedor` (aviso, no usa la otra copia), `sql-sc` 15, `Settings.test` (aviso al administrador) | Reasignar al vendedor con ventas pendientes | Sí |
| Revocación de permisos | `auth` (acceso revocado borra el perfil; POS retirado; vencimiento a 7 días con la app abierta) | Desactivar al vendedor mientras está sin red, reconectar | Sí |
| Inventario insuficiente | `pos` (disponible local), `sql-sc`, `sql-piloto` 1 | Vender más de lo que dice la copia | Sí |
| Dos dispositivos venden la última unidad | `sql-sc` 10, `motor` | Dos teléfonos, la misma última unidad | Sí |
| Crédito a clientes existentes | `pos`, `motor` (solo clientes de la copia), `sql-sc` 4 y 21 | Crédito sin red a un cliente de la copia | Sí |
| Respaldo cifrado | `motor` (formato, frase, archivo alterado, iteraciones), `pos`, `proveedor` (administrador respalda todo) | Generar en Android e iPhone y abrirlo en Windows | Sí |
| Recuperación administrativa (rescate) | `conciliacion`, `motor`, `sql-resc`, `sql-piloto` 3 a 5 | Rescatar el archivo de un teléfono | Sí |
| Conciliación y auditoría | `conciliacion`, `sql-conc`, `sql-piloto` 1, 2, 6 y 7 | Aplicar, aplicar con ajuste y anular | Sí |
| El teléfono ve la decisión de conciliación | `motor`, `pos` (OFF-1.4) | Aplicar en Windows y ver el estado en el teléfono | Sí |
| Comprobantes provisionales no fiscales | `pos` (sin CAI ni numeración fiscal), `sql-conc` 6d | Imprimir o compartir el comprobante | Sí |
| Restricción fiscal de Lunacell Store | `sql-sc` 36, `copiaSinConexion.test` (nunca habilita una ubicación fiscal) | — | **Ver el hallazgo de abajo** |
| Teléfono sin espacio | `proveedor` (mensaje claro, nada perdido) | Teléfono casi lleno | Sí |
| Venta en línea sin respuesta | `pos` (reintentar, guardar sin conexión, comprobación de la clave), `motor` | Cortar la red justo al facturar | Sí |
| Una venta en conciliación no toca los libros | `sql-piloto` 1 y 2 | — | — |
| Idempotencia entre rescate y sincronización | `sql-piloto` 3 a 6 | — | — |
| Aislamiento entre ubicaciones | `sql-piloto` 7, pruebas de 0029 (lectura de ventas por ubicación), `copiaSinConexion.test` | — | — |

## Hallazgo: Lunacell Store

En producción, **Lunacell Store tiene `emite_fiscal = false`**. La restricción
de la base (`not (vende_sin_conexion and emite_fiscal)`) solo protege a las
ubicaciones marcadas como fiscales, así que hoy **nada técnico impide habilitar
Store**. Mientras no termine la revisión fiscal:

- no se habilita Store (está en la lista de aprobación);
- si la revisión concluye que Store emite facturas fiscales, primero se marca
  `emite_fiscal = true`. Desde ese momento la base impide habilitarla sin
  conexión.

## Pruebas manuales pendientes (B)

Para cada teléfono anota el modelo, la versión del sistema y la del navegador,
la fecha y quién la hizo. **No se dan por hechas sin ese registro.**

1. Instalar la PWA (Android: «Instalar aplicación»; iPhone: Compartir →
   «Agregar a inicio»).
2. Entrar con conexión y abrir Facturar. Debe verse **En línea · Sin ventas
   pendientes**.
3. Activar el modo avión.
   - Vender 3 veces: contado, contado con 2 productos, y crédito a un cliente de
     la copia.
   - Cada venta debe dar un comprobante provisional `PROV-…`.
4. Cerrar la aplicación y reabrirla sin red.
   - Debe entrar al POS, con las 3 ventas pendientes.
5. Reiniciar el teléfono y repetir el punto 4.
6. Generar un respaldo cifrado.
   - Pasarlo a una computadora y abrirlo en Conciliación → Rescate, en el
     entorno aislado.
7. Quitar el modo avión.
   - Las ventas deben sincronizarse solas en menos de un minuto, con factura.
8. Dos teléfonos sin red venden la última unidad; luego reconectar.
   - Una venta queda registrada y la otra en conciliación.
   - Aplicarla con ajuste y comprobar que el teléfono muestra «Aplicada en
     conciliación».
9. Dejar la app abierta sin red más de 1 hora, vender y reconectar.
   - La sesión se renueva y las ventas se envían.
10. Cerrar sesión con ventas pendientes.
    - Debe aparecer el aviso; las ventas no se pierden.
    - Al volver a entrar con el mismo usuario, se envían.
11. Wifi sin Internet (portal cautivo).
    - Debe decir «Sin conexión con el servidor», no «En línea».
12. Dos pestañas abiertas en la computadora.
    - Una venta pendiente se envía una sola vez.

## Entorno aislado (C): cómo prepararlo sin tocar producción

El entorno aislado es **local**: Supabase local con Docker, datos ficticios y
HTTPS privado para los teléfonos con Tailscale Serve. No se crean proyectos en
la nube ni se toca `software-2`.

- Estrategia y motivos: [entorno-de-pruebas.md](entorno-de-pruebas.md).
- Pasos: [entorno-local.md](entorno-local.md).
