# Anulación de ventas (A-5)

Una venta registrada no se borra ni se renumera: se **anula**.

- **Lo que conserva:** su número, fecha, cliente, productos y total.
- **Lo que cambia:** pasa a «Anulada». La mercadería vuelve a la ubicación desde la que se vendió y queda un registro que nadie puede cambiar ni borrar.

La migración es la [0033](../supabase/migrations/0033_anulacion_de_ventas.sql) y la función, `anular_venta()`.

## Quién puede anular

| | Administrador | Vendedor |
|---|---|---|
| Permisos | Ninguno adicional | **Historial de facturas** y **Anular ventas** |
| Ubicación | Cualquiera de su empresa | Solo la que tiene asignada **ahora** |
| Plazo | Sin límite | El mismo día de la venta, en hora de Honduras |
| Ventas de conciliación | Sí | No |

- Si a un vendedor lo cambian de ubicación, ya no puede anular las ventas de la anterior, aunque las haya hecho él.
- Puede anular ventas de otro vendedor de su misma ubicación.
- Todo esto lo comprueba la base, no la pantalla.

## Qué no se anula con este procedimiento

- **Facturas fiscales** (con CAI). Su tratamiento, anulación o nota de crédito, está pendiente de definir con el contador.
- **Ventas con abonos**, parciales o que la saldaron. El mensaje es: «Esta venta tiene abonos registrados y no puede anularse mediante el procedimiento actual. Contacta con el administrador».
- **Ventas antiguas sin ubicación**, o cuyo inventario no se puede reconstruir con seguridad.

## El dinero

La anulación **nunca** registra que el dinero se devolvió.

**En una venta de contado** se elige una de dos opciones:
- **Reembolso pendiente** (opción por omisión): el cliente pagó y el dinero está por devolver.
- **No se cobró, error de registro**: la venta se registró por error y no entró dinero.

**En una venta a crédito sin abonos:**
- se cancela el saldo pendiente;
- queda registrada como «Crédito sin abonos»;
- no se toca ningún pago.

## Cómo se usa

1. Para que un vendedor pueda anular: **Configuración → Usuarios → Editar → «Anular ventas»** (con «Historial de facturas» marcado). Nadie lo recibe automáticamente.
2. En **Historial**, el botón **Anular** aparece en las ventas que esa persona puede anular. Si la venta no se puede anular, la ventana explica por qué.
3. Se confirma con el motivo, de al menos 10 caracteres. La venta queda con «Anulada», quién, cuándo y el motivo, y su documento lleva el sello **DOCUMENTO ANULADO** en la vista previa, el PDF y la impresión.
4. Las anuladas siguen en el historial (filtro «Anuladas») y no suman a los totales, al panel, a lo más vendido ni a las cuentas por cobrar.

## Despliegue

El orden importa. El frontend nuevo lee `anulaciones_venta`: si se publicara antes de aplicar la migración, el historial no cargaría.

1. **Aplicar la 0033 en producción**, con autorización. Solo agrega cosas y el frontend actual sigue funcionando con ella.
2. **Verificar en solo lectura:**

   ```sql
   select count(*) from anulaciones_venta;                                 -- 0
   select count(*) from permisos_usuario where seccion = 'sales-void';     -- 0
   select has_function_privilege('anon', 'anular_venta(uuid,text,text,text)', 'EXECUTE'); -- false
   select proximo_correlativo_factura, proximo_correlativo_interno, proximo_correlativo_cotizacion from empresas; -- sin cambios
   ```

3. **Merge del PR** y despliegue de Vercel.
4. **Prueba controlada:** el administrador anula **una** venta de contado de prueba que elija el dueño, y se comprueba la existencia de la ubicación, el sello y el registro.

## Reversión

**Primero el frontend:** se revierte el merge en `main`, para que nada lea `anulaciones_venta`.

**Después la base:**

