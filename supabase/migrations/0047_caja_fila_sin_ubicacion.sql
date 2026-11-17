-- Corrección de la 0046: la fila «Sin ubicación» del reporte diario de caja.
--
-- reporte_diario_de_caja() calcula los cobros de cada fila de por_ubicacion
-- sumando lo de pedidos de esa ubicación con sumar_de(lista, campo, ubicación).
-- En sumar_de(), una ubicación null significa «todas», así que la fila
-- «Sin ubicación» (abonos antiguos sin ubicación) recibía las facturas y los
-- cobros de pedidos de todas las ubicaciones. Los totales, las demás filas y
-- reporte_medios_de_caja() estaban bien.
--
-- sumar_de_la_ubicacion() compara la ubicación tal cual: null solo coincide con
-- null. reporte_diario_de_caja() la usa en las filas; su cuerpo es el de la 0046
-- con solo ese cambio.
--
-- No toca filas ni otras funciones. Idempotente.

-- Suma de un campo de una lista jsonb, de una ubicación; null es «sin ubicación».
create or replace function public.sumar_de_la_ubicacion(p_lista jsonb, p_campo text, p_ubicacion text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((e->>p_campo)::numeric), 0)
    from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) e
   where (e->>'ubicacion_id') is not distinct from p_ubicacion
$$;

revoke execute on function public.sumar_de_la_ubicacion(jsonb, text, text) from public, anon;
grant execute on function public.sumar_de_la_ubicacion(jsonb, text, text) to authenticated;

create or replace function public.reporte_diario_de_caja(p_dia date default null, p_ubicacion uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_base    jsonb := public.reporte_diario(p_dia, p_ubicacion);
  v_dia     date := (v_base->>'dia')::date;
  v_caja    jsonb;
  v_cobros  jsonb;
  v_fact    jsonb;
  v_primas  jsonb;
  v_i       jsonb := v_base->'indicadores';
  v_cobrado numeric;
begin
  v_caja := public.caja_de_pedidos_del_dia(
    v_dia::timestamp at time zone 'America/Tegucigalpa',
    (v_dia + 1)::timestamp at time zone 'America/Tegucigalpa',
    p_ubicacion);

  v_cobros := v_caja->'cobros';
  v_fact   := v_caja->'facturas';
  v_primas := v_caja->'primas';
  v_cobrado := public.sumar_de(v_cobros, 'monto');

  v_i := v_i || jsonb_build_object(
    'abonos_total', (v_i->>'abonos_total')::numeric - public.sumar_de(v_primas, 'monto'),
    'abonos_cantidad', (v_i->>'abonos_cantidad')::int - jsonb_array_length(v_primas),
    'cobros_total', (v_i->>'cobros_total')::numeric - public.sumar_de(v_fact, 'total') - public.sumar_de(v_primas, 'monto') + v_cobrado,
    'cargos_total', (v_i->>'cargos_total')::numeric - public.sumar_de(v_fact, 'cargo') - public.sumar_de(v_primas, 'cargo') + public.sumar_de(v_cobros, 'cargo'),
    'total_cobrado', (v_i->>'total_cobrado')::numeric
                     - public.sumar_de(v_fact, 'total') - public.sumar_de(v_fact, 'cargo')
                     - public.sumar_de(v_primas, 'monto') - public.sumar_de(v_primas, 'cargo')
                     + v_cobrado + public.sumar_de(v_cobros, 'cargo'),
    'cobros_por_cuenta_de_otras', v_cobrado,
    'cobros_por_cuenta_de_otras_cantidad', jsonb_array_length(v_cobros)
  );

  return v_base || jsonb_build_object(
    'indicadores', v_i,
    'por_ubicacion', coalesce((
      select jsonb_agg(
               u.fila || jsonb_build_object(
                 'abonos_total', (u.fila->>'abonos_total')::numeric - public.sumar_de_la_ubicacion(v_primas, 'monto', u.fila->>'ubicacion_id'),
                 'cobros_total', (u.fila->>'cobros_total')::numeric
                                 - public.sumar_de_la_ubicacion(v_fact, 'total', u.fila->>'ubicacion_id')
                                 - public.sumar_de_la_ubicacion(v_primas, 'monto', u.fila->>'ubicacion_id')
                                 + public.sumar_de_la_ubicacion(v_cobros, 'monto', u.fila->>'ubicacion_id'),
                 'cobros_por_cuenta_de_otras', public.sumar_de_la_ubicacion(v_cobros, 'monto', u.fila->>'ubicacion_id')
               )
               order by u.n
             )
        from jsonb_array_elements(v_base->'por_ubicacion') with ordinality u(fila, n)
    ), '[]'::jsonb),
    'por_vendedor', coalesce((
      select jsonb_agg(
               v.fila || jsonb_build_object(
                 'abonos_total', (v.fila->>'abonos_total')::numeric
                                 - coalesce((select sum((p->>'monto')::numeric) from jsonb_array_elements(v_primas) p
                                              where (p->>'usuario_id') is not distinct from (v.fila->>'usuario_id')), 0)
               )
               order by v.n
             )
        from jsonb_array_elements(v_base->'por_vendedor') with ordinality v(fila, n)
    ), '[]'::jsonb),
    'abonos', coalesce((
      select jsonb_agg(a.fila order by a.n)
        from jsonb_array_elements(v_base->'abonos') with ordinality a(fila, n)
       where not exists (select 1 from jsonb_array_elements(v_primas) p where p->>'abono_id' = a.fila->>'id')
    ), '[]'::jsonb),
    'ventas', coalesce((
      select jsonb_agg(
               s.fila || coalesce((
                 select jsonb_build_object('pedido', f->>'pedido', 'cobrado_en', f->>'cobrado_en')
                   from jsonb_array_elements(v_fact) f where f->>'venta_id' = s.fila->>'id'
               ), '{}'::jsonb)
               order by s.n
             )
        from jsonb_array_elements(v_base->'ventas') with ordinality s(fila, n)
    ), '[]'::jsonb),
    'cobros_de_pedidos', v_cobros,
    'liquidaciones_del_dia', v_caja->'liquidaciones',
    'saldos_por_liquidar', v_caja->'saldos'
  );
end $$;

revoke execute on function public.reporte_diario_de_caja(date, uuid) from public, anon;
grant execute on function public.reporte_diario_de_caja(date, uuid) to authenticated;
