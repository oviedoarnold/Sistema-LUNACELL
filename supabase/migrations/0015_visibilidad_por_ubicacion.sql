-- Quién trabaja desde dónde, y quién puede ver el inventario de dónde.
--
-- La 0014 dejó la existencia guardada por producto y ubicación, pero su
-- política de lectura era la del resto del esquema: «todo lo de mi
-- empresa». Con una sola bodega eso daba igual; con dos camiones vendiendo
-- en ruta, no: un vendedor no tiene por qué saber qué lleva el otro.
--
-- Esta migración separa tres cosas que es fácil confundir y que se
-- confunden caras:
--
--   ubicación operativa  -> desde dónde trabajo               (usuarios.ubicacion_id)
--   visibilidad          -> qué puedo consultar               (permisos_usuario)
--   operación            -> desde dónde puedo mover existencia (INV-3)
--
-- Ver el inventario del Camión 02 no es poder vender desde el Camión 02.
-- Lo primero es esta migración; lo segundo todavía no existe, y cuando
-- exista será otra cosa distinta.
--
-- Esta fase es de LECTURA. No abre ninguna escritura sobre
-- inventario_ubicacion: los revoke de la 0014 siguen en pie.

-- ─────────────────────────────────────────────────────────
-- LA UBICACIÓN OPERATIVA DEL USUARIO
-- ─────────────────────────────────────────────────────────
/*
  Una columna y no una tabla: es un valor por usuario, igual que `rol`.
  Una tabla de relación serviría para «desde cuáles puede operar», que es
  otra pregunta y de otra fase.

  Nullable por dos razones concretas, no por comodidad: el único usuario
  que existe hoy no tiene ninguna asignada, y el dueño puede
  legítimamente no operar desde un sitio fijo. Un `not null` obligaría a
  inventarle una.
*/
alter table usuarios
  add column if not exists ubicacion_id uuid;

/*
  La empresa va dentro de la llave, como en la 0012 para clientes y en la
  0014 para el inventario, y por la misma razón: RLS no basta cuando quien
  escribe es una función SECURITY DEFINER, porque esa pasa por encima. Sin
  el par, un administrador podría asignar a su vendedor el camión de otra
  empresa.

  Sin `on delete`: el comportamiento por omisión es NO ACTION, que impide
  borrar una ubicación mientras alguien la tenga como operativa. Es lo que
  se quiere, y conviene que esté escrito aquí y no dado por sabido.
*/
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'usuarios_ubicacion_de_mi_empresa'
       and conrelid = 'usuarios'::regclass
  ) then
    alter table usuarios
      add constraint usuarios_ubicacion_de_mi_empresa
      foreign key (ubicacion_id, empresa_id)
      references ubicaciones (id, empresa_id);
  end if;
end $$;

/*
  Para la pregunta «¿queda alguien operando desde esta ubicación?», que es
  la que hace el disparador de más abajo cada vez que se desactiva una.
*/
create index if not exists idx_usuarios_ubicacion
  on usuarios (ubicacion_id);

-- ─────────────────────────────────────────────────────────
-- QUE LA UBICACIÓN OPERATIVA ESTÉ ACTIVA
-- ─────────────────────────────────────────────────────────
/*
  Esto no lo puede expresar una restricción: un `check` no puede mirar otra
  tabla. Hacen falta dos disparadores, porque son dos agujeros distintos y
  tapar uno solo deja el otro abierto:

    1. asignar a alguien una ubicación que ya está inactiva
    2. desactivar una ubicación que alguien ya tiene asignada

  El segundo es el que de verdad muerde. Sin él, desactivar el Camión 01
  deja a su vendedor con permiso de «ver mi ubicación» sobre una ubicación
  que la vista no muestra: deja de ver su propio inventario y nada le dice
  por qué. El fallo no se parece a su causa, y ésos son los que cuestan
  una tarde.
*/
create or replace function usuarios_ubicacion_operativa_valida()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  /*
    En un UPDATE solo se comprueba si la ubicación cambió. Si no, cambiar
    el nombre de un usuario fallaría por una ubicación que se desactivó
    después de asignársela, y arreglar un dato quedaría bloqueado por otro
    que no se está tocando.
  */
  if tg_op = 'UPDATE'
     and new.ubicacion_id is not distinct from old.ubicacion_id then
    return new;
  end if;

  if new.ubicacion_id is null then
    return new;
  end if;

  if not exists (
    select 1 from ubicaciones
     where id = new.ubicacion_id
       and activa
  ) then
    raise exception
      'La ubicación operativa tiene que estar activa. Actívala antes de asignarla, o elige otra.';
  end if;

  return new;
end $$;

