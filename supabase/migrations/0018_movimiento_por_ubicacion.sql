-- Entradas y ajustes de existencia, siempre en una ubicación.
--
-- Hasta aquí, crear un producto con existencia inicial o corregir su
-- cantidad desde Productos insertaba un movimiento SIN ubicación y no
-- tocaba inventario_ubicacion. El stock global —la suma del libro— cambiaba
-- y la existencia por ubicación no. Mientras el punto de venta descuente
-- del total, eso no se nota; el día que venda desde la celda de su
-- ubicación (INV-3.3), lo cargado así aparece en el catálogo y no se puede
-- vender, y lo dado de baja así se sigue pudiendo vender.
--
-- Esta migración da el único camino para que una entrada o un ajuste
-- muevan las dos cosas a la vez. El frontend no puede escribir la celda
-- por su cuenta: la 0014 le revocó insert, update y delete sobre
-- inventario_ubicacion precisamente para que solo lo hagan funciones como
-- ésta.
--
-- Lo que NO trae: traslados entre ubicaciones (INV-4), compras, ni la
-- conexión del punto de venta (INV-3.3). Tampoco cierra todavía el insert
-- directo en movimientos_inventario: el punto de venta actual lo sigue
-- usando hasta INV-3.3, y retirárselo hoy dejaría de facturar.

