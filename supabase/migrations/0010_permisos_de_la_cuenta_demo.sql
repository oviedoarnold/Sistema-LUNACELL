-- Devuelve a la cuenta demo los permisos que describe el recorrido guiado.
--
-- El guion de docs/demo.md dice que el vendedor ve cinco secciones y que
-- no ve Inventario, Proveedores ni Configuración: esa diferencia es lo que
-- demuestra que el control de acceso funciona. Si los permisos no
-- coinciden, quien siga el recorrido encuentra otra cosa.
--
-- Correr esto solo si se quiere el recorrido tal como está documentado. Si
-- los permisos se cambiaron a propósito, lo que hay que ajustar es el
-- documento, no la base.

do $$
declare
  v_usuario uuid;
  v_empresa uuid;
begin
  select id, empresa_id into v_usuario, v_empresa
  from usuarios
  where email = 'demo@oviedoarnold.lat';

  if v_usuario is null then
    raise notice 'No existe la cuenta demo; no hay nada que ajustar.';
    return;
  end if;

  -- Se reemplazan en bloque: así el resultado es el mismo se corra una vez
  -- o cinco, y no quedan permisos sueltos de un cambio anterior.
  delete from permisos_usuario where usuario_id = v_usuario;

  insert into permisos_usuario (usuario_id, empresa_id, seccion)
  select v_usuario, v_empresa, unnest(array[
    'dashboard', 'pos', 'quotes', 'clients', 'sales-history'
  ]);

  raise notice 'Cuenta demo con cinco secciones. Sin inventario, proveedores ni configuración.';
end $$;