drop trigger if exists usuarios_ubicacion_activa on usuarios;

create trigger usuarios_ubicacion_activa
  before insert or update on usuarios
  for each row
  execute function usuarios_ubicacion_operativa_valida();

/*
  Y el lado contrario: no se desactiva una ubicación desde la que alguien
  está operando. Se le cambia la ubicación al usuario primero, que es una
  decisión que alguien tiene que tomar a propósito.

  Es el mismo espíritu que «no se borra, se desactiva» de la 0011: la
  ubicación no desaparece, pero tampoco se queda a medias.
*/
create or replace function ubicaciones_no_desactivar_operativa()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_usuarios integer;
begin
  if old.activa and not new.activa then
    select count(*) into v_usuarios
      from usuarios
     where ubicacion_id = old.id;

    if v_usuarios > 0 then
      raise exception
        'No se puede desactivar «%»: es la ubicación operativa de % usuario(s). Cámbiales la ubicación antes.',
        old.nombre, v_usuarios;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists ubicaciones_operativa_en_uso on ubicaciones;

create trigger ubicaciones_operativa_en_uso
  before update on ubicaciones
  for each row
  execute function ubicaciones_no_desactivar_operativa();

-- ─────────────────────────────────────────────────────────
-- LAS DOS SECCIONES NUEVAS
-- ─────────────────────────────────────────────────────────
/*
  permisos_usuario limita las secciones con una restricción, así que un
  permiso nuevo no existe para la base hasta que se lo nombra aquí. Sin
  esto, guardarlo desde Configuración falla con un error de restricción.

  Se recrea la restricción entera porque PostgreSQL no permite extender un
  check existente, y se la busca por la columna que restringe en vez de por
  su nombre: es el patrón que dejó la 0011, con el razonamiento escrito
  allí. Un `drop constraint if exists` con el nombre equivocado no borra
  nada y no avisa.

  Son dos permisos y no uno porque son dos preguntas: «ver lo mío» es lo
  que necesita cualquiera que venda, y «ver todo» es una concesión aparte.
  Un solo permiso obligaría a elegir entre no ver nada o verlo todo.
*/
do $$
declare
  v_restriccion text;
begin
  for v_restriccion in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'permisos_usuario'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%seccion%'
  loop
    execute format(
      'alter table permisos_usuario drop constraint %I', v_restriccion
    );
  end loop;
end $$;

alter table permisos_usuario
  add constraint permisos_usuario_seccion_check
  check (seccion in (
    'dashboard', 'pos', 'quotes', 'products',
    'clients', 'suppliers', 'sales-history', 'settings',
    'locations',
    'inventory-own', 'inventory-all'
  ));

-- ─────────────────────────────────────────────────────────
-- QUIÉN SOY, SEGÚN EL MOTOR
-- ─────────────────────────────────────────────────────────
/*
  Del mismo molde que empresa_del_usuario() y usuario_es_admin(), que ya
  estaban: SECURITY DEFINER para poder leer `usuarios` sin depender de la
  política de esa tabla, y STABLE para que PostgreSQL las evalúe una vez
  por consulta y no una vez por fila.

  La empresa y la ubicación nunca llegan desde el navegador. Se resuelven
  aquí, contra auth.uid().
*/
create or replace function ubicacion_del_usuario()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ubicacion_id
    from usuarios
   where auth_id = auth.uid()
     and activo
   limit 1
$$;

/*
  Un administrador tiene todos los permisos sin que haya que repartírselos
  fila por fila: es la misma regla que ya aplica hasPermission() en el
  frontend, escrita ahora también en el motor. Que las dos digan lo mismo
  es la única forma de que saltarse el frontend no sirva de nada.
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
            where u.auth_id = auth.uid()
              and u.activo
              and p.seccion = p_seccion
         )
$$;

-- ─────────────────────────────────────────────────────────
-- QUÉ UBICACIONES PUEDO CONSULTAR
-- ─────────────────────────────────────────────────────────
/*
  La única pregunta que hace falta contestar, y en un solo sitio: la
  política de inventario_ubicacion y la vista de existencias la llaman las
  dos. Dos copias de esta regla se separarían, y entonces la pantalla
  mostraría algo distinto de lo que la base deja leer.

  Deliberadamente NO filtra por `activa`. Una ubicación desactivada que
  todavía tenga existencia tiene que poder consultarse —si no, diez
  unidades desaparecen de la vista sin haberse movido—; lo que no debe
  hacer es aparecer como destino operativo. El filtro de `activa` vive en
  la vista, que es la que sirve a la operación del día.

  La empresa se comprueba aquí dentro, y no se delega en la política de
  `ubicaciones`, porque esta función es SECURITY DEFINER: pasa por encima
  de RLS, así que tiene que poner el límite ella misma.
*/
create or replace function usuario_ve_ubicacion(p_ubicacion uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from ubicaciones u
     where u.id = p_ubicacion
       and u.empresa_id = empresa_del_usuario()
       and (
            usuario_tiene_permiso('inventory-all')
         or (
              usuario_tiene_permiso('inventory-own')
              and u.id = ubicacion_del_usuario()
            )
       )
  )
