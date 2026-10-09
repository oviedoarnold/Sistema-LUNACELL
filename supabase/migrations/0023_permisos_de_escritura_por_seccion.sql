-- Seguridad: productos y ubicaciones se escriben solo con el permiso de su
-- sección (SEC-3a).
--
-- Hasta aquí las dos tablas tenían una sola política, para todo, cuya única
-- condición era la empresa. Cualquier empleado activo —un vendedor con solo
-- `pos`— podía crear productos, cambiar precios, crear ubicaciones y marcar
-- una como fiscal. Y podía BORRAR un producto: las llaves en cascada se
-- llevaban con él su libro de inventario, su existencia y sus renglones de
-- traslado, por encima de la 0019, porque la cascada la ejecuta el dueño
-- de la tabla.
--
-- Además, el disparador que impide desactivar una ubicación desde la que
-- alguien opera contaba los usuarios con la RLS de quien desactivaba. Un
-- empleado que no es administrador solo ve su propia fila, contaba cero y
-- la desactivación pasaba.
--
-- En producción nadie pudo aprovecharlo: la única cuenta es la del
-- administrador. Tiene que estar aplicada antes de invitar al primer
-- empleado.
--
-- Lo que NO hace: no toca ningún dato, no cambia quién LEE qué, no toca
-- llaves ni cascadas, no toca storage —las imágenes de producto van en su
-- propia migración— ni clientes, proveedores o cotizaciones (SEC-3b).

-- ─────────────────────────────────────────────────────────
-- PRODUCTOS
-- ─────────────────────────────────────────────────────────
/*
  Una política por operación en vez de una para todo, para que ninguna se
  sume por OR a otra y abra lo que esta cierra.

  - Leer: igual que antes, el catálogo de la propia empresa. Lo necesitan
    el punto de venta, las cotizaciones, el inventario y los traslados.
  - Crear y cambiar: además, el permiso `products`.

  En el cambio, el permiso va en WITH CHECK y no en USING. Con él en USING
  la fila sería invisible para actualizar y PostgreSQL contestaría «0
  filas» sin error: la pantalla creería que guardó. En WITH CHECK el
  intento choca con un error de permiso (42501) y no cambia nada. Las dos
  cierran igual; esta además dice la verdad.

  `(select …)` hace que el permiso se calcule una vez por sentencia y no
  una vez por fila.
*/
drop policy if exists productos_de_mi_empresa on public.productos;

drop policy if exists productos_lectura on public.productos;
create policy productos_lectura on public.productos
  for select
  to authenticated
  using (empresa_id = public.empresa_del_usuario());

drop policy if exists productos_alta on public.productos;
create policy productos_alta on public.productos
  for insert
  to authenticated
  with check (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('products'))
  );

drop policy if exists productos_cambio on public.productos;
create policy productos_cambio on public.productos
  for update
  to authenticated
  using (empresa_id = public.empresa_del_usuario())
  with check (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('products'))
  );

/*
  Un producto no se borra: se desactiva (`activo = false`), que es lo
  único que hace la pantalla. Sin política de borrado RLS ya no dejaría
  borrar nada, pero en silencio; sin el privilegio, el intento es un error
  claro. Vale también para el administrador mientras use la aplicación.
*/
revoke delete on public.productos from authenticated, anon;

-- ─────────────────────────────────────────────────────────
-- UBICACIONES
-- ─────────────────────────────────────────────────────────
-- Mismo patrón y mismo razonamiento que productos, con `locations`.
drop policy if exists ubicaciones_de_mi_empresa on public.ubicaciones;

drop policy if exists ubicaciones_lectura on public.ubicaciones;
create policy ubicaciones_lectura on public.ubicaciones
  for select
  to authenticated
  using (empresa_id = public.empresa_del_usuario());

drop policy if exists ubicaciones_alta on public.ubicaciones;
create policy ubicaciones_alta on public.ubicaciones
  for insert
  to authenticated
  with check (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('locations'))
  );

