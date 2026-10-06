-- Seguridad: solo el administrador reparte permisos.
--
-- SEC-1. La 0003 quiso que cada empleado viera solo sus permisos y que
-- solo el administrador los repartiera, pero no retiró la política que el
-- bucle de la 0001 había creado para permisos_usuario:
-- permisos_usuario_de_mi_empresa, para todo y con la empresa como única
-- condición. Las políticas permisivas se suman con OR, así que esa siguió
-- dejando a cualquier empleado leer el mapa de permisos de la empresa,
-- darse cualquier sección, quitársela a otro y escribir permisos para un
-- usuario de otra empresa. Además usuario_tiene_permiso() no comparaba la
-- empresa del permiso con la del usuario, y esa fila ajena concedía
-- acceso.
--
-- En producción nadie pudo aprovecharlo: hasta hoy la única cuenta es la
-- del administrador y no hay ningún permiso repartido. Tiene que estar
-- aplicada antes de invitar al primer empleado.
--
-- Lo que NO hace: no toca ningún dato ni cambia quién lee qué fuera de
-- permisos_usuario.

-- ─────────────────────────────────────────────────────────
-- LA POLÍTICA QUE SOBRABA
-- ─────────────────────────────────────────────────────────
/*
  Quedan las dos de la 0003, que son las que se quisieron desde entonces:
  - permisos_propios_select: cada uno lee los suyos; el administrador, los
    de su empresa.
  - permisos_admin_escribe: solo el administrador da, cambia y quita, y
    solo dentro de su empresa.
*/
drop policy if exists permisos_usuario_de_mi_empresa on permisos_usuario;

-- ─────────────────────────────────────────────────────────
-- EL PERMISO ES DEL USUARIO EN SU EMPRESA
-- ─────────────────────────────────────────────────────────
/*
  Misma función, mismo nombre, misma firma y mismas reglas de ejecución:
  solo se agrega que la fila de permiso sea de la empresa del usuario. Una
  fila con otra empresa —un dato viejo, o una escrita antes de esta
  corrección— no concede nada.

  `create or replace` conserva dueño y permisos de ejecución.
*/
create or replace function usuario_tiene_permiso(p_seccion text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select usuario_es_admin()
      or exists (
           select 1
             from permisos_usuario p
             join usuarios u on u.id = p.usuario_id
                             and u.empresa_id = p.empresa_id
            where u.auth_id = auth.uid()
              and u.activo
              and p.seccion = p_seccion
         )
$$;

-- ─────────────────────────────────────────────────────────
-- Y LA ESTRUCTURA NO ADMITE OTRA COSA
-- ─────────────────────────────────────────────────────────
/*
  La función ya ignora una fila cruzada; la llave impide que exista. Sin
  ella, un administrador podía seguir guardando, con la empresa propia en
  la fila, un permiso para un usuario de otra empresa: inútil, pero un
  estado que nadie debería poder crear. Es la misma técnica del par
  (id, empresa) que usan ubicaciones, inventario y traslados.

  `on delete cascade`, igual que la llave simple que ya existe: borrar un
  usuario se lleva sus permisos.
*/
create unique index if not exists usuarios_id_empresa
  on usuarios (id, empresa_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'permisos_usuario_de_un_usuario_de_mi_empresa'
       and conrelid = 'permisos_usuario'::regclass
  ) then
    alter table permisos_usuario
      add constraint permisos_usuario_de_un_usuario_de_mi_empresa
      foreign key (usuario_id, empresa_id)
      references usuarios (id, empresa_id)
      on delete cascade;
  end if;
end $$;
