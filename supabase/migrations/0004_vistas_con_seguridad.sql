-- Corrige las vistas para que respeten las políticas de acceso.
--
-- Una vista de PostgreSQL se ejecuta por defecto con los permisos de
-- quien la creó, no de quien la consulta. Eso significa que stock_actual
-- podía devolver productos de TODAS las empresas, saltándose el
-- aislamiento que protege al resto de las tablas.
--
-- Con una sola empresa cargada el fallo no se nota: la vista devuelve lo
-- mismo con o sin la corrección. Aparecería el día que entre el segundo
-- cliente, que es cuando más caro sale.
--
-- security_invoker = on hace que la vista aplique las políticas del
-- usuario que consulta.

drop view if exists stock_actual;

create or replace view stock_actual
with (security_invoker = on)
as
  select
    p.id            as producto_id,
    p.empresa_id,
    p.codigo,
    p.nombre,
    p.stock_minimo,
    coalesce(sum(m.cantidad), 0)::integer as stock
  from productos p
  left join movimientos_inventario m on m.producto_id = p.id
  group by p.id, p.empresa_id, p.codigo, p.nombre, p.stock_minimo;

-- Vista completa para el catálogo: evita que el frontend tenga que pedir
-- los productos y sus existencias por separado y unirlos a mano.
create or replace view productos_con_stock
with (security_invoker = on)
as
  select
    p.id,
    p.empresa_id,
    p.proveedor_id,
    p.codigo,
    p.nombre,
    p.categoria,
    p.precio,
    p.costo,
    p.stock_minimo,
    p.activo,
    p.creado_en,
    coalesce(sum(m.cantidad), 0)::integer as stock
  from productos p
  left join movimientos_inventario m on m.producto_id = p.id
  group by p.id;
