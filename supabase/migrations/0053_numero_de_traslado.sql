-- Número visible del traslado: TR-000001, TR-000002…
--
-- La 0020 dejó los traslados sin número («Lo que NO trae: número visible
-- del traslado»). El historial y su detalle los nombran ahora con uno,
-- como las liquidaciones (LIQ-000001, 0046).
--
-- Lo que hace:
--
-- - agrega `correlativo` y `numero` a `traslados`;
-- - numera los traslados que ya existen, por empresa, del más antiguo al
--   más reciente (creado_en y, para dos en el mismo instante, el id);
-- - un disparador da el número a cada traslado nuevo, bajo un candado por
--   empresa, así que dos traslados simultáneos no repiten número;
-- - otro disparador impide cambiar el número de un traslado ya numerado.
--
-- Lo que NO hace: no cambia registrar_traslado() —el número lo pone el
-- disparador al insertar la cabecera—, ni las existencias, ni el libro,
-- ni el detalle, ni las políticas, ni los permisos. Un traslado rechazado
-- no gasta número: su inserción se deshace con la transacción.
--
-- Idempotente: volver a correrla no renumera nada. Va ANTES que el
-- frontend que lee la columna `numero`.

-- ─────────────────────────────────────────────────────────
-- LAS COLUMNAS
-- ─────────────────────────────────────────────────────────
alter table traslados add column if not exists correlativo bigint;
alter table traslados add column if not exists numero text;

-- ─────────────────────────────────────────────────────────
-- LOS TRASLADOS QUE YA EXISTEN
-- ─────────────────────────────────────────────────────────
/*
  Solo los que no tienen número. Cada empresa sigue desde su mayor
  correlativo, así que correrla otra vez no toca lo ya numerado.

  El número tiene al menos seis cifras; si algún día pasa de 999999 crece
  en vez de cortarse (lpad recorta lo que sobra).
*/
with pendientes as (
  select t.id,
         coalesce((select max(n.correlativo) from traslados n where n.empresa_id = t.empresa_id), 0)
           + row_number() over (partition by t.empresa_id order by t.creado_en, t.id) as correlativo
    from traslados t
   where t.correlativo is null
)
update traslados t
   set correlativo = p.correlativo,
       numero = 'TR-' || lpad(p.correlativo::text, greatest(6, length(p.correlativo::text)), '0')
  from pendientes p
 where t.id = p.id;

alter table traslados alter column correlativo set not null;
alter table traslados alter column numero set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'traslados_correlativo_positivo'
                   and conrelid = 'traslados'::regclass) then
    alter table traslados
      add constraint traslados_correlativo_positivo check (correlativo > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'traslados_numero_del_correlativo'
                   and conrelid = 'traslados'::regclass) then
    alter table traslados
      add constraint traslados_numero_del_correlativo
      check (numero = 'TR-' || lpad(correlativo::text, greatest(6, length(correlativo::text)), '0'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'traslados_correlativo_unico'
                   and conrelid = 'traslados'::regclass) then
    alter table traslados
      add constraint traslados_correlativo_unico unique (empresa_id, correlativo);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────
-- EL NÚMERO DE CADA TRASLADO NUEVO
-- ─────────────────────────────────────────────────────────
/*
  Se calcula al insertar la cabecera, que solo inserta
  registrar_traslado(). El número que traiga la fila se ignora: lo decide
  siempre la base.

  El candado es por empresa y dura hasta el final de la transacción, como
  el de las liquidaciones: el segundo de dos traslados simultáneos espera
  a que el primero termine y ve su número. Es lo último que toma el
  traslado —las celdas de inventario ya están bloqueadas antes—, así que
  no forma un círculo de esperas con ventas, ajustes ni otros traslados.

  SECURITY DEFINER para leer el mayor correlativo de toda la empresa, no
  solo de las ubicaciones que ve quien traslada.
*/
create or replace function asignar_numero_de_traslado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_correlativo bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('traslado-correlativo|' || new.empresa_id::text, 0));

  select coalesce(max(correlativo), 0) + 1 into v_correlativo
    from traslados
   where empresa_id = new.empresa_id;

  new.correlativo := v_correlativo;
  new.numero := 'TR-' || lpad(v_correlativo::text, greatest(6, length(v_correlativo::text)), '0');

  return new;
end $$;

revoke execute on function asignar_numero_de_traslado() from public, anon, authenticated;

drop trigger if exists traslados_asignar_numero on traslados;
create trigger traslados_asignar_numero
  before insert on traslados
  for each row execute function asignar_numero_de_traslado();

/*
  Un número dado no cambia. La aplicación no puede escribir la tabla
  (solo la lee, 0020); esto lo asegura también para quien sí puede.
*/
create or replace function numero_de_traslado_inmutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.correlativo is distinct from old.correlativo or new.numero is distinct from old.numero then
    raise exception 'El número del traslado % no se puede cambiar', old.numero
      using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function numero_de_traslado_inmutable() from public, anon, authenticated;

drop trigger if exists traslados_numero_inmutable on traslados;
create trigger traslados_numero_inmutable
  before update on traslados
  for each row execute function numero_de_traslado_inmutable();