create or replace function registrar_movimiento_ubicacion(
  p_producto_id  uuid,
  p_ubicacion_id uuid,
  p_tipo         text,
  p_cantidad     integer,
  p_motivo       text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_empresa    uuid;
  v_usuario    uuid;
  v_ubic       record;
  v_producto   record;
  v_anterior   integer;
  v_nueva      integer;
  v_movimiento bigint;
  v_motivo     text;
begin
  /*
    SECURITY DEFINER porque escribe en inventario_ubicacion, que
    `authenticated` no puede tocar. Como eso apaga RLS, la empresa no se
    acepta como parámetro: se deriva del usuario autenticado, igual que en
    registrar_venta_ubicacion() y registrar_pago_cliente().
  */
  v_empresa := empresa_del_usuario();

  if v_empresa is null then
    raise exception 'Solo un usuario activo de una empresa puede mover inventario'
      using errcode = '42501';
  end if;

  /*
    El permiso es el de la pantalla de Productos, que es desde donde se
    carga y se corrige la existencia. Un administrador lo tiene siempre.

    No se limita a la ubicación operativa del usuario: quien recibe
    mercadería en la bodega no tiene por qué estar asignado a ella.
  */
  if not usuario_tiene_permiso('products') then
    raise exception 'No tienes permiso para registrar entradas ni ajustes de inventario'
      using errcode = '42501';
  end if;

  select id into v_usuario
    from usuarios
   where auth_id = auth.uid()
     and activo
   limit 1;

  -- ── lo que se pide ──
  if p_tipo is null or p_tipo not in ('entrada', 'ajuste') then
    raise exception 'Tipo de movimiento desconocido: %', coalesce(p_tipo, '(vacío)')
      using errcode = 'LI002';
  end if;

  if p_producto_id is null or p_ubicacion_id is null then
    raise exception 'Falta el producto o la ubicación del movimiento'
      using errcode = 'LI002';
  end if;

  /*
    Una entrada solo suma. Un ajuste puede ir en los dos sentidos, pero un
    ajuste de cero no es un ajuste: dejaría un renglón en el Kardex que no
    movió nada.
  */
  if p_cantidad is null or p_cantidad = 0
     or (p_tipo = 'entrada' and p_cantidad < 0) then
    raise exception 'La cantidad del movimiento no es válida'
      using errcode = 'LI002';
  end if;

  -- ── dónde ──
  select id, nombre, activa into v_ubic
    from ubicaciones
   where id = p_ubicacion_id
     and empresa_id = v_empresa;

  if not found then
    raise exception 'La ubicación no pertenece a tu empresa'
      using errcode = '42501';
  end if;

  /*
    Una ubicación desactivada no recibe mercadería ni se corrige: es la
    misma regla que la vista de existencias, donde solo las activas son
    destino operativo.
  */
  if not v_ubic.activa then
    raise exception
      'La ubicación «%» está desactivada. Actívala antes de registrar movimientos en ella.',
      v_ubic.nombre
      using errcode = 'LI001';
  end if;

  -- ── qué ──
  /*
    Se busca sin filtrar por empresa para poder distinguir «no existe» de
    «es de otra empresa»: lo primero es un dato equivocado, lo segundo un
    intento de cruzar empresas.
  */
  select id, nombre, activo, empresa_id into v_producto
    from productos
   where id = p_producto_id;

  if not found then
    raise exception 'El producto no existe'
      using errcode = 'LI004';
  end if;

  if v_producto.empresa_id <> v_empresa then
    raise exception 'El producto no pertenece a tu empresa'
      using errcode = '42501';
  end if;

  if not v_producto.activo then
    raise exception 'El producto «%» está inactivo', v_producto.nombre
      using errcode = 'LI004';
  end if;

  -- ── la celda, bajo candado ──
  /*
    La celda puede no existir todavía: la tabla guarda el cero como
    ausencia de fila. Se crea en cero y después se bloquea, en vez de leer
    y decidir si insertar, porque entre la lectura y el insert otra sesión
    podría crearla y una de las dos fallaría por la llave primaria.

    El `for update` es el mismo candado que toma registrar_venta_ubicacion()
    sobre la misma fila, así que un ajuste y una venta simultáneos se
    ordenan en vez de pisarse. Si el movimiento se rechaza más abajo, la
    transacción se deshace y la celda creada en cero desaparece con ella.
  */
  insert into inventario_ubicacion (empresa_id, ubicacion_id, producto_id, cantidad)
  values (v_empresa, p_ubicacion_id, p_producto_id, 0)
  on conflict (ubicacion_id, producto_id) do nothing;

  select cantidad into v_anterior
    from inventario_ubicacion
   where ubicacion_id = p_ubicacion_id
     and producto_id = p_producto_id
     for update;

  v_nueva := v_anterior + p_cantidad;

  /*
    Un ajuste no puede quitar lo que no hay. El check cantidad >= 0 de la
    0014 lo impediría igual, pero con un error que no dice cuánto había ni
    dónde.
  */
  if v_nueva < 0 then
    raise exception
      'No hay suficiente «%» en %: hay %, el ajuste quita %',
      v_producto.nombre,
      v_ubic.nombre,
      v_anterior,
      abs(p_cantidad)
      using errcode = 'LI003';
  end if;

  update inventario_ubicacion
     set cantidad = v_nueva,
         actualizado_en = now()
   where ubicacion_id = p_ubicacion_id
     and producto_id = p_producto_id;

  /*
    El movimiento lleva la ubicación siempre. Es lo que mantiene la
    invariante: para cada producto, la suma de sus celdas es la suma de su
    libro, porque cada cambio de una celda queda escrito en el libro con
    la misma cantidad.
  */
  v_motivo := coalesce(
    nullif(btrim(coalesce(p_motivo, '')), ''),
    case when p_tipo = 'entrada'
         then 'Existencia inicial'
         else 'Ajuste manual desde inventario'
    end
  );

  insert into movimientos_inventario (
    empresa_id, producto_id, usuario_id, venta_id,
    ubicacion_id, tipo, cantidad, motivo
  ) values (
    v_empresa, p_producto_id, v_usuario, null,
    p_ubicacion_id, p_tipo, p_cantidad, v_motivo
  )
  returning id into v_movimiento;

  return jsonb_build_object(
    'movimiento_id',       v_movimiento,
    'producto_id',         p_producto_id,
    'ubicacion_id',        p_ubicacion_id,
    'tipo',                p_tipo,
    'cantidad',            p_cantidad,
    'existencia_anterior', v_anterior,
    'existencia_nueva',    v_nueva
  );
end $$;

-- ─────────────────────────────────────────────────────────
-- QUIÉN PUEDE EJECUTARLA
-- ─────────────────────────────────────────────────────────
/*
  PostgreSQL concede EXECUTE a PUBLIC al crear una función. Sin estas
  líneas, `anon` podría llamarla por /rest/v1/rpc; no pasaría de la
  primera comprobación, pero no tiene por qué llegar hasta ahí.
*/
revoke execute on function registrar_movimiento_ubicacion(
  uuid, uuid, text, integer, text
) from public;

revoke execute on function registrar_movimiento_ubicacion(
  uuid, uuid, text, integer, text
) from anon;

grant execute on function registrar_movimiento_ubicacion(
  uuid, uuid, text, integer, text
) to authenticated, service_role;
