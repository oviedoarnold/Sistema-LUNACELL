# Auditoría de rescates y ventas por conciliar protegidas (SEC-5)

Migración [0034](../supabase/migrations/0034_auditoria_de_rescates_protegida.sql).

## El defecto

Las dos tablas son de la 0027. `auditoria_rescates` registra cada intento de rescate de ventas sin conexión. `ventas_por_conciliar` guarda las ventas sin conexión que esperan a que un administrador las aplique o las anule.

A las dos, la 0027 les quitó todo a `anon` y `authenticated`. Además, sus disparadores de fila detienen el DELETE y los cambios a los datos. Pero:

- **`service_role` conservaba todos los privilegios.** Tenía INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES y TRIGGER, que es lo que Supabase concede por omisión, y además pasa por encima de RLS. Con la clave del servidor se podía:
  - **insertar un intento de rescate falso** a nombre de cualquier administrador;
  - **inventar una venta por conciliar**;
  - **resolver una venta pendiente con un UPDATE directo**, sin pasar por `conciliar_venta()` ni por el administrador. El disparador de la 0027 deja pasar esa primera resolución.
- **TRUNCATE vaciaba las dos tablas de una vez,** porque no dispara los disparadores de fila.
- **La secuencia del `id` de la auditoría estaba abierta.** Tenía USAGE, SELECT y UPDATE para `anon`, `authenticated` y `service_role`, y nadie los necesita.

Estado en producción antes de la 0034, según consultas de solo lectura del 2026-10-26 y el 2026-10-28:

| Rol | `auditoria_rescates` | su secuencia | `ventas_por_conciliar` |
|---|---|---|---|
| `anon` | — | USAGE, SELECT, UPDATE | — |
| `authenticated` | SELECT | USAGE, SELECT, UPDATE | SELECT |
| `service_role` | todo (`arwdDxtm`) | USAGE, SELECT, UPDATE | todo (`arwdDxtm`) |

## La corrección

Es lo mismo que la 0033 ya trae para `anulaciones_venta`:

| Rol | `auditoria_rescates` | su secuencia | `ventas_por_conciliar` |
|---|---|---|---|
| `anon` | — | — | — |
| `authenticated` | SELECT, con la política de siempre (solo el administrador de la empresa) | — | SELECT, con la política de siempre (el administrador, todas; el vendedor, las suyas) |
| `service_role` | SELECT | — | SELECT |

Cada tabla recibe además un disparador por sentencia que detiene TRUNCATE para todos, también para el dueño:

- **`auditoria_rescates_sin_vaciar`.** Reutiliza `auditoria_rescates_inmutable()` de la 0027 sin cambiarla.
- **`ventas_por_conciliar_sin_vaciar`.** Usa una función nueva y propia. La de la 0027 consulta `old.estado`, y un disparador por sentencia no tiene fila vieja.

Quién sigue escribiendo: tres funciones SECURITY DEFINER del dueño de las tablas, que no dependen de estos privilegios.

| Tabla | Función | Desde dónde se llama |
|---|---|---|
| `auditoria_rescates` | `rescatar_venta_sin_conexion()` | el rescate |
| `ventas_por_conciliar` | `guardar_venta_por_conciliar()` | la sincronización sin conexión y el rescate |
| `ventas_por_conciliar` | `conciliar_venta()` | la conciliación |

La aplicación solo lee las dos tablas y no usa `service_role` en ningún lado.

La migración no toca ninguna fila, ni las políticas de lectura, ni las funciones de sincronización, rescate y conciliación, ni los disparadores de la 0027.

## Despliegue

Solo se cambia la base de datos; el frontend sigue igual. Se aplica la 0034 y se comprueba en solo lectura:

```sql
select
  (select relacl::text from pg_class where oid = 'public.auditoria_rescates'::regclass) as auditoria,
  (select relacl::text from pg_class where oid = 'public.auditoria_rescates_id_seq'::regclass) as secuencia,
  (select relacl::text from pg_class where oid = 'public.ventas_por_conciliar'::regclass) as por_conciliar,
  (select count(*) from pg_trigger where tgname in ('auditoria_rescates_sin_vaciar', 'ventas_por_conciliar_sin_vaciar')) as disparadores_truncate;
```

Lo esperado:

- `auditoria` y `por_conciliar` con `{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}`;
- la secuencia solo con `postgres`;
- `disparadores_truncate` en 2.

## Reversión

Devuelve los privilegios exactos que había en producción y quita los dos disparadores y la función nueva. No toca ninguna fila.

```sql
begin;
drop trigger if exists auditoria_rescates_sin_vaciar on public.auditoria_rescates;
drop trigger if exists ventas_por_conciliar_sin_vaciar on public.ventas_por_conciliar;
drop function if exists public.ventas_por_conciliar_sin_vaciar();
grant all on public.auditoria_rescates to service_role;
grant all on public.ventas_por_conciliar to service_role;
grant usage, select, update on sequence public.auditoria_rescates_id_seq to anon, authenticated, service_role;
commit;
```

Después se quita la fila de la 0034 de `supabase_migrations.schema_migrations`, buscándola por su versión. La prueba «reversión» de [auditoria-rescates-protegida.test.mjs](../pruebas-sql/auditoria-rescates-protegida.test.mjs) ejecuta este mismo bloque, leído de este archivo.