- **Si no hay ninguna anulación** (`select count(*) from anulaciones_venta` da 0) ni nadie tiene el permiso. El bloque lo comprueba por sí mismo al empezar: si encuentra una anulación, una devolución o el permiso asignado, se detiene sin borrar nada.

  ```sql
  begin;
  do $$
  begin
    if exists (select 1 from public.anulaciones_venta)
       or exists (select 1 from public.movimientos_inventario where tipo = 'anulacion_venta') then
      raise exception 'Ya hay anulaciones registradas: no se revierte. Solo se retira el permiso de ejecutar anular_venta.';
    end if;
    if exists (select 1 from public.permisos_usuario where seccion = 'sales-void') then
      raise exception 'Hay usuarios con «Anular ventas»: quítaselo desde Configuración antes de revertir.';
    end if;
  end $$;
  drop function if exists public.anular_venta(uuid, text, text, text);
  drop trigger if exists ventas_anulacion_definitiva on public.ventas;
  drop function if exists public.ventas_anulacion_definitiva();
  drop table if exists public.anulaciones_venta;
  drop function if exists public.anulaciones_venta_inmutable();
  drop index if exists public.movimientos_anulacion_una_vez;
  alter table public.movimientos_inventario drop constraint movimientos_inventario_tipo_check;
  alter table public.movimientos_inventario add constraint movimientos_inventario_tipo_check
    check (tipo in ('entrada', 'salida', 'ajuste', 'devolucion', 'traslado_salida', 'traslado_entrada'));
  alter table public.permisos_usuario drop constraint permisos_usuario_seccion_check;
  alter table public.permisos_usuario add constraint permisos_usuario_seccion_check
    check (seccion in ('dashboard', 'pos', 'quotes', 'products', 'clients', 'suppliers',
                       'sales-history', 'settings', 'locations', 'inventory-own', 'inventory-all'));
  commit;
  ```

  Después se quita la fila de la 0033 de `supabase_migrations.schema_migrations`, buscándola por su versión. La prueba «reversión» de [anulacion-migracion.test.mjs](../pruebas-sql/anulacion-migracion.test.mjs) ejecuta este mismo bloque, leído de este archivo.

- **Si ya hay anulaciones,** no se borran: son registros de lo que pasó. Solo se cierra la función:

  ```sql
  revoke execute on function public.anular_venta(uuid, text, text, text) from authenticated;
  ```

  Las ventas anuladas siguen anuladas, su mercadería sigue devuelta y su registro se conserva.

## Pruebas

- [pruebas-sql/anulacion-de-ventas.test.mjs](../pruebas-sql/anulacion-de-ventas.test.mjs): 39 pruebas contra PostgreSQL real. Cubren autorización, plazo en hora de Honduras, ubicación, bloqueos, concurrencia, inventario, correlativos, resincronización e inmutabilidad, incluido TRUNCATE y lo que puede la clave del servidor.
- [pruebas-sql/anulacion-migracion.test.mjs](../pruebas-sql/anulacion-migracion.test.mjs): la 0033 sobre una base con datos no cambia nada ni da el permiso a nadie, y la reversión se detiene sola si ya hay anulaciones o alguien tiene el permiso.
- Frontend:
  - [utils/anulacion.test.js](../src/utils/anulacion.test.js);
  - [AnularVentaModal.test.jsx](../src/components/ventas/AnularVentaModal.test.jsx);
  - [SalesHistory.anulacion.test.jsx](../src/pages/SalesHistory.anulacion.test.jsx);
  - [InvoiceTemplate.anulacion.test.jsx](../src/components/InvoiceTemplate.anulacion.test.jsx);
  - [metricas.anulacion.test.js](../src/pages/dashboard/metricas.anulacion.test.js);
  - [lib/api/anulacion.test.js](../src/lib/api/anulacion.test.js);
  - [Settings.test.jsx](../src/pages/Settings.test.jsx).
