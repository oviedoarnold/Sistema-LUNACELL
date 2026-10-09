-- Seguridad: las imágenes del catálogo se suben, reemplazan y borran solo
-- con el permiso `products` (SEC-3a, segunda parte).
--
-- Hasta aquí las políticas del bucket `productos` solo miraban la carpeta
-- de la empresa. Cualquier empleado activo —un vendedor con solo `pos`—
-- podía subir, reemplazar, mover o borrar las fotos del catálogo, aunque
-- desde la 0023 ya no pueda tocar el producto.
--
-- Y la lectura era pública y sin condición: además de servir cada imagen
-- por su URL, dejaba que cualquiera, sin iniciar sesión, LISTARA todos los
-- archivos del bucket, de todas las empresas.
--
-- En producción nadie pudo aprovecharlo: la única cuenta es la del
-- administrador. Tiene que estar aplicada antes de invitar al primer
-- empleado.
--
-- Lo que NO hace: no toca ningún archivo ni sus rutas, no cambia el bucket
-- —sigue público, con el mismo límite y los mismos formatos— y no toca
-- ninguna otra política.

-- ─────────────────────────────────────────────────────────
-- LEER: SOLO QUIEN ADMINISTRA EL CATÁLOGO, Y SOLO EL SUYO
-- ─────────────────────────────────────────────────────────
/*
  La imagen se sigue viendo igual: el bucket es público y el servicio de
  Storage sirve la URL pública como superusuario, sin pasar por la RLS.
  Para mostrar una foto no hace falta ninguna política de lectura.

  La política de lectura sirve para otra cosa: es la que decide quién
  LISTA el bucket, y además el servicio la exige para reemplazar (subir
  con upsert) y para borrar, porque ambas operaciones devuelven la fila
  (RETURNING) y PostgreSQL solo devuelve lo que la política deja ver.

  Por eso se cambia la lectura pública por una que ve solo quien puede
  escribir: carpeta de su empresa y permiso `products`.
*/
drop policy if exists imagenes_de_producto_lectura on storage.objects;

drop policy if exists imagenes_de_producto_consulta on storage.objects;
create policy imagenes_de_producto_consulta on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
  );

-- ─────────────────────────────────────────────────────────
-- ESCRIBIR: CARPETA DE SU EMPRESA Y PERMISO `products`
-- ─────────────────────────────────────────────────────────
/*
  Las mismas tres condiciones en las tres operaciones. Al reemplazar o
  mover, se exigen sobre la imagen original (USING) y sobre su nuevo
  lugar (WITH CHECK): nadie toca una imagen ajena ni saca una propia hacia
  la carpeta de otra empresa.

  `(select …)` hace que el permiso se calcule una vez por sentencia y no
  una vez por fila.
*/
drop policy if exists imagenes_de_producto_escritura on storage.objects;
create policy imagenes_de_producto_escritura on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
  );

drop policy if exists imagenes_de_producto_reemplazo on storage.objects;
create policy imagenes_de_producto_reemplazo on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
  )
  with check (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
  );

drop policy if exists imagenes_de_producto_borrado on storage.objects;
create policy imagenes_de_producto_borrado on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'productos'
    and (storage.foldername(name))[1] = public.empresa_del_usuario()::text
    and (select public.usuario_tiene_permiso('products'))
  );
