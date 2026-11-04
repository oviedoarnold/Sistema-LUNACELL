-- El reporte diario de ventas y movimientos, solo para administradores.
--
-- reporte_diario(día, ubicación) devuelve de una vez todo lo que muestra la
-- pantalla Reportes. Los importes se calculan aquí, con `numeric`, y la
-- pantalla solo los muestra: sumarlos en el navegador sería sumar decimales
-- binarios.
--
-- Corre como quien llama (SECURITY INVOKER), a propósito: las políticas de
-- RLS y los privilegios por columna (0035) siguen valiendo dentro. No lee
-- productos.costo, y no podría: `authenticated` no tiene ese privilegio.
-- Lo que cierra el reporte a los demás roles es la comprobación del
-- principio, porque el vendedor y el contador sí pueden leer parte de estas
-- tablas.
--
-- Cómo se cuenta:
-- - El día es el de Honduras: de 00:00 inclusive a 00:00 del día siguiente,
--   exclusive.
-- - Una venta es del día de `ventas.fecha`, que en una venta sin conexión o
--   conciliada es la hora en que se hizo, no la de su sincronización. Las
--   que aún están en el teléfono o por conciliar no están en `ventas`: no
--   cuentan.
-- - Las ventas válidas son las que no están anuladas. Una anulación cuenta
--   el día en que se anuló y aparte, con la ubicación de la venta.
-- - Un cobro es una venta de contado válida, el día de la venta, o un abono,
--   el día del abono y nunca el de la venta. Se suman los abonos y no los
--   pagos: un pago se reparte en abonos, y sumar los dos duplicaría el dinero.
-- - Un abono cuenta en la ubicación donde se cobró; si el pago no la tiene
--   (lo cobró un administrador sobre todas), en la de su venta.
-- - Las ventas y los movimientos anteriores a las ubicaciones no tienen una:
--   aparecen como «Sin ubicación», solo en la vista de todas.
--
-- Lo que NO hace: no escribe nada, ni cambia ninguna política. Idempotente.

/*
  Los abonos se consultan por su fecha, y esta tabla no tenía un índice para
  eso. Ventas, movimientos y anulaciones ya lo tienen.
*/
create index if not exists idx_abonos_empresa_fecha
  on public.abonos (empresa_id, fecha desc);

