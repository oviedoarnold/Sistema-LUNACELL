-- Entrega de correlativos de factura y cotización.
--
-- El número no puede calcularse en el navegador. Dos cajas cobrando al
-- mismo tiempo leerían el mismo correlativo y la segunda factura chocaría
-- contra unique (empresa_id, numero_factura); peor aún, cualquiera podría
-- mandar el número que quisiera, y el SAR exige una secuencia continua
-- dentro del rango autorizado.
--
-- La empresa ya lleva sus dos contadores. Esta función los avanza tomando
-- el candado de la fila, así que entre leer y apartar el siguiente número
-- no cabe otra venta.

create or replace function siguiente_correlativo(p_tipo text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid := empresa_del_usuario();
  v_numero  bigint;
begin
  if v_empresa is null then
    raise exception 'El usuario no pertenece a ninguna empresa';
  end if;

  if p_tipo = 'factura' then
    update empresas
      set proximo_correlativo_factura = proximo_correlativo_factura + 1
      where id = v_empresa
      returning proximo_correlativo_factura - 1 into v_numero;

  elsif p_tipo = 'cotizacion' then
    update empresas
      set proximo_correlativo_cotizacion = proximo_correlativo_cotizacion + 1
      where id = v_empresa
      returning proximo_correlativo_cotizacion - 1 into v_numero;

  else
    raise exception 'Tipo de correlativo desconocido: %', p_tipo;
  end if;

  return v_numero;
end;
$$;

-- Ninguna empresa debe reutilizar un número ya emitido: si sembró datos
-- de demostración, el contador arranca después del último documento.
update empresas e
set proximo_correlativo_factura = greatest(
  e.proximo_correlativo_factura,
  coalesce((select max(v.correlativo) + 1 from ventas v where v.empresa_id = e.id), 1)
);

update empresas e
set proximo_correlativo_cotizacion = greatest(
  e.proximo_correlativo_cotizacion,
  coalesce((select max(c.correlativo) + 1 from cotizaciones c where c.empresa_id = e.id), 1)
);
