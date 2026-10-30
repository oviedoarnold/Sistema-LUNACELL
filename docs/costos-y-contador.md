# Costos confidenciales y perfil de contador

Regla del cliente: el costo de adquisición, el margen, la utilidad y lo que
permita deducirlos solo los consulta un administrador. Tampoco los ve el
contador, que además solo consulta: no registra, edita, elimina, anula ni
aprueba nada.

## Quién ve qué

| Perfil | Rol en la base | Costo | Precio de venta | Escribe |
|---|---|---|---|---|
| Administrador | `admin` | Sí | Sí | Sí |
| Contador | `contador` | No | Sí | **No, en ninguna tabla** |
| Vendedor | `vendedor` | No | Sí | Según sus secciones |
| Encargado de inventario | `vendedor` con `products` | No | Sí, y lo corrige | Productos (sin el costo) e inventario |
| Encargado de bodega | `vendedor` con `inventory-all` | No | Sí | Según sus secciones |

El encargado de inventario y el de bodega no son roles aparte: son
vendedores con las secciones que les toca. Lo que cambia es que ninguno de
los dos ve el costo, aunque tenga `products`.

## Cómo se protege el costo (0035)

En la base:

- **La columna `costo`.** `authenticated` no tiene el privilegio de leerla.
  Sin él, PostgREST no la devuelve, ni filtra ni ordena por ella. Las demás
  columnas se conceden una por una, y una prueba falla si una columna nueva
  queda sin conceder.
- **La vista.** `productos_con_stock` ya no trae el costo.
- **La lectura del administrador.** `costos_de_productos()` comprueba el rol
  en la base y a cualquier otro le responde con un rechazo `42501`.
- **La escritura.** Un disparador descarta el costo que mande alguien que no
  es administrador: al crear un producto queda en 0, y al cambiarlo se
  conserva el que había.

En el frontend:

- El catálogo no lleva el costo.
- Productos muestra la columna y el campo **Costo** solo al administrador,
  con los valores de `costos_de_productos()`. Si esa función falla, se ve
  «—» y guardar no toca el costo.

Se revisaron todos los lugares por donde el costo podía salir: tablas,
vistas, funciones, la Edge Function `acceso`, los PDF, la exportación sin
conexión, el panel y las cotizaciones. Ninguno calcula margen ni utilidad.

## Cómo funciona el contador (0036)

**Se crea** en **Configuración → Usuarios → Nuevo usuario → Rol: Contador
(solo consulta)**. Solo se le ofrecen estas secciones:

- Dashboard;
- Cotizar;
- Clientes;
- Proveedores;
- Historial de facturas, que incluye Cuentas por cobrar;
- el inventario, de su ubicación o de todas.

**Ve:**

- Con «Historial de facturas», las ventas, los abonos y los pagos de
  **todas** las ubicaciones, porque no opera desde ninguna.
- Con «El inventario de todas las ubicaciones», las existencias y los
  traslados de todas.
- Las facturas y las cotizaciones, para consultarlas e imprimirlas.

**No puede escribir**, y no depende de los botones:

- Un disparador por sentencia en cada tabla de `public` rechaza cualquier
  escritura de una cuenta de contador, con el error `42501` «El perfil de
  contador es de solo consulta».
- Vale para la API directa y para las funciones SECURITY DEFINER: venta,
  cobro, inventario, traslado, anulación y conciliación. El disparador mira
  `auth.uid()`, que dentro de esas funciones sigue siendo el de quien llama.
- Las imágenes de producto viven en Storage, y sus políticas de escritura
  lo excluyen.
- Aunque alguien le marque `pos` o `products` por SQL, ni la base ni la
  pantalla le dejan usarlos.

**No es administrador.** No ve costos, ni la lista de usuarios, ni la
auditoría de accesos o de rescates, ni la conciliación.

**Las pantallas**, además, le esconden lo que escribe:

- en Clientes y Proveedores, «Nuevo» y «Editar»;
- en Cotizar, armar, facturar y eliminar;
- en Cuentas por cobrar, «Abonar»;
- en Traslados, el formulario;
- en el Historial, «Anular».

**Inicio de sesión.** Lo hace la función `acceso` con la clave del
servidor, sin `auth.uid()`, así que el disparador no se lo impide.

## Despliegue

Aquí el orden es el contrario al de la 0033: **primero el frontend,
después las migraciones.**

