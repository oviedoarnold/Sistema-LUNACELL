-- La existencia deja de ser un número por producto y pasa a ser uno por
-- producto y ubicación.
--
-- Hasta hoy el stock no se guardaba en ningún sitio: se calculaba sumando
-- movimientos_inventario. Eso respondía «cuántos hay» pero nunca «dónde
-- están», y LUNACELL opera con una bodega, una tienda y camiones que
-- venden en ruta. Un camión que no sabe qué lleva no puede vender.
--
-- El modelo pasa a ser híbrido, que es la forma que ya tiene el resto del
-- sistema de separar el estado del relato:
--
--   inventario_ubicacion   -> la existencia operativa, autoritativa
--   movimientos_inventario -> el Kardex, que explica cómo se llegó ahí
--
-- El total de la empresa NO se guarda en ninguna parte: es la suma de las
-- celdas. Una columna con el total se desincroniza el día que alguien
-- escriba en una sin tocar la otra, y entonces hay dos respuestas para la
-- misma pregunta.
--
-- Esta migración crea SOLO el modelo, su integridad y la apertura. No trae
-- la ubicación operativa del usuario, ni permisos por ubicación, ni
-- traslados, ni el motor de venta: cada uno tiene su fase.

-- ─────────────────────────────────────────────────────────
-- ÍNDICES DE APOYO PARA LAS LLAVES COMPUESTAS
-- ─────────────────────────────────────────────────────────
/*
  PostgreSQL solo acepta apuntar a columnas cubiertas por una restricción
  única, así que emparejar el id con la empresa exige estos dos. Como el id
  ya es la clave primaria, el par es único de por sí y no restringen nada
  nuevo.

  Es el mismo patrón que la 0012 usó para clientes, y por la misma razón
  que allí: RLS no basta cuando quien escribe es una función SECURITY
  DEFINER, porque esa pasa por encima.
*/
create unique index if not exists productos_id_empresa
  on productos (id, empresa_id);

create unique index if not exists ubicaciones_id_empresa
  on ubicaciones (id, empresa_id);

-- ─────────────────────────────────────────────────────────
-- LA EXISTENCIA
-- ─────────────────────────────────────────────────────────

create table if not exists inventario_ubicacion (
  empresa_id   uuid not null references empresas (id) on delete cascade,

  /*
    La clave primaria es el par ubicación + producto y no un uuid propio.

    Casi todas las tablas del esquema usan `id uuid primary key`, pero esta
    no es una entidad: es una celda de una cuadrícula, igual que
    permisos_usuario —la única otra con clave compuesta— es un cruce entre
    un usuario y una sección. Darle un id inventaría una identidad que
    nadie va a nombrar, y obligaría a un UNIQUE aparte para impedir dos
    celdas del mismo par: dos restricciones para lo que una expresa.

    La empresa no entra en la clave porque la ubicación ya la determina:
    añadirla no permitiría ninguna combinación nueva y ensancharía todos
    los índices. Que las dos coincidan lo garantizan las llaves compuestas
    de abajo, que es más fuerte que repetir la columna aquí.
  */
  ubicacion_id uuid not null,
  producto_id  uuid not null,

  /*
    Entero porque las unidades no se parten: el esquema ya usa integer en
    detalle_venta.cantidad y en movimientos_inventario.cantidad.

    Y nunca negativo. Esto es lo que vuelve imposible vender lo que no hay,
    pase lo que pase por encima: aunque una función se escriba mal, la fila
    no entra. No resuelve la concurrencia —dos ventas simultáneas siguen
    necesitando un candado, y eso es INV-3—, pero sí garantiza que el
    resultado nunca quede por debajo de cero.
  */
  cantidad integer not null default 0 check (cantidad >= 0),

  actualizado_en timestamptz not null default now(),

  primary key (ubicacion_id, producto_id),

  /*
    El producto y la ubicación tienen que ser de la misma empresa que la
    celda. Con llaves simples, una función mal escrita podría cruzar el
    inventario de dos empresas sin que nada lo notara; emparejando la
    empresa, el motor lo impide.
  */
  constraint inventario_producto_de_mi_empresa
    foreign key (producto_id, empresa_id)
    references productos (id, empresa_id) on delete cascade,

  constraint inventario_ubicacion_de_mi_empresa
    foreign key (ubicacion_id, empresa_id)
    references ubicaciones (id, empresa_id) on delete cascade
);

/*
  «Cuánto hay de este producto en toda la empresa» y «qué hay en esta
  ubicación» son las dos preguntas que se harán siempre. La primera la
  sirve este índice; la segunda, la clave primaria.
*/
create index if not exists idx_inventario_empresa_producto
  on inventario_ubicacion (empresa_id, producto_id);

