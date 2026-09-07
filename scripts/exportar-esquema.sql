-- Exporta el esquema real a JSON, para docs/db-export.json
--
-- Se corre en el SQL Editor de Supabase y devuelve una sola celda. Ese
-- texto es, tal cual, el contenido del archivo.
--
-- El export se genera consultando el catálogo de PostgreSQL y no las
-- migraciones: lo que interesa documentar es la base que está corriendo,
-- no la que creemos haber escrito. Si alguna vez difieren, el que manda es
-- este resultado.
--
-- El conteo de filas es exacto, no la estimación de pg_class: se ejecuta un
-- count(*) por tabla con query_to_xml, porque reltuples solo se actualiza
-- después de un vacuum y puede estar muy desfasado.
--
-- La forma del JSON la fija el entregable, con estas llaves y no otras:
--   generado_at, motor, tablas[]
--   tablas[]: nombre, filas, columnas[], indices[], relaciones[], politicas_rls[]
--   columnas[]: nombre, tipo, pk, nulo

with tablas as (
  select c.oid, c.relname as nombre
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),

conteos as (
  select
    t.nombre,
    (xpath(
      '/row/cnt/text()',
      query_to_xml(
        format('select count(*) as cnt from public.%I', t.nombre),
        false, true, ''
      )
    ))[1]::text::bigint as filas
  from tablas t
),

llaves_primarias as (
  select t.nombre as tabla, a.attname as columna
  from tablas t
  join pg_constraint k on k.conrelid = t.oid and k.contype = 'p'
  join pg_attribute a on a.attrelid = t.oid and a.attnum = any (k.conkey)
),

columnas as (
  select
    t.nombre as tabla,
    jsonb_agg(
      jsonb_build_object(
        'nombre', a.attname,
        'tipo', format_type(a.atttypid, a.atttypmod),
        'pk', exists (
          select 1 from llaves_primarias pk
          where pk.tabla = t.nombre and pk.columna = a.attname
        ),
        'nulo', not a.attnotnull
      )
      order by a.attnum
    ) as lista
  from tablas t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  group by t.nombre
),

indices as (
  select tablename as tabla, indexname as nombre
  from pg_indexes
  where schemaname = 'public'
),

politicas as (
  select tablename as tabla, policyname as nombre
  from pg_policies
  where schemaname = 'public'
),

foraneas as (
  select
    origen.relname as tabla,
    a.attname as columna,
    destino.relname || '.' || ad.attname as referencia
  from pg_constraint k
  join pg_class origen on origen.oid = k.conrelid
  join pg_class destino on destino.oid = k.confrelid
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
  join pg_attribute ad on ad.attrelid = k.confrelid and ad.attnum = k.confkey[1]
  where k.contype = 'f'
    and origen.relnamespace = 'public'::regnamespace
)

select jsonb_pretty(jsonb_build_object(
  'generado_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'motor', 'postgres',

  'tablas', (
    select jsonb_agg(
      jsonb_build_object(
        'nombre', t.nombre,
        'filas', co.filas,
        'columnas', cl.lista,

        'indices', coalesce((
          select jsonb_agg(i.nombre order by i.nombre)
          from indices i where i.tabla = t.nombre
        ), '[]'::jsonb),

        'relaciones', coalesce((
          select jsonb_agg(
            jsonb_build_object('columna', f.columna, 'referencia', f.referencia)
            order by f.columna
          )
          from foraneas f where f.tabla = t.nombre
        ), '[]'::jsonb),

        'politicas_rls', coalesce((
          select jsonb_agg(p.nombre order by p.nombre)
          from politicas p where p.tabla = t.nombre
        ), '[]'::jsonb)
      )
      order by t.nombre
    )
    from tablas t
    join conteos co on co.nombre = t.nombre
    join columnas cl on cl.tabla = t.nombre
  )
)) as db_export;
