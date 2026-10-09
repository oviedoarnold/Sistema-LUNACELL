-- Seguridad: clientes, proveedores y cotizaciones se escriben solo con el
-- permiso de su sección (SEC-3b).
--
-- Hasta aquí las cuatro tablas tenían una sola política, para todo, cuya
-- única condición era la empresa. Cualquier empleado activo —un vendedor
-- con solo `pos`— creaba, cambiaba y borraba clientes y proveedores, y
-- cambiaba o borraba la cotización de otro. El administrador podía borrar
-- un cliente, y con él sus facturas quedaban sin cliente. Y la cotización
-- decía haber sido hecha por quien el navegador mandara en `usuario_id`.
--
-- En producción nadie pudo aprovecharlo: la única cuenta es la del
-- administrador. Tiene que estar aplicada antes de invitar al primer
-- empleado.
--
-- Lo que NO hace: no toca ningún dato, no cambia quién LEE qué y no toca
-- llaves ni cascadas.

-- ─────────────────────────────────────────────────────────
-- QUIÉN ES EL USUARIO QUE LLAMA
-- ─────────────────────────────────────────────────────────
/*
  El id de `usuarios` de quien llama, si está activo. La autoría de una
  cotización se compara contra esto y no contra lo que mande el navegador.

  SECURITY DEFINER por la misma razón que empresa_del_usuario(): una
  política no debe depender de que la RLS de `usuarios` deje ver la fila.
  Solo devuelve el id propio; no expone a nadie más.
*/
create or replace function public.usuario_actual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from public.usuarios u
   where u.auth_id = auth.uid()
     and u.activo
   limit 1
$$;

revoke execute on function public.usuario_actual() from public, anon;
grant execute on function public.usuario_actual() to authenticated;

-- ─────────────────────────────────────────────────────────
-- CLIENTES
-- ─────────────────────────────────────────────────────────
/*
  Una política por operación, como en la 0023, para que ninguna se sume por
  OR a otra y abra lo que esta cierra.

  - Leer: igual que antes, los de la propia empresa.
  - Dar de alta: con `clients`, y también con `pos` y `quotes`, porque el
    punto de venta y las cotizaciones registran al cliente del documento.
  - Cambiar: solo con `clients`. El permiso va en WITH CHECK para que el
    intento sea un error claro (42501) y no un «0 filas» silencioso.

  `(select …)` hace que cada permiso se calcule una vez por sentencia.
*/
drop policy if exists clientes_de_mi_empresa on public.clientes;

drop policy if exists clientes_lectura on public.clientes;
create policy clientes_lectura on public.clientes
  for select
  to authenticated
  using (empresa_id = public.empresa_del_usuario());

drop policy if exists clientes_alta on public.clientes;
create policy clientes_alta on public.clientes
  for insert
  to authenticated
  with check (
    empresa_id = public.empresa_del_usuario()
    and (
      (select public.usuario_tiene_permiso('clients'))
      or (select public.usuario_tiene_permiso('pos'))
      or (select public.usuario_tiene_permiso('quotes'))
    )
  );

drop policy if exists clientes_cambio on public.clientes;
create policy clientes_cambio on public.clientes
  for update
  to authenticated
  using (empresa_id = public.empresa_del_usuario())
  with check (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('clients'))
  );

/*
  Un cliente no se borra nunca, ni por el administrador: sus ventas,
  facturas y cuentas por cobrar lo necesitan. Sin política de borrado la RLS
  ya no dejaría borrar, pero en silencio; sin el privilegio, el intento es
  un error claro. Desactivar clientes queda como mejora futura.
*/
revoke delete on public.clientes from authenticated, anon;
revoke insert, update on public.clientes from anon;

-- ─────────────────────────────────────────────────────────
-- PROVEEDORES
-- ─────────────────────────────────────────────────────────
-- Leer, la empresa; crear, cambiar y borrar, además el permiso `suppliers`.
drop policy if exists proveedores_de_mi_empresa on public.proveedores;

drop policy if exists proveedores_lectura on public.proveedores;
create policy proveedores_lectura on public.proveedores
  for select
  to authenticated
  using (empresa_id = public.empresa_del_usuario());

drop policy if exists proveedores_alta on public.proveedores;
create policy proveedores_alta on public.proveedores
  for insert
  to authenticated
  with check (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('suppliers'))
  );

drop policy if exists proveedores_cambio on public.proveedores;
create policy proveedores_cambio on public.proveedores
  for update
  to authenticated
  using (empresa_id = public.empresa_del_usuario())
  with check (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('suppliers'))
  );

-- Un DELETE no tiene WITH CHECK: sin el permiso no alcanza ninguna fila. El
-- frontend comprueba que se haya borrado algo y lo dice.
drop policy if exists proveedores_baja on public.proveedores;
create policy proveedores_baja on public.proveedores
  for delete
  to authenticated
  using (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('suppliers'))
  );

