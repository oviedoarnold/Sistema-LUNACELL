# Migraciones en producción

Regla permanente del propietario: se aplica a **todas** las migraciones de Supabase de LUNACELL. Una migración solo se aplica con su autorización expresa. Esa autorización no incluye el merge ni el despliegue.

## 1. Intento con el conector

1. Antes de aplicar, verificar con consultas de solo lectura:
   - el proyecto;
   - el historial: cuántas migraciones hay, cuál es la última y que la nueva no esté registrada;
   - la integridad del archivo aprobado: MD5 y SHA-256 del commit aprobado, normalizado a LF;
   - las dependencias: tablas, columnas, funciones, restricciones e índices;
   - una huella de lo que ya existe (esquema y datos).
2. Aplicar con `apply_migration`. Si responde `success`, no repetir.
3. Si responde `declined`, `failed`, `error`, o cualquier cosa que no confirme que la migración quedó aplicada:
   - **no** reintentar la misma operación;
   - **no** usar otro método de escritura sobre producción;
   - **no** hacer merge del PR ni desplegar el frontend relacionado;
   - comprobar con consultas de solo lectura si hubo cambios parciales o un registro;
   - preparar de inmediato el procedimiento manual (punto 2).

## 2. Procedimiento manual

Se prepara en la carpeta `migraciones-NNNN-manual/`, junto al repositorio y fuera de Git, con estos archivos completos, listos para pegar en el SQL Editor:

| Paso | Contenido | Escribe |
|---|---|---|
| PASO 1 | Verificación previa de producción, con un veredicto y la lista de diferencias | No (un solo `SELECT`) |
| PASO 2 | Script de instalación | Sí |
| PASO 3 | Verificación de lo instalado | No |
| PASO 4 | Comprobación de que no cambió nada fuera de lo aprobado | No |
| PASO 5 | Instrucciones para seguir con el PR, el merge y el despliegue (`LEEME.md`) | No |

Nunca se entregan fragmentos, ni se pide al propietario que reconstruya el código de la migración.

El script del PASO 2:

1. Contiene **exactamente** el texto aprobado en GitHub, sin alterar su lógica.
2. Comprueba su MD5 y su SHA-256 después de quitar los retornos de carro (CRLF → LF) y **antes** de ejecutar nada.
3. Valida que las migraciones anteriores estén instaladas, que la nueva versión no esté registrada y que no queden rastros de ella.
4. Valida las tablas, columnas, funciones, restricciones y dependencias que necesita la migración, y que no haya diferencias con lo verificado.
5. Corre dentro de `BEGIN` / `COMMIT`: si cualquier comprobación o instrucción falla, no queda nada parcial.
6. Registra la migración en `supabase_migrations.schema_migrations` (`version`, `name`, `statements`) con ese mismo texto, solo después de aplicarla bien.
7. Comprueba antes del `COMMIT`:
   - lo instalado;
   - el registro, con su MD5 y su SHA-256;
   - que lo que ya existía quedó idéntico: funciones, políticas, privilegios, columnas, restricciones, índices, disparadores, historial y datos.
8. No duplica migraciones, registros, permisos, índices ni funciones, y no modifica datos salvo que la migración aprobada lo exija.

Si alguna instrucción no puede ejecutarse dentro de una transacción (`CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER TYPE … ADD VALUE` usado en la misma transacción, etc.), se advierte y se prepara un procedimiento aparte. Nunca se afirma una atomicidad que no esté garantizada.

Antes de entregarlo, el procedimiento se prueba en la base local de `pruebas-sql`, sobre la migración anterior, y debe cumplir:

- se niega ante un estado distinto;
- no deja cambios parciales si falla a mitad;
- funciona con el texto pegado con CRLF;
- da el mismo resultado que aplicar el archivo.

Las huellas se calculan con orden explícito. Un `string_agg(… order by 1)` ordena por la constante 1, no por la primera columna.

## 3. Seguridad

- Solo el propietario ejecuta el script en el SQL Editor.
- Ningún procedimiento alternativo de escritura sin su autorización, ni cambios adicionales aprovechando la instalación.
- Si producción muestra diferencias inesperadas, detenerse e informar antes de preparar una ejecución que podría ser insegura.
- Si el conector no está disponible, no se sustituyen las verificaciones de producción por supuestos: el PASO 1 las hace, y su resultado se revisa antes del PASO 2.
- Una migración no se da por instalada sin verificar su aplicación real.
- Cuando el propietario confirma que ejecutó el script, se hacen las comprobaciones posteriores con consultas de solo lectura.
- No hay merge ni despliegue hasta confirmar que todo está correcto. El merge sigue necesitando su propia autorización.
