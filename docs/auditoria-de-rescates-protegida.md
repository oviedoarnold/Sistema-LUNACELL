# Auditoría de rescates protegida (SEC-5)

Migración [0034](../supabase/migrations/0034_auditoria_de_rescates_protegida.sql).

## El defecto

`auditoria_rescates` (0027) guarda cada intento de rescate de ventas sin conexión. La 0027 le quitó todo a `anon` y `authenticated` y detuvo UPDATE y DELETE con un disparador de fila, pero:

- `service_role` conservaba INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES y TRIGGER, los que Supabase concede por omisión, y además pasa por encima de RLS. Con la clave del servidor se podía **insertar un intento de rescate falso** a nombre de cualquier administrador.
- TRUNCATE no dispara los disparadores de fila: quien lo tuviera **vaciaba la tabla entera**.
- La secuencia de `id` quedó con USAGE, SELECT y UPDATE para `anon`, `authenticated` y `service_role`, sin que nadie los necesite.

Estado en producción antes de la 0034 (consulta de solo lectura del 2026-10-26):

| Rol | Tabla | Secuencia |
|---|---|---|
| `anon` | — | USAGE, SELECT, UPDATE |
| `authenticated` | SELECT | USAGE, SELECT, UPDATE |
| `service_role` | todo (`arwdDxtm`) | USAGE, SELECT, UPDATE |

## La corrección

Lo mismo que la 0033 ya trae para `anulaciones_venta`:

| Rol | Tabla | Secuencia |
|---|---|---|
| `anon` | — | — |
| `authenticated` | SELECT (con la política de siempre: solo el administrador de la empresa) | — |
| `service_role` | SELECT | — |

Y un disparador por sentencia, `auditoria_rescates_sin_vaciar`, que detiene TRUNCATE para todos, también para el dueño. Reutiliza la función `auditoria_rescates_inmutable()` de la 0027 sin cambiarla.

El único que inserta, `rescatar_venta_sin_conexion()`, es SECURITY DEFINER del dueño de la tabla y no depende de esos privilegios. La aplicación no usa `service_role` en ningún lado.

No se toca ninguna fila de la auditoría, ni la política de lectura, ni las funciones de rescate y conciliación.

## Despliegue

Solo base de datos: el frontend no cambia. Se aplica la 0034 y se comprueba en solo lectura:

```sql
select
  (select relacl::text from pg_class where oid = 'public.auditoria_rescates'::regclass) as tabla,
  (select relacl::text from pg_class where oid = 'public.auditoria_rescates_id_seq'::regclass) as secuencia,
  (select count(*) from pg_trigger where tgname = 'auditoria_rescates_sin_vaciar') as disparador_truncate;
```

Lo esperado: la tabla con `postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres`, la secuencia solo con `postgres`, y el disparador en 1.

## Reversión

Devuelve los privilegios exactos que había en producción y quita el disparador. No toca ninguna fila.

```sql
begin;
drop trigger if exists auditoria_rescates_sin_vaciar on public.auditoria_rescates;
grant all on public.auditoria_rescates to service_role;
grant usage, select, update on sequence public.auditoria_rescates_id_seq to anon, authenticated, service_role;
commit;
```

Después se quita la fila de la 0034 de `supabase_migrations.schema_migrations`, buscándola por su versión. La prueba «reversión» de [auditoria-rescates-protegida.test.mjs](../pruebas-sql/auditoria-rescates-protegida.test.mjs) ejecuta este mismo bloque, leído de este archivo.