$$;

-- ─────────────────────────────────────────────────────────
-- LA POLÍTICA SE ESTRECHA
-- ─────────────────────────────────────────────────────────
/*
  Antes: cualquiera de la empresa veía las celdas de todas las ubicaciones.
  Ahora: solo las de las ubicaciones que puede consultar.

  Es un cambio de comportamiento, no un añadido, y conviene que quede
  dicho: un usuario sin ninguno de los dos permisos pasa de ver todo el
  inventario a no ver ninguna celda. Hoy no afecta a nadie —el único
  usuario de producción es administrador, y el administrador los tiene
  todos por usuario_tiene_permiso()—, pero afectará al primer vendedor que
  se cree, y eso es exactamente lo que se quería.

  Sigue siendo `for select`. Los revoke de insert, update y delete de la
  0014 no se tocan: ver no es escribir, y ninguno de los dos permisos
  nuevos concede escritura porque no hay ninguna que conceder.
*/
drop policy if exists inventario_ubicacion_de_mi_empresa on inventario_ubicacion;
drop policy if exists inventario_ubicacion_visible on inventario_ubicacion;

create policy inventario_ubicacion_visible on inventario_ubicacion
  for select
  to authenticated
  using (
    empresa_id = empresa_del_usuario()
    and usuario_ve_ubicacion(ubicacion_id)
  );

-- ─────────────────────────────────────────────────────────
-- LA EXISTENCIA, VISTA DESDE FUERA
-- ─────────────────────────────────────────────────────────
/*
  Esta vista existe por una razón muy concreta, y es la parte más delicada
  de la migración.

  La 0014 representa el cero por AUSENCIA de celda: no se guardan filas en
  cero porque no dicen nada que la ausencia no diga ya. Pero entonces, si
  la consulta se limitara a filtrar inventario_ubicacion, dos situaciones
  completamente distintas se verían iguales —en las dos no hay fila—:

    A. ubicación que puedo ver, y que no tiene ese producto  -> es 0
    B. ubicación que no puedo ver                            -> no es 0,
                                                                es «no te
                                                                lo puedo
                                                                decir»

  Confundirlas en el sentido B -> 0 es peor que no mostrar nada: enseñaría
  «Camión 02: 0» a quien no tiene permiso de saberlo, y además sería
  mentira la mitad de las veces.

  La salida es partir de las UBICACIONES y no de las celdas. Así el
  left join produce el 0 del caso A, y el caso B no llega a la unión porque
  su ubicación ya quedó fuera.

  Nótese que `usuario_ve_ubicacion(u.id)` es imprescindible aquí y no
  bastaría con la política de inventario_ubicacion: con
  security_invoker = on, una celda que RLS oculta hace que el left join
  devuelva null, y el coalesce lo convertiría en 0. Es decir, apoyarse
  solo en RLS produce exactamente el error B -> 0. El filtro tiene que
  estar sobre las ubicaciones, antes de unirlas.

  No expone costo, ni margen, ni utilidad: ver cuántas unidades hay en un
  camión no es saber cuánto costaron. Tampoco el precio, que esta pantalla
  no necesita. El costo sigue sin protección propia en el resto del
  esquema, y eso es un problema aparte que no se mezcla aquí.
*/
drop view if exists existencias_por_ubicacion;

create view existencias_por_ubicacion
with (security_invoker = on)
as
  select
    u.empresa_id,
    u.id      as ubicacion_id,
    u.nombre  as ubicacion,
    u.tipo    as ubicacion_tipo,
    p.id      as producto_id,
    p.codigo,
    p.nombre  as producto,
    coalesce(i.cantidad, 0) as cantidad,
    i.actualizado_en
  from ubicaciones u
  join productos p
    on p.empresa_id = u.empresa_id
  left join inventario_ubicacion i
    on i.ubicacion_id = u.id
   and i.producto_id  = p.id
 where u.activa
   and p.activo
   and usuario_ve_ubicacion(u.id);

/*
  Solo lectura, y de lectura no hay nada que revocar: la vista tiene una
  junta, así que PostgreSQL no la considera actualizable y no acepta
  escrituras contra ella en ningún caso.
*/
grant select on existencias_por_ubicacion to authenticated;
