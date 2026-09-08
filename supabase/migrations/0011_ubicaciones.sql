-- Ubicaciones: los lugares donde LUNACELL guarda y mueve mercadería.
--
-- Una bodega, una tienda y un camión no son tres cosas distintas para el
-- sistema: son puntos de inventario. Modelarlos como una sola tabla con un
-- tipo, y no como tablas separadas, es lo que permitirá que el día que se
-- compre el Camión 03 no haya que tocar el esquema ni escribir una columna
-- de stock nueva.
--
-- Esta migración crea SOLO la entidad y su administración. El inventario
-- sigue funcionando exactamente como hasta ahora: movimientos_inventario
-- todavía no sabe de ubicaciones, y esa unión llega en su propia rama.

create table if not exists ubicaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas (id) on delete cascade,

  nombre      text not null,

  -- El tipo es un dato del negocio, no una tabla aparte: son cuatro
  -- valores que cambian cada varios años. Una tabla de catálogo aquí sería
  -- una junta más en cada consulta a cambio de nada.
  tipo        text not null default 'bodega'
                check (tipo in ('bodega', 'tienda', 'camion', 'otro')),

  -- No se borra: se desactiva. Una ubicación que movió mercadería tiene
  -- que seguir existiendo para que su historial siga teniendo sentido, por
  -- la misma razón por la que un producto se desactiva en vez de borrarse.
  activa      boolean not null default true,

  creada_en   timestamptz not null default now()
);

create index if not exists idx_ubicaciones_empresa on ubicaciones (empresa_id);

/*
  Dos "Camión 01" en la misma empresa serían indistinguibles en cuanto
  existan movimientos: nadie sabría a cuál de los dos entró la mercadería.
  La comparación ignora mayúsculas porque "Bodega Principal" y "BODEGA
  PRINCIPAL" son el mismo lugar para quien lo escribe.

  Alcanza también a las desactivadas a propósito: si el nombre choca con
  una que se apagó, lo correcto es volver a encenderla, no crear una
  segunda con su mismo nombre y partir el historial en dos.
*/
create unique index if not exists ubicaciones_nombre_unico
  on ubicaciones (empresa_id, lower(nombre));

-- ─────────────────────────────────────────────────────────
-- POLÍTICA DE ACCESO
-- ─────────────────────────────────────────────────────────
-- Mismo aislamiento que el resto del esquema: la empresa se resuelve en el
-- motor con empresa_del_usuario(), no llega desde el navegador.

alter table ubicaciones enable row level security;

drop policy if exists ubicaciones_de_mi_empresa on ubicaciones;

create policy ubicaciones_de_mi_empresa on ubicaciones
  for all
  to authenticated
  using (empresa_id = empresa_del_usuario())
  with check (empresa_id = empresa_del_usuario());

-- ─────────────────────────────────────────────────────────
-- PERMISO DE LA SECCIÓN
-- ─────────────────────────────────────────────────────────
/*
  permisos_usuario limita las secciones con una restricción, así que una
  pantalla nueva no existe para la base hasta que se la nombra aquí. Sin
  esto, guardar el permiso desde Configuración falla con un error de
  restricción y el administrador no puede repartir la sección.

  Se recrea la restricción entera en vez de agregarle un valor: PostgreSQL
  no permite extender un check existente.

  La restricción se busca en el catálogo en vez de darla por llamada
  permisos_usuario_seccion_check. Ese es el nombre que PostgreSQL le pone
  hoy, pero si por cualquier razón se llamara distinto, un
  "drop constraint if exists" con el nombre equivocado no borra nada y no
  avisa: la vieja seguiría rechazando 'locations' junto a la nueva, y el
  fallo aparecería recién al guardar el permiso. Buscarla por la columna
  que restringe no depende de cómo se llame.
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
    'locations'
  ));

/*
  Los administradores entran a todo sin necesitar filas en permisos_usuario
  —usuario_es_admin() les abre la puerta—, así que no hay que repartirles
  la sección nueva. A los vendedores se les asigna desde Configuración,
  como cualquier otra.
*/
