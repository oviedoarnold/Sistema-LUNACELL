# Piloto controlado: ventas sin conexión en Camión 01

Esta guía es para el administrador que activará el piloto y para quien vende en
Camión 01.

> **Estado:** preparado, **no activado**. Activar el piloto requiere completar
> la [lista de aprobación](lista-aprobacion-piloto.md) y una autorización
> expresa. Camión 02, Bodega y Store no se activan en este piloto.

Para el uso diario consulta también la
[guía de ventas sin conexión](guia-ventas-sin-conexion.md).

## 1. Requisitos del dispositivo

- **Teléfono:** Android con Chrome actualizado o iPhone con Safari en un iOS
  reciente (15.4 o posterior).
- **Espacio:** al menos 1 GB libre.
- **Fecha y hora automáticas activadas.** Si el reloj del teléfono difiere más
  de 10 minutos del servidor, las ventas sin conexión van a conciliación.
- **Batería y cargador** para toda la ruta.
- **Un solo usuario por teléfono durante el piloto**, el del vendedor de Camión
  01.
- **No usar modo incógnito** ni "borrar datos al salir".

## 2. Instalar la aplicación (PWA)

- **Android (Chrome):** abre `https://lunacell.vercel.app` y elige el menú ⋮ →
  **Instalar aplicación**.
- **iPhone (Safari):** abre la misma dirección y elige **Compartir** →
  **Agregar a inicio**.
  - Safari puede borrar los datos de un sitio que no se usa en 7 días si **no**
    está instalado: instálalo siempre.
- Abre LUNACELL **desde el ícono instalado**, no desde el navegador.

## 3. Primer inicio de sesión (con Internet)

1. Entra con el usuario del vendedor.
2. Abre **Facturar** y espera a ver la barra **En línea · Sin ventas
   pendientes**. Esa barra aparece solo si Camión 01 está habilitado.
3. Si el navegador pregunta por almacenamiento, acepta.
4. Si aparece "El navegador no garantiza conservar los datos", instala la
   aplicación (paso 2) y guarda respaldos con más frecuencia.

Requisito: para poder entrar sin conexión, el vendedor debe haber entrado
**con conexión en los últimos 7 días** en ese teléfono.

## 4. Preparar la copia local antes de salir

La copia trae productos, precios, existencias de Camión 01 y clientes.

- **Cuándo se descarga:** sola, con conexión, al abrir Facturar (cada 15
  minutos como máximo), después de cada venta en línea y después de
  sincronizar.
- **Antes de salir a ruta:** abre Facturar con Internet y espera unos segundos.
  Si el traslado al camión se registró hace poco, cierra y vuelve a abrir
  Facturar para refrescarla.
- **Si la copia tiene más de 12 o 24 horas,** la barra lo avisa. Conéctate para
  actualizarla.

## 5. Vender sin conexión

- Cuando no hay servidor, la barra dice **Sin conexión** y aparece **Modo sin
  conexión**.
- El botón dice **Guardar venta sin conexión**.
- Cada venta entrega un **comprobante provisional** `PROV-XXXX-000001`.
  - Dice "No es una factura". No lleva CAI ni número fiscal.
- **Crédito:** solo a clientes de la copia. No se pueden crear clientes sin
  conexión.
- **Existencias:** se descuenta lo que el teléfono ya vendió. Si otro teléfono
  vendió lo mismo, lo resuelve el servidor (conciliación).

## 6. Identificar una venta pendiente

En **Ventas sin conexión** (botón de la barra):

| Estado | Qué significa |
|---|---|
| **Pendiente** | Solo en el teléfono; se enviará sola. |
| **Registrada** | Con su número de factura. |
| **En conciliación** | El servidor la guardó y un administrador debe decidir. **No repetir la venta.** |
| **Aplicada en conciliación** | El administrador la aplicó. |
| **Anulada en conciliación** | El administrador la anuló. |
| **Error** | No aceptada tal como está; avisar al administrador. |

## 7. Recuperar la conexión y sincronizar

- Las ventas salen **solas**: al volver la red, al abrir la app y cada pocos
  segundos mientras haya pendientes.
- También se puede pulsar **Sincronizar ahora**.
- **Si la sesión venció,** la barra pide iniciar sesión. Las ventas no se
  pierden y se envían al entrar.

## 8. Generar un respaldo cifrado

Hazlo antes de entregar o reiniciar el teléfono, o si pasarás varios días sin
conexión.

