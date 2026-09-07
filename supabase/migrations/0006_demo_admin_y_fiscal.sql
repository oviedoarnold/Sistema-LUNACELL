-- Completa la ferretería de demostración.
--
-- Dos huecos que quedaron del recorrido guiado:
--
-- 1. El paso de administrador no tenía cuenta propia. La única cuenta con
--    rol admin era la del dueño del sistema, y publicar su contraseña en
--    una página abierta no es una opción. Se invita una cuenta aparte.
--
-- 2. La empresa demo no tenía CAI, así que las facturas salían con la
--    numeración interna (FAC-01206) en vez de la autorizada
--    (000-001-01-00001206). Justo lo que la demostración quiere enseñar.

do $$
declare
  v_empresa uuid;
  v_admin   uuid;
begin
  select id into v_empresa from empresas where es_demo order by creada_en limit 1;

  if v_empresa is null then
    raise notice 'No hay empresa de demostración; no hay nada que completar.';
    return;
  end if;

  -- Queda invitada: se vincula sola cuando alguien entre con ese correo.
  insert into usuarios (empresa_id, email, nombre, rol)
  values (v_empresa, 'demo-admin@oviedoarnold.lat', 'Administrador de demostración', 'admin')
  on conflict do nothing
  returning id into v_admin;

  if v_admin is not null then
    insert into permisos_usuario (usuario_id, empresa_id, seccion)
    select v_admin, v_empresa, unnest(array[
      'dashboard', 'pos', 'quotes', 'products',
      'clients', 'suppliers', 'sales-history', 'settings'
    ]);
  end if;

  /*
    Datos fiscales de muestra. No son de ningún CAI emitido por el SAR: la
    empresa está marcada es_demo y sirve para que se vea la numeración
    autorizada, el aviso de rango por agotarse y el de fecha vencida.

    El rango arranca en 1000 para que cubra los correlativos ya emitidos.
  */
  update empresas
  set
    cai                  = 'DEM0AA-BB11CC-22DD33-EE44FF-556677-88',
    establecimiento      = '000',
    punto_emision        = '001',
    tipo_documento       = '01',
    rango_desde          = 1000,
    rango_hasta          = 9999,
    fecha_limite_emision = '2027-12-31'
  where id = v_empresa;
end $$;