- El frontend nuevo funciona con la base vieja y con la nueva.
- El frontend viejo, con la base nueva, deja de mostrar el costo y lo manda
  en 0 al guardar un producto: si un administrador guardara desde una
  versión vieja, el costo de ese producto quedaría en 0.

Pasos, cada uno con autorización:

1. **Merge del PR.** Cloudflare Pages publica el frontend solo.
2. **Comprobar el commit nuevo** en `/api/health`. Cada equipo de
   administrador abre la aplicación con red, para que se actualice el
   service worker.
3. **Antes de aplicar, en solo lectura:**

   ```sql
   select count(*), sum(costo) from productos;               -- anotar
   select rol, count(*) from usuarios group by rol;           -- sin 'contador'
   ```

4. **Aplicar la 0035 y después la 0036** con `apply_migration`, y
   registrarlas como se hizo con la 0033 y la 0034.
5. **Verificar en solo lectura:**

   ```sql
   select has_column_privilege('authenticated', 'public.productos', 'costo', 'select');   -- false
   select has_column_privilege('authenticated', 'public.productos', 'precio', 'select');  -- true
   select count(*) from information_schema.columns
    where table_name = 'productos_con_stock' and column_name = 'costo';                   -- 0
   select count(*) from pg_trigger where tgname = 'impedir_escritura_del_contador';      -- una por tabla de public
   select count(*), sum(costo) from productos;                                           -- igual que en el paso 3
   ```

6. **Prueba controlada:**
   - El administrador ve el costo en Productos.
   - Un vendedor de prueba no lo ve.
   - Un contador de prueba, creado con autorización, consulta el historial
     y no puede guardar nada.

Mientras las migraciones no estén aplicadas, el administrador ve «—» en la
columna Costo y no puede corregirlo. Lo demás funciona igual.

## Reversión

**El frontend no necesita revertirse:** funciona con la base vieja. Si
hubiera que hacerlo, se revierte el merge.

**La 0036.** Se revierte solo si no hay ningún contador; el bloque lo
comprueba y se detiene si lo hay:

```sql
begin;
do $$
declare v_tabla text;
begin
  if exists (select 1 from public.usuarios where rol = 'contador') then
    raise exception 'Hay usuarios contador: cámbiales el rol antes de revertir.';
  end if;
  for v_tabla in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('drop trigger if exists impedir_escritura_del_contador on public.%I', v_tabla);
  end loop;
end $$;
drop function if exists public.impedir_escritura_del_contador();
alter table public.usuarios drop constraint if exists usuarios_rol_check;
alter table public.usuarios add constraint usuarios_rol_check check (rol in ('admin', 'vendedor'));
-- Las políticas ventas_lectura y pagos_lectura de la 0029 y las tres de escritura de imágenes
-- de la 0024 se recrean copiándolas de esas migraciones.
drop function if exists public.usuario_es_contador();
commit;
```

**La 0035.** El costo vuelve a quedar a la vista de todos, así que solo se
revierte si algo grave lo exige:

```sql
begin;
drop trigger if exists productos_costo_solo_admin on public.productos;
drop function if exists public.productos_costo_solo_admin();
drop function if exists public.costos_de_productos();
grant select on public.productos to authenticated;
-- productos_con_stock se recrea copiándola de la 0007, con p.costo.
commit;
```

Ninguna de las dos reversiones toca filas ni costos guardados.

## Pruebas

- `pruebas-sql/costos-confidenciales.test.mjs`. Contra PostgreSQL real:
  - el administrador consulta y fija el costo;
  - contador, vendedor, encargado de inventario y de bodega no lo leen, ni
    filtran ni ordenan por él;
  - la función les responde con un rechazo;
  - ninguna vista ni función de la base expone costo, margen ni utilidad;
  - el precio sigue visible;
  - el costo que manda un no administrador se descarta;
  - la venta y el inventario siguen funcionando.
- `pruebas-sql/perfil-contador.test.mjs`:
  - el contador lee ventas de todas las ubicaciones con `sales-history`, y
    nada sin ella;
  - no escribe ni por la API ni por las funciones de venta, cobro,
    inventario, traslado y anulación, aunque tenga todos los permisos;
  - cada tabla de `public` lleva el disparador;
  - los demás roles siguen operando.
- `src/pages/Products.test.jsx`, `src/pages/perfilContador.test.jsx`,
  `src/pages/Settings.test.jsx` y `src/lib/api/catalogos.test.js`:
  - qué muestra cada pantalla a cada perfil;
  - que guardar sin el costo no lo cambia.