-- ─────────────────────────────────────────────────────────
-- POLÍTICA DE ACCESO
-- ─────────────────────────────────────────────────────────
/*
  Solo lectura, y a propósito.

  Una política `for all` dejaría a cualquier usuario autenticado cambiar su
  propia existencia con un update desde el navegador, que es exactamente lo
  que la arquitectura no quiere: la autoridad es PostgreSQL. Sin política
  de escritura, RLS niega insert, update y delete a `authenticated`, y las
  funciones SECURITY DEFINER que vendrán en INV-3 e INV-5 escriben igual
  porque pasan por encima de RLS por definición.

  El aislamiento por empresa es el mismo del resto del esquema. La
  visibilidad por ubicación —ver solo la propia, o todas— es de INV-2 y no
  se adelanta aquí: hoy todos ven las de su empresa, que es lo que ya
  ocurría con el stock global.
*/
alter table inventario_ubicacion enable row level security;

drop policy if exists inventario_ubicacion_de_mi_empresa on inventario_ubicacion;

create policy inventario_ubicacion_de_mi_empresa on inventario_ubicacion
  for select
  to authenticated
  using (empresa_id = empresa_del_usuario());

/*
  Y además se le retira el permiso de escribir, que no es lo mismo.

  Sin política de escritura, RLS ya impide cambiar nada: un insert choca y
  un update simplemente no encuentra filas. Pero ese update «no encuentra
  filas» es silencioso —se comprobó—, y un cliente que intenta mover
  existencias merece un no rotundo, no un éxito vacío que parezca haber
  funcionado.

  Revocar deja además escrito en la migración lo que la ausencia de una
  política solo insinuaba: por aquí no se escribe. Las funciones SECURITY
  DEFINER de INV-3 e INV-5 no se ven afectadas, porque corren como su
  dueño.
*/
revoke insert, update, delete on inventario_ubicacion from authenticated;
revoke insert, update, delete on inventario_ubicacion from anon;

-- ─────────────────────────────────────────────────────────
-- EL KARDEX APRENDE DÓNDE
-- ─────────────────────────────────────────────────────────
/*
  Nullable, y no por comodidad.

  Los doce movimientos que ya existen se registraron cuando el sistema no
  tenía ubicaciones conectadas al inventario, así que nadie anotó dónde
  ocurrieron. Ponerlos todos en Bodega sería inventar historia: la apertura
  decide dónde está el stock HOY, que es un hecho que el dueño puede
  confirmar mirando, pero no dice dónde ocurrió una venta de septiembre.

  Son dos cosas distintas y se tratan distinto: el estado actual se fija,
  el pasado se deja como estaba. Los movimientos que escriban los flujos
  de INV-3 en adelante sí llevarán ubicación, y entonces esta columna podrá
  endurecerse mirando si queda alguno sin ella.
*/
alter table movimientos_inventario
  add column if not exists ubicacion_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'movimientos_ubicacion_de_mi_empresa'
       and conrelid = 'movimientos_inventario'::regclass
  ) then
    alter table movimientos_inventario
      add constraint movimientos_ubicacion_de_mi_empresa
      foreign key (ubicacion_id, empresa_id)
      references ubicaciones (id, empresa_id);
  end if;
end $$;

create index if not exists idx_movimientos_ubicacion
  on movimientos_inventario (ubicacion_id, producto_id, fecha desc);

-- ─────────────────────────────────────────────────────────
-- LA VENTA APRENDE DE DÓNDE SALIÓ
-- ─────────────────────────────────────────────────────────
/*
  La costura para las anulaciones, puesta ahora porque después sale cara.

  Cuando se anule una factura habrá que devolver la mercadería a la
  ubicación DESDE LA QUE SE VENDIÓ, no a aquella en la que esté quien pulsa
  «Anular»: el camión pudo cambiar de ruta. Si esta columna no existe desde
  el principio, ese dato hay que adivinarlo.

  Nullable por las ocho ventas que ya existen, que no conocían ubicación.
  Esta fase NO cambia el flujo del punto de venta: la columna queda
  disponible y es INV-3 quien la llenará.
*/
alter table ventas
  add column if not exists ubicacion_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ventas_ubicacion_de_mi_empresa'
       and conrelid = 'ventas'::regclass
  ) then
    alter table ventas
      add constraint ventas_ubicacion_de_mi_empresa
      foreign key (ubicacion_id, empresa_id)
      references ubicaciones (id, empresa_id);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────
