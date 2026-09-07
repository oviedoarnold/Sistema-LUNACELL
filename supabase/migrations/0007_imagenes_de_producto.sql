-- Fotografía del producto.
--
-- La imagen no se guarda en la tabla. Un producto con la foto embebida
-- pesa cientos de kilobytes, y el catálogo se lee entero cada vez que se
-- abre el punto de venta: guardarla en una columna haría lenta justamente
-- la pantalla que tiene que responder rápido. En productos queda solo la
-- dirección del archivo.

alter table productos add column if not exists imagen_url text;

-- La vista enumera columnas, así que hay que recrearla para que la nueva
-- llegue al frontend.
drop view if exists productos_con_stock;

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
    p.imagen_url,
    p.activo,
    p.creado_en,
    coalesce(sum(m.cantidad), 0)::integer as stock
  from productos p
  left join movimientos_inventario m on m.producto_id = p.id
  group by p.id;

-- ─────────────────────────────────────────────────────────
-- ALMACENAMIENTO
-- ─────────────────────────────────────────────────────────
-- Los límites viven en el bucket y no solo en el navegador: la validación
-- del formulario es comodidad para el usuario, no una defensa. Cualquiera
-- puede llamar a la API sin pasar por la pantalla.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'productos',
  'productos',
  true,
  2097152,  -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
  El bucket es de lectura pública y eso es una decisión, no un descuido:
  la foto de un martillo no es información reservada, y servirla por CDN
  sin firmar cada URL evita tener que renovarlas antes de que venzan.

  Lo que sí está cerrado es la escritura. El archivo va en una carpeta con
  el id de la empresa, y las políticas exigen que esa carpeta sea la del
  usuario que sube: nadie puede escribir ni borrar en la carpeta de otra
  ferretería.

  La contraparte a aceptar: quien conozca la dirección exacta de una imagen
  puede verla sin iniciar sesión. Como el nombre del archivo lleva el id
  del producto, que es un uuid, adivinarla no es practicable.
*/

drop policy if exists imagenes_de_producto_lectura on storage.objects;
create policy imagenes_de_producto_lectura on storage.objects
  for select
  using (bucket_id = 'productos');

drop policy if exists imagenes_de_producto_escritura on storage.objects;
create policy imagenes_de_producto_escritura on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = empresa_del_usuario()::text
  );

drop policy if exists imagenes_de_producto_reemplazo on storage.objects;
create policy imagenes_de_producto_reemplazo on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = empresa_del_usuario()::text
  );

drop policy if exists imagenes_de_producto_borrado on storage.objects;
create policy imagenes_de_producto_borrado on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = empresa_del_usuario()::text
  );