drop policy if exists ubicaciones_cambio on public.ubicaciones;
create policy ubicaciones_cambio on public.ubicaciones
  for update
  to authenticated
  using (empresa_id = public.empresa_del_usuario())
  with check (
    empresa_id = public.empresa_del_usuario()
    and (select public.usuario_tiene_permiso('locations'))
  );

-- Tampoco se borran: se desactivan.
revoke delete on public.ubicaciones from authenticated, anon;

-- ─────────────────────────────────────────────────────────
-- QUÉ UBICACIÓN VENDE Y CUÁL FACTURA CON CAI
-- ─────────────────────────────────────────────────────────
/*
  `emite_fiscal` decide qué ubicación numera con el CAI y `vende` cuáles
  pueden facturar. Son decisiones del administrador, no de quien solo
  administra ubicaciones.

  Por qué un disparador: los permisos por columna no distinguen al
  vendedor del administrador —los dos son `authenticated`— y una política
  no ve el valor anterior de la fila.

  A quién vigila: al rol efectivo de la base, no a la presencia de un JWT.
  La aplicación entra siempre como `authenticated` o `anon`; ahí se exige
  ser administrador. Quedan fuera:
  - el dueño de la base, que es quien corre las migraciones;
  - `service_role`, que ya pasa por encima de RLS y cuya clave solo vive
    en el servidor, nunca en el navegador;
  - las funciones SECURITY DEFINER, que corren como su dueño. Hoy ninguna
    escribe en ubicaciones.

  Al crear, quien no es administrador solo puede dejar los valores por
  omisión (vende, no es fiscal), que es exactamente lo que manda la
  pantalla: nunca envía estos dos campos.

  SECURITY INVOKER: no necesita leer nada más que la fila que llega.
*/
create or replace function public.ubicaciones_fiscal_solo_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if public.usuario_es_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.emite_fiscal is distinct from false or new.vende is distinct from true then
      raise exception 'Solo un administrador decide si una ubicación vende o emite factura fiscal'
        using errcode = '42501';
    end if;
  elsif new.emite_fiscal is distinct from old.emite_fiscal
     or new.vende is distinct from old.vende then
    raise exception 'Solo un administrador decide si una ubicación vende o emite factura fiscal'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists ubicaciones_fiscal_solo_admin on public.ubicaciones;

create trigger ubicaciones_fiscal_solo_admin
  before insert or update on public.ubicaciones
  for each row
  execute function public.ubicaciones_fiscal_solo_admin();

-- Un disparador no se llama directo: nadie de la aplicación necesita ejecutarlo.
revoke execute on function public.ubicaciones_fiscal_solo_admin() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- LA UBICACIÓN DESDE LA QUE ALGUIEN OPERA
-- ─────────────────────────────────────────────────────────
/*
  Misma regla que la 0015, mismo mensaje. Lo único que cambia es con qué
  ojos cuenta: ahora como su dueño (SECURITY DEFINER), para ver a todos los
  usuarios que operan desde esa ubicación y no solo a quien desactiva.

  Por qué es seguro:
  - solo cuenta; no devuelve filas ni datos de usuarios, y el mensaje dice
    cuántos, no quiénes;
  - mira únicamente la ubicación que se está actualizando, que quien
    desactiva ya pudo ver y modificar según su política;
  - search_path vacío y todo calificado, para que nadie le cuele otra
    tabla `usuarios`;
  - es un disparador: no se puede llamar como función, y además se le
    retira la ejecución a la aplicación.
*/
create or replace function public.ubicaciones_no_desactivar_operativa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuarios integer;
begin
  if old.activa and not new.activa then
    select count(*) into v_usuarios
      from public.usuarios
     where ubicacion_id = old.id;

    if v_usuarios > 0 then
      raise exception
        'No se puede desactivar «%»: es la ubicación operativa de % usuario(s). Cámbiales la ubicación antes.',
        old.nombre, v_usuarios;
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.ubicaciones_no_desactivar_operativa() from public, anon, authenticated;
