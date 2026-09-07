-- Quita los datos fiscales de muestra. NO es una migración.
--
-- Se corre una sola vez, el día que la ferretería tenga su CAI real. Vive
-- entre los scripts y no entre las migraciones a propósito: deshace la
-- parte fiscal de la 0006, así que aplicar la cadena entera dejaría la base
-- en un estado contradictorio.
--
-- Mientras el proyecto sea una demostración, no hace falta correrlo: el CAI
-- de muestra es lo que permite enseñar la numeración autorizada.
--
-- La migración 0006 le puso a la empresa demo un CAI y un rango de
-- ejemplo, para que el recorrido guiado mostrara la numeración autorizada.
-- Esa empresa pasó a ser la ferretería real, así que esos datos dejaron de
-- ser inocuos: el CAI 'DEM0AA-...' y el RTN '05019099887766' no los emitió
-- el SAR, y una factura que los lleve no es un documento fiscal válido.
--
-- Al dejarlos vacíos el sistema vuelve a la numeración interna (FAC-01209),
-- que no pretende ser un documento fiscal. Cuando la ferretería tenga su
-- CAI de verdad se carga desde Configuración, y a partir de ahí las
-- facturas salen con la numeración autorizada.
--
-- Las facturas ya emitidas no se tocan. Guardan copia del CAI que tenían al
-- momento de emitirse, y reescribir un documento emitido es exactamente lo
-- que el diseño evita. La que salió con el CAI inventado
-- (000-001-01-00001208) hay que anularla desde el sistema o a mano, y esa
-- es una decisión del negocio, no de una migración.

update empresas
set
  rtn                  = '',
  cai                  = '',
  rango_desde          = null,
  rango_hasta          = null,
  fecha_limite_emision = null,
  es_demo              = false
where es_demo;