1. **Ventas sin conexión** → **Respaldo cifrado**.
2. Escribe una frase de al menos 10 caracteres. Anótala aparte.
3. Entrega el archivo y la frase **por separado** al administrador.

El respaldo no borra nada.

## 9. Ante una venta en conciliación

- **Vendedor:** no repite la venta ni cobra de nuevo, y avisa al administrador.
- **Administrador:** en **Conciliación → Ventas por conciliar**, revisa el
  motivo y decide, siempre con un motivo escrito:
  - **Aplicar**;
  - **Aplicar con ajuste**, si faltó registrar existencia en el camión;
  - **Anular**, si fue un duplicado. La nota "Intento en línea sin respuesta"
    ayuda a detectarlos.
- El teléfono muestra la decisión después de la próxima sincronización.

## 10. Cierre de operaciones del día

Antes de cerrar la jornada o entregar el camión:

1. Con Internet, abre **Facturar** y pulsa **Sincronizar ahora**.
2. La barra debe decir **Sin ventas pendientes**.
3. En **Ventas sin conexión** no debe quedar ninguna **Pendiente** ni con
   **Error**.
4. Si quedan, no cierres sesión. Avisa al administrador y genera un respaldo
   cifrado.
5. **Administrador:** revisar Conciliación y resolver lo pendiente del día.

## 11. Contingencia: si falla el dispositivo

| Situación | Qué hacer |
|---|---|
| El teléfono funciona, pero el vendedor no puede entrar (sesión vencida, cambio de contraseña) | Un **administrador** entra en ese teléfono con conexión, abre Facturar → **Ventas sin conexión** → **Respaldo cifrado**. Como administrador, el respaldo incluye las ventas de todos los usuarios del teléfono. Luego las rescata en **Conciliación → Rescate**. |
| El teléfono se reinicia o se cierra la app | Las ventas siguen guardadas: reabrir la app y sincronizar. |
| El teléfono se dañó y no enciende | Sin un respaldo previo, las ventas guardadas solo en él no se pueden recuperar. Por eso: **sincronizar seguido y respaldar si se pasará mucho tiempo sin conexión.** Registrar lo vendido en papel como último recurso y conciliarlo después. |
| Se borraron los datos del navegador | Igual que el caso anterior. Avisar de inmediato. |
| El teléfono no tiene espacio | La app lo dice al guardar. Liberar espacio; las ventas ya guardadas siguen a salvo. |

## 12. Activación

Solo con la lista de aprobación completa y con autorización. Ejecutar como
administrador en el **SQL Editor de Supabase**. El disparador de 0027 deja
cambiar la marca solo a un administrador o al dueño de la base.

```sql
-- Activar el piloto SOLO en Camión 01. Comprueba antes el nombre exacto.
update public.ubicaciones
   set vende_sin_conexion = true
 where nombre = 'Camión 01'
   and emite_fiscal = false
   and activa = true
returning id, nombre, vende_sin_conexion;
```

Debe devolver **una sola fila**. Si devuelve otra cosa, no continúes.

## 13. Reversión: desactivar sin perder ventas

Desactivar no borra nada en el servidor ni en los teléfonos. Pero desde ese
momento el servidor manda a conciliación ("ubicación no habilitada") las ventas
sin conexión que lleguen después. Por eso, **primero se vacían los teléfonos**:

1. Pedir a cada teléfono de Camión 01, con conexión, **Sincronizar ahora**,
   hasta ver **Sin ventas pendientes**.
2. Si un teléfono no puede, generar su **respaldo cifrado**.
3. Desactivar:

   ```sql
   update public.ubicaciones
      set vende_sin_conexion = false
    where nombre = 'Camión 01'
   returning id, nombre, vende_sin_conexion;
   ```

4. Lo que llegue después, o los respaldos, quedan en **Conciliación**: se
   revisan y se deciden. **Nunca se borran ventas pendientes** ni filas de
   conciliación (la base lo impide).
5. En los teléfonos, el POS vuelve a funcionar solo en línea. Las ventas que
   aún tengan pendientes siguen guardadas y se envían al conectarse.

## 14. Verificación de solo lectura durante el piloto

```sql
select
  (select string_agg(nombre || '=' || vende_sin_conexion, ', ' order by nombre) from public.ubicaciones) as habilitadas,
  (select count(*) from public.ventas where origen = 'sin_conexion') as ventas_sin_conexion,
  (select count(*) from public.ventas_por_conciliar where estado = 'pendiente') as por_conciliar,
  (select count(*) from public.auditoria_rescates) as rescates;
```
