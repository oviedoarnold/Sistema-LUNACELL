-- Corrección de la 0046: la fila «Sin ubicación» del reporte diario de caja.
--
-- reporte_diario_de_caja() calcula los cobros de cada fila de por_ubicacion con
-- sumar_de(lista, campo, ubicación). En la 0046, una ubicación null significaba
-- «todas» (era el valor por omisión), así que la fila «Sin ubicación» (abonos
-- antiguos sin ubicación) recibía las facturas y los cobros de pedidos de todas
-- las ubicaciones. Los totales, las demás filas y reporte_medios_de_caja()
-- estaban bien.
--
-- Ahora son dos funciones:
-- - sumar_de(lista, campo): suma todo, como la usan los totales;
-- - sumar_de(lista, campo, ubicación): solo esa ubicación; null es «sin ubicación».
-- Los reportes no cambian de código: sus llamadas con dos argumentos van a la
-- primera y las de cada fila, a la segunda. Quitar un valor por omisión exige
-- borrar y volver a crear la función; ningún objeto depende de ella.
--
-- No toca filas ni otras funciones. Idempotente.

drop function if exists public.sumar_de(jsonb, text, text);

-- Suma de un campo de una lista jsonb.
create or replace function public.sumar_de(p_lista jsonb, p_campo text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((e->>p_campo)::numeric), 0)
    from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) e
$$;

-- Lo mismo, solo de una ubicación; null es «sin ubicación», no «todas».
create or replace function public.sumar_de(p_lista jsonb, p_campo text, p_ubicacion text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((e->>p_campo)::numeric), 0)
    from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) e
   where (e->>'ubicacion_id') is not distinct from p_ubicacion
$$;

revoke execute on function public.sumar_de(jsonb, text), public.sumar_de(jsonb, text, text) from public, anon;
grant execute on function public.sumar_de(jsonb, text), public.sumar_de(jsonb, text, text) to authenticated;
