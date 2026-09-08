-- Siembra las cuatro ubicaciones con las que arranca LUNACELL. NO es una
-- migración.
--
-- Vive entre los scripts y no entre las migraciones porque no es un paso del
-- esquema sino una decisión del negocio. Qué lugares tiene LUNACELL hoy es
-- algo que
-- cambia —se compra un camión, se cierra una tienda— y una migración que
-- lo fije convertiría ese cambio en un problema de base de datos.
--
-- Correrlo es opcional. Las cuatro se pueden crear en medio minuto desde
-- Configuración → Ubicaciones, y ese es el camino recomendado la primera
-- vez, porque deja ver que el módulo funciona de punta a punta.
--
-- ─────────────────────────────────────────────────────────
-- POR QUÉ NO ADIVINA LA EMPRESA
-- ─────────────────────────────────────────────────────────
-- Escribir un empresa_id a mano en un script es la forma más fácil de
-- sembrar las ubicaciones de LUNACELL dentro de la empresa equivocada, y
-- con RLS activo el error no se vería: las filas quedarían invisibles para
-- todo el mundo en vez de dar un error.
--
-- Por eso el script no acepta un identificador: exige que exista una sola
-- empresa y usa esa. Si hay varias, se planta y pide que se corra desde la
-- aplicación, donde la empresa la resuelve la sesión y no una suposición.
--
-- Es idempotente: si la empresa ya tiene ubicaciones, no toca nada.

do $$
declare
  v_empresa  uuid;
  v_empresas int;
  v_ya_tiene int;
begin
  select count(*) into v_empresas from empresas;

  if v_empresas = 0 then
    raise notice 'No hay ninguna empresa cargada. Crea la empresa antes de sembrar sus ubicaciones.';
    return;
  end if;

  if v_empresas > 1 then
    raise notice 'Hay % empresas y este script no adivina cuál es LUNACELL. Crea las ubicaciones desde Configuración → Ubicaciones.', v_empresas;
    return;
  end if;

  select id into v_empresa from empresas;

  select count(*) into v_ya_tiene
  from ubicaciones
  where empresa_id = v_empresa;

  if v_ya_tiene > 0 then
    raise notice 'La empresa ya tiene % ubicaciones; no se hace nada.', v_ya_tiene;
    return;
  end if;

  insert into ubicaciones (empresa_id, nombre, tipo)
  values
    (v_empresa, 'Bodega Principal', 'bodega'),
    (v_empresa, 'Lunacell Store',   'tienda'),
    (v_empresa, 'Camión 01',        'camion'),
    (v_empresa, 'Camión 02',        'camion');

  raise notice 'Cuatro ubicaciones creadas para la empresa %.', v_empresa;
end $$;
