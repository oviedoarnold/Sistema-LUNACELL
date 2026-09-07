-- Corrige la política de permisos_usuario.
--
-- La política original filtraba solo por empresa, así que cualquier
-- empleado veía también los permisos de sus compañeros. Si el frontend
-- usa esa tabla para decidir a qué secciones entra, un vendedor obtenía
-- la unión de los permisos de toda la empresa: acceso a inventario y
-- configuración que se le habían negado.
--
-- Ahora cada quien ve los suyos, y el administrador ve los de su empresa.

drop policy if exists permisos_propios_select on permisos_usuario;
create policy permisos_propios_select on permisos_usuario
  for select
  to authenticated
  using (
    usuario_id in (
      select id from usuarios where auth_id = auth.uid()
    )
    or (empresa_id = empresa_del_usuario() and usuario_es_admin())
  );

-- Solo un administrador reparte permisos.
drop policy if exists permisos_admin_escribe on permisos_usuario;
create policy permisos_admin_escribe on permisos_usuario
  for all
  to authenticated
  using (empresa_id = empresa_del_usuario() and usuario_es_admin())
  with check (empresa_id = empresa_del_usuario() and usuario_es_admin());