revoke insert, update, delete on public.proveedores from anon;

-- ─────────────────────────────────────────────────────────
-- COTIZACIONES
-- ─────────────────────────────────────────────────────────
/*
  - Crear: con `quotes`, y a nombre propio: `usuario_id` tiene que ser
    quien llama. Así la autoría no se puede falsificar.
  - Cambiar y borrar: con `quotes`, y solo su autor o un administrador. Ni
    el autor puede pasarle la cotización a otro.

  Las cotizaciones antiguas sin autor solo las toca un administrador.
*/
drop policy if exists cotizaciones_de_mi_empresa on public.cotizaciones;

drop policy if exists cotizaciones_lectura on public.cotizaciones;
create policy cotizaciones_lectura on public.cotizaciones
  for select
  to authenticated
  using (empresa_id = public.empresa_del_usuario());

drop policy if exists cotizaciones_alta on public.cotizaciones;
create policy cotizaciones_alta on public.cotizaciones
  for insert
  to authenticated
  with check (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('quotes'))
    and usuario_id = (select public.usuario_actual())
  );

drop policy if exists cotizaciones_cambio on public.cotizaciones;
create policy cotizaciones_cambio on public.cotizaciones
  for update
  to authenticated
  using (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('quotes'))
    and (usuario_id = (select public.usuario_actual()) or (select public.usuario_es_admin()))
  )
  with check (
    empresa_id = public.empresa_del_usuario()
    and (usuario_id = (select public.usuario_actual()) or (select public.usuario_es_admin()))
  );

drop policy if exists cotizaciones_baja on public.cotizaciones;
create policy cotizaciones_baja on public.cotizaciones
  for delete
  to authenticated
  using (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('quotes'))
    and (usuario_id = (select public.usuario_actual()) or (select public.usuario_es_admin()))
  );

revoke insert, update, delete on public.cotizaciones from anon;

-- ─────────────────────────────────────────────────────────
-- DETALLE DE COTIZACIÓN
-- ─────────────────────────────────────────────────────────
/*
  Un renglón sigue a su cotización: se agrega, cambia o borra solo si esa
  cotización es de la misma empresa y quien llama la puede cambiar (su
  autor o un administrador, con `quotes`). La subconsulta lee cotizaciones
  con la RLS de quien llama, así que nunca alcanza las de otra empresa.

  Las columnas del renglón van calificadas con el nombre de la tabla: dentro
  de la subconsulta, un `empresa_id` suelto sería el de la cotización.
*/
drop policy if exists detalle_cotizacion_de_mi_empresa on public.detalle_cotizacion;

drop policy if exists detalle_cotizacion_lectura on public.detalle_cotizacion;
create policy detalle_cotizacion_lectura on public.detalle_cotizacion
  for select
  to authenticated
  using (empresa_id = public.empresa_del_usuario());

drop policy if exists detalle_cotizacion_alta on public.detalle_cotizacion;
create policy detalle_cotizacion_alta on public.detalle_cotizacion
  for insert
  to authenticated
  with check (
    detalle_cotizacion.empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('quotes'))
    and exists (
      select 1
        from public.cotizaciones c
       where c.id = detalle_cotizacion.cotizacion_id
         and c.empresa_id = detalle_cotizacion.empresa_id
         and (c.usuario_id = (select public.usuario_actual()) or (select public.usuario_es_admin()))
    )
  );

drop policy if exists detalle_cotizacion_cambio on public.detalle_cotizacion;
create policy detalle_cotizacion_cambio on public.detalle_cotizacion
  for update
  to authenticated
  using (
    detalle_cotizacion.empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('quotes'))
    and exists (
      select 1
        from public.cotizaciones c
       where c.id = detalle_cotizacion.cotizacion_id
         and c.empresa_id = detalle_cotizacion.empresa_id
         and (c.usuario_id = (select public.usuario_actual()) or (select public.usuario_es_admin()))
    )
  )
  with check (
    detalle_cotizacion.empresa_id = public.empresa_del_usuario()
    and exists (
      select 1
        from public.cotizaciones c
       where c.id = detalle_cotizacion.cotizacion_id
         and c.empresa_id = detalle_cotizacion.empresa_id
         and (c.usuario_id = (select public.usuario_actual()) or (select public.usuario_es_admin()))
    )
  );

drop policy if exists detalle_cotizacion_baja on public.detalle_cotizacion;
create policy detalle_cotizacion_baja on public.detalle_cotizacion
  for delete
  to authenticated
  using (
    detalle_cotizacion.empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('quotes'))
    and exists (
      select 1
        from public.cotizaciones c
       where c.id = detalle_cotizacion.cotizacion_id
         and c.empresa_id = detalle_cotizacion.empresa_id
         and (c.usuario_id = (select public.usuario_actual()) or (select public.usuario_es_admin()))
    )
  );

revoke insert, update, delete on public.detalle_cotizacion from anon;