create or replace function public.reporte_diario(
  p_dia       date default null,
  p_ubicacion uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_dia     date;
  v_desde   timestamptz;
  v_hasta   timestamptz;
  v_reporte jsonb;
begin
  if not coalesce(public.usuario_es_admin(), false) then
    raise exception 'El reporte diario es solo para administradores'
      using errcode = '42501';
  end if;

  v_empresa := public.empresa_del_usuario();
  v_dia     := coalesce(p_dia, (now() at time zone 'America/Tegucigalpa')::date);
  v_desde   := v_dia::timestamp at time zone 'America/Tegucigalpa';
  v_hasta   := (v_dia + 1)::timestamp at time zone 'America/Tegucigalpa';

  with
  ventas_dia as (
    select v.id, v.fecha, v.numero_factura, v.correlativo, v.ubicacion_id, v.usuario_id,
           v.nombre_cliente, v.forma_pago, v.total, v.estado, v.origen
      from public.ventas v
     where v.empresa_id = v_empresa
       and v.fecha >= v_desde and v.fecha < v_hasta
       and (p_ubicacion is null or v.ubicacion_id = p_ubicacion)
  ),
  validas as (
    select * from ventas_dia where estado <> 'anulada'
  ),
  abonos_dia as (
    select a.id, a.fecha, a.monto, a.usuario_id, a.pago_id,
           v.numero_factura, v.fecha as fecha_venta, v.nombre_cliente,
           coalesce(p.ubicacion_id, v.ubicacion_id) as ubicacion_id
      from public.abonos a
      join public.ventas v on v.id = a.venta_id
      left join public.pagos p on p.id = a.pago_id
     where a.empresa_id = v_empresa
       and a.fecha >= v_desde and a.fecha < v_hasta
       and (p.id is null or p.estado = 'aplicado')
       and (p_ubicacion is null or coalesce(p.ubicacion_id, v.ubicacion_id) = p_ubicacion)
  ),
  anulaciones_dia as (
    select an.id, an.anulada_en, an.numero_documento, an.ubicacion_venta as ubicacion_id,
           an.forma_pago, an.total, an.saldo_cancelado, an.usuario_nombre, an.motivo,
           an.tratamiento_dinero, v.fecha as fecha_venta, v.nombre_cliente
      from public.anulaciones_venta an
      join public.ventas v on v.id = an.venta_id
     where an.empresa_id = v_empresa
       and an.anulada_en >= v_desde and an.anulada_en < v_hasta
       and (p_ubicacion is null or an.ubicacion_venta = p_ubicacion)
  ),
  movimientos_dia as (
    select m.id, m.fecha, m.tipo, m.cantidad, m.motivo, m.ubicacion_id, m.usuario_id,
           m.venta_id, m.traslado_id, pr.codigo, pr.nombre as producto,
           case
             when m.tipo = 'salida' and m.venta_id is not null then 'venta'
             else m.tipo
           end as clase
      from public.movimientos_inventario m
      join public.productos pr on pr.id = m.producto_id
     where m.empresa_id = v_empresa
       and m.fecha >= v_desde and m.fecha < v_hasta
       and (p_ubicacion is null or m.ubicacion_id = p_ubicacion)
  ),
  ubicaciones_reporte as (
    select ubicacion_id from validas
    union select ubicacion_id from abonos_dia
    union select ubicacion_id from anulaciones_dia
    union
    select u.id from public.ubicaciones u
     where u.empresa_id = v_empresa and u.activa
       and (p_ubicacion is null or u.id = p_ubicacion)
  ),
  por_ubicacion as (
    select r.ubicacion_id,
           coalesce(u.nombre, 'Sin ubicación') as ubicacion,
           coalesce(ve.total, 0) as ventas_total,
           coalesce(ve.cantidad, 0) as ventas_cantidad,
           coalesce(ve.ticket, 0) as ticket_promedio,
           coalesce(ve.contado, 0) as contado_total,
           coalesce(ve.credito, 0) as credito_total,
           coalesce(ab.total, 0) as abonos_total,
           coalesce(ve.contado, 0) + coalesce(ab.total, 0) as cobros_total,
           coalesce(an.total, 0) as anuladas_total
      from ubicaciones_reporte r
      left join public.ubicaciones u on u.id = r.ubicacion_id
      left join lateral (
        select sum(total) as total, count(*) as cantidad, round(avg(total), 2) as ticket,
               sum(total) filter (where forma_pago = 'contado') as contado,
               sum(total) filter (where forma_pago = 'credito') as credito
          from validas x where x.ubicacion_id is not distinct from r.ubicacion_id
      ) ve on true
      left join lateral (
        select sum(monto) as total from abonos_dia x where x.ubicacion_id is not distinct from r.ubicacion_id
      ) ab on true
      left join lateral (
        select sum(total) as total from anulaciones_dia x where x.ubicacion_id is not distinct from r.ubicacion_id
      ) an on true
  ),
  vendedores_reporte as (
    select usuario_id from validas
    union select usuario_id from abonos_dia
  ),
  por_vendedor as (
    select r.usuario_id,
           coalesce(us.nombre, 'Sin usuario') as vendedor,
           coalesce(ve.total, 0) as ventas_total,
           coalesce(ve.cantidad, 0) as ventas_cantidad,
           coalesce(ve.ticket, 0) as ticket_promedio,
           coalesce(ve.contado, 0) as contado_total,
           coalesce(ve.credito, 0) as credito_total,
           coalesce(ab.total, 0) as abonos_total
      from vendedores_reporte r
      left join public.usuarios us on us.id = r.usuario_id
      left join lateral (
        select sum(total) as total, count(*) as cantidad, round(avg(total), 2) as ticket,
               sum(total) filter (where forma_pago = 'contado') as contado,
               sum(total) filter (where forma_pago = 'credito') as credito
          from validas x where x.usuario_id is not distinct from r.usuario_id
      ) ve on true
      left join lateral (
        select sum(monto) as total from abonos_dia x where x.usuario_id is not distinct from r.usuario_id
      ) ab on true
  )
  select jsonb_build_object(
    'dia', v_dia,
    'ubicacion_id', p_ubicacion,
    'empresa', (select e.nombre from public.empresas e where e.id = v_empresa),
    'moneda', (select e.moneda from public.empresas e where e.id = v_empresa),

    'indicadores', (
      select jsonb_build_object(
        'ventas_total', coalesce((select sum(total) from validas), 0),
        'ventas_cantidad', (select count(*) from validas),
        'ticket_promedio', coalesce((select round(avg(total), 2) from validas), 0),
        'contado_total', coalesce((select sum(total) from validas where forma_pago = 'contado'), 0),
        'contado_cantidad', (select count(*) from validas where forma_pago = 'contado'),
        'credito_total', coalesce((select sum(total) from validas where forma_pago = 'credito'), 0),
        'credito_cantidad', (select count(*) from validas where forma_pago = 'credito'),
        'abonos_total', coalesce((select sum(monto) from abonos_dia), 0),
        'abonos_cantidad', (select count(*) from abonos_dia),
        'cobros_total',
          coalesce((select sum(total) from validas where forma_pago = 'contado'), 0)
          + coalesce((select sum(monto) from abonos_dia), 0),
        'anuladas_total', coalesce((select sum(total) from anulaciones_dia), 0),
        'anuladas_cantidad', (select count(*) from anulaciones_dia),
        'reembolsos_pendientes',
          coalesce((select sum(total) from anulaciones_dia where tratamiento_dinero = 'reembolso_pendiente'), 0),
        'por_conciliar', (
          select count(*) from public.ventas_por_conciliar c
           where c.empresa_id = v_empresa
             and c.estado = 'pendiente'
             and c.registrada_en >= v_desde and c.registrada_en < v_hasta
             and (p_ubicacion is null or c.ubicacion_id = p_ubicacion)
        )
      )
    ),

    'por_ubicacion', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.ventas_total desc, x.ubicacion) from por_ubicacion x
    ), '[]'::jsonb),

    'por_vendedor', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.ventas_total desc, x.vendedor) from por_vendedor x
    ), '[]'::jsonb),

    'ventas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'fecha', v.fecha,
          'numero', v.numero_factura,
          'ubicacion', coalesce(u.nombre, 'Sin ubicación'),
          'vendedor', coalesce(us.nombre, 'Sin usuario'),
          'cliente', v.nombre_cliente,
          'forma_pago', v.forma_pago,
          'total', v.total,
          'estado', v.estado,
          'origen', v.origen,
          'productos', coalesce((
            select jsonb_agg(
              jsonb_build_object('nombre', d.nombre, 'codigo', d.codigo, 'cantidad', d.cantidad)
              order by d.nombre, d.id
            )
              from public.detalle_venta d where d.venta_id = v.id
          ), '[]'::jsonb)
        )
        order by v.fecha, v.correlativo, v.id
      )
        from ventas_dia v
        left join public.ubicaciones u on u.id = v.ubicacion_id
        left join public.usuarios us on us.id = v.usuario_id
    ), '[]'::jsonb),

    'abonos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'fecha', a.fecha,
          'numero', a.numero_factura,
          'fecha_venta', a.fecha_venta,
          'ubicacion', coalesce(u.nombre, 'Sin ubicación'),
          'cobrador', coalesce(us.nombre, 'Sin usuario'),
          'cliente', a.nombre_cliente,
          'monto', a.monto
        )
        order by a.fecha, a.id
      )
        from abonos_dia a
        left join public.ubicaciones u on u.id = a.ubicacion_id
        left join public.usuarios us on us.id = a.usuario_id
    ), '[]'::jsonb),

    'anulaciones', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'fecha', a.anulada_en,
          'numero', a.numero_documento,
          'fecha_venta', a.fecha_venta,
          'ubicacion', coalesce(u.nombre, 'Sin ubicación'),
          'anulada_por', a.usuario_nombre,
          'cliente', a.nombre_cliente,
          'forma_pago', a.forma_pago,
          'total', a.total,
          'tratamiento_dinero', a.tratamiento_dinero,
          'motivo', a.motivo
        )
        order by a.anulada_en, a.id
      )
        from anulaciones_dia a
        left join public.ubicaciones u on u.id = a.ubicacion_id
    ), '[]'::jsonb),

    'movimientos_resumen', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.clase)
        from (
          select clase, count(*) as movimientos, sum(cantidad) as unidades
            from movimientos_dia
           group by clase
        ) x
    ), '[]'::jsonb),

    'movimientos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'fecha', m.fecha,
          'clase', m.clase,
          'codigo', m.codigo,
          'producto', m.producto,
          'cantidad', m.cantidad,
          'ubicacion', coalesce(u.nombre, 'Sin ubicación'),
          'usuario', coalesce(us.nombre, 'Sin usuario'),
          'documento', v.numero_factura,
          'origen', uo.nombre,
          'destino', ud.nombre,
          'motivo', m.motivo
        )
        order by m.fecha, m.id
      )
        from movimientos_dia m
        left join public.ubicaciones u on u.id = m.ubicacion_id
        left join public.usuarios us on us.id = m.usuario_id
        left join public.ventas v on v.id = m.venta_id
        left join public.traslados t on t.id = m.traslado_id
        left join public.ubicaciones uo on uo.id = t.origen_id
        left join public.ubicaciones ud on ud.id = t.destino_id
    ), '[]'::jsonb)
  )
  into v_reporte;

  return v_reporte;
end $$;

revoke execute on function public.reporte_diario(date, uuid) from public, anon;
grant execute on function public.reporte_diario(date, uuid) to authenticated;