-- LA APERTURA
-- ─────────────────────────────────────────────────────────
/*
  El corte entre el modelo viejo y el nuevo.

  Toma el stock que hoy se deduce sumando movimientos y lo escribe como
  existencia inicial en la bodega de cada empresa. No inventa ni pierde
  unidades: al terminar comprueba que la suma de las celdas es exactamente
  la suma de los movimientos, y si no coincide levanta la mano y deshace
  todo. Una migración que descuadra el inventario en silencio es peor que
  una que falla.

  NO escribe ningún movimiento de apertura, y esto es lo más importante de
  aquí. Las vistas productos_con_stock y stock_actual suman TODOS los
  movimientos sin mirar el tipo —se comprobó—, así que un movimiento de
  apertura de +10 haría que el panel, el inventario y el punto de venta
  mostraran 20 al instante. El Kardex de lo heredado son los doce
  movimientos que ya están; la apertura es el punto de partida del modelo
  nuevo, no un movimiento más.

  Se salta si ya hay celdas: correrla dos veces no duplica nada, que es lo
  que el README de migraciones promete de todas.
*/
do $$
declare
  v_empresa    record;
  v_bodega     uuid;
  v_bodegas    integer;
  v_producto   record;
  v_esperado   bigint;
  v_aplicado   bigint;
  v_celdas     integer := 0;
begin
  if exists (select 1 from inventario_ubicacion) then
    raise notice 'La apertura ya se hizo: inventario_ubicacion tiene filas. No se toca nada.';
    return;
  end if;

  for v_empresa in select id, nombre from empresas loop

    /*
      La bodega se busca, no se nombra. Escribir un uuid o un nombre aquí
      ataría la migración a los datos de hoy, y esto tiene que poder
      correrse en una instalación nueva.
    */
    /*
      Se cuentan primero y se toma la única después. No se resuelve en una
      sola consulta con min(id) porque PostgreSQL no tiene min() para uuid;
      y aunque lo tuviera, elegir «la menor» sería decidir a escondidas en
      un caso que debe pararse.
    */
    select count(*) into v_bodegas
      from ubicaciones
     where empresa_id = v_empresa.id and tipo = 'bodega' and activa;

    if v_bodegas = 0 then
      raise exception
        'La empresa % no tiene ninguna bodega activa, y la apertura necesita una para dejar el stock existente.',
        v_empresa.nombre;
    end if;

    if v_bodegas > 1 then
      raise exception
        'La empresa % tiene % bodegas activas y la apertura no puede decidir por su cuenta en cuál queda el stock.',
        v_empresa.nombre, v_bodegas;
    end if;

    select id into v_bodega
      from ubicaciones
     where empresa_id = v_empresa.id and tipo = 'bodega' and activa;

    /*
      Solo los productos que tienen algo. Una celda en cero no dice nada
      que la ausencia no diga ya, y crear una por cada producto y cada
      ubicación llenaría la tabla de ceros: con 500 productos y 10
      ubicaciones serían 5.000 filas para no contar nada.
    */
    for v_producto in
      select p.id,
             p.nombre,
             coalesce(sum(m.cantidad), 0)::integer as stock
        from productos p
        left join movimientos_inventario m on m.producto_id = p.id
       where p.empresa_id = v_empresa.id
       group by p.id, p.nombre
      having coalesce(sum(m.cantidad), 0) <> 0
    loop
      if v_producto.stock < 0 then
        raise exception
          'El producto % de la empresa % tiene un stock histórico negativo (%). La apertura no puede repartir una existencia imposible; hay que corregirla antes.',
          v_producto.nombre, v_empresa.nombre, v_producto.stock;
      end if;

      insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
      values (v_empresa.id, v_bodega, v_producto.id, v_producto.stock);

      v_celdas := v_celdas + 1;
    end loop;
  end loop;

  /*
    La cifra de control. Se compara el total que deducía el modelo viejo
    contra el que declara el modelo nuevo, sobre TODOS los productos de
    todas las empresas a la vez.
  */
  select coalesce(sum(cantidad), 0) into v_esperado from movimientos_inventario;
  select coalesce(sum(cantidad), 0) into v_aplicado from inventario_ubicacion;

  if v_esperado <> v_aplicado then
    raise exception
      'La apertura no cuadra: los movimientos suman % unidades y las celdas creadas suman %. No se acepta una migración que invente o pierda existencias.',
      v_esperado, v_aplicado;
  end if;

  raise notice 'Apertura correcta: % celdas, % unidades, que es exactamente lo que sumaban los movimientos.',
    v_celdas, v_aplicado;
end $$;
