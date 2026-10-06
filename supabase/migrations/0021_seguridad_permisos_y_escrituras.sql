-- Seguridad: solo el administrador reparte permisos, y ventas y cobros
-- solo se escriben por sus funciones.
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
-- SEC-2. ventas, detalle_venta, pagos y abonos se escriben solo desde
-- registrar_venta_ubicacion() y registrar_pago_cliente(), pero
-- `authenticated` conservaba insert, update y delete sobre ellas, y sus
-- políticas solo miran la empresa: cualquier empleado podía cambiar el
-- total de una factura, borrarla o inventar un pago.
--
-- En producción nadie pudo aprovecharlo: hasta hoy la única cuenta es la
-- del administrador y no hay ningún permiso repartido. Tiene que estar
-- aplicada antes de invitar al primer empleado.
--
-- Lo que NO hace: no toca ningún dato, no cambia quién LEE qué y no toca
-- las funciones de venta ni de cobro.

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

-- ─────────────────────────────────────────────────────────
-- VENTAS Y COBROS, SOLO POR SUS FUNCIONES
-- ─────────────────────────────────────────────────────────
/*
  Lo mismo que la 0019 hizo con el libro de inventario. Los tres, y no
  solo el insert: una factura editada o borrada descuadra igual que una
  inventada, y un cobro mal hecho se corrige con su propio flujo, no
  reescribiendo filas.

  La lectura no cambia: el select y las políticas de cada tabla siguen
  dejando ver lo de la propia empresa, que es lo que usan el historial, el
  panel y las cuentas por cobrar.

  Quién sigue escribiendo:
  - registrar_venta_ubicacion() crea la venta y sus renglones.
  - registrar_pago_cliente() crea el pago, sus abonos y marca pagadas las
    facturas que cubre.
  Las dos son SECURITY DEFINER y corren como su dueño, así que no les
  afecta. Tampoco a las acciones referenciales —el `on delete set null` de
  usuario_id y cliente_id, el `on delete cascade` de los renglones y
  abonos—, que PostgreSQL ejecuta con los permisos del dueño de la tabla.

  `anon` también, aunque RLS ya lo dejaba fuera: un permiso que no se usa
  y que solo RLS neutraliza es una segunda línea que falta.
*/
revoke insert, update, delete on ventas, detalle_venta, pagos, abonos from authenticated;
revoke insert, update, delete on ventas, detalle_venta, pagos, abonos from anon;
