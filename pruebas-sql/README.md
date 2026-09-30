# Pruebas contra PostgreSQL de verdad

Las pruebas de `src/` usan [`supabaseFalso`](../src/test/supabaseFalso.js),
que guarda las filas en un objeto de JavaScript. Sirve para casi todo, pero
hay cuatro cosas que no puede contestar porque no las tiene:

- si un `CHECK` rechaza una fila,
- si RLS aísla una empresa de otra,
- si una transacción se deshace entera cuando algo falla a mitad,
- si dos sesiones que cobran a la vez se pisan el saldo.

Las cuatro son exactamente lo que hay que saber antes de dejar que una
función reparta dinero. De ahí esta carpeta.

## Cómo se corre

```bash
npm run test:sql
```

No hace falta instalar nada más, ni Docker, ni un PostgreSQL en la máquina.
`embedded-postgres` trae el binario real como dependencia de desarrollo, y
el arnés levanta un servidor desechable, le aplica el esquema y lo apaga al
terminar. Tarda unos veinte segundos, de los cuales la mitad es el arranque.

La versión está fijada a **17.10**, el mismo mayor que corre el proyecto de
Supabase. No es casualidad: el comportamiento de los candados de fila es lo
que se está probando, y probarlo contra otro mayor sería probar otra cosa.

## Qué base usan

Una que se crea y se borra en cada corrida, en el temporal del sistema.

**Nunca la del cliente.** El arnés no lee ninguna variable de entorno para
construir su conexión: el host, el puerto y el directorio los fija él, y
[`guardia.mjs`](guardia.mjs) lo comprueba antes de cada arranque. Si alguien
cambia el arnés más adelante para apuntar a un servidor, la guardia lo
detiene ahí mismo.

Es una protección necesaria y no una precaución de más: estas pruebas
insertan, borran y confirman transacciones. Contra Supabase harían eso sobre
las facturas reales.

## Qué se aplica

El preludio, y después las migraciones del proyecto **tal cual están**.

Eso es lo que le da valor: se prueba el archivo que se va a correr en
producción, no una copia adaptada que podría separarse de él sin que nadie
lo note. Si una migración no corre aquí, tampoco correría allá.

[`preludio-supabase.sql`](preludio-supabase.sql) pone antes lo que Supabase
da por hecho y un PostgreSQL recién instalado no tiene: el esquema `auth`
con `auth.uid()`, los roles `anon` y `authenticated`, y el mínimo de
`storage` para que la migración de imágenes de producto corra entera.

Se omiten las tres que cargan la ferretería de demostración (0002, 0006 y
0010), por la misma razón que el
[README de las migraciones](../supabase/migrations/README.md) dice que no se
corren en una base de LUNACELL.

## Cómo se prueba la concurrencia

Lanzar dos consultas y mirar el resultado **no prueba nada**: solo comprueba
en qué orden las mandó el bucle de eventos de Node. Si la segunda alcanza a
empezar después de que la primera confirmara, el caso pasa aunque no haya un
solo candado en la función.

Eso pasó aquí. La primera versión de la prueba de concurrencia daba verde
con los dos `for update` quitados.

La forma que sí prueba es `esperarBloqueo()`: la prueba no avanza hasta que
`pg_stat_activity` diga que la segunda sesión está de verdad detenida
esperando un candado. Si nunca lo dice, salta el tiempo y el caso falla.
Verificado quitando los candados: falla.

## Si se quisieran correr en CI

No hace falta ningún secreto ni ninguna credencial: la base es local y
desechable. Bastaría añadir un paso al flujo, después del `npm ci`:

```yaml
      - name: Pruebas SQL contra PostgreSQL real
        run: npm run test:sql
```

`embedded-postgres` publica el binario por plataforma, así que en el
`ubuntu-latest` del flujo se instalaría `@embedded-postgres/linux-x64` solo
con el `npm ci` que ya existe.

**No se añadió.** Meterlo en la puerta de calidad alarga cada corrida en
torno a medio minuto y hace que un fallo de descarga del binario bloquee
cualquier PR, incluido uno que no toque la base. Es una decisión de coste,
no técnica, y corresponde tomarla a quien paga los minutos. Mientras tanto
se corren a mano, que es cuando de verdad importan: al cambiar una migración
o el reparto.
