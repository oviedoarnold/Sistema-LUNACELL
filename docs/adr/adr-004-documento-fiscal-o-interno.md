# ADR-4: Vender, emitir factura fiscal y numerar son tres cosas distintas

- **Fecha:** 2026-10-01
- **Estado:** Aceptada e implementada
- **Ruta:** `docs/adr/adr-004-documento-fiscal-o-interno.md`
- **Migración:** `0017_documento_fiscal_o_interno.sql`

## Contexto

La `0016` dejó la venta atómica y por ubicación, pero armaba el documento
como si la empresa tuviera un solo emisor: pedía el correlativo de
`empresas` y sellaba el CAI de `empresas`, viniera la venta de donde
viniera.

Eso no se nota hoy, y por eso era peligroso. La empresa no tiene CAI
configurado, así que todas las ventas salen con numeración interna y el
problema no aparece en ninguna pantalla. **El día que se configure el CAI
de Lunacell Store, una venta desde un camión se emitiría con ese CAI y
consumiría ese rango autorizado** — no porque alguien lo decidiera, sino
porque el sistema no tenía dónde guardar otra respuesta.

El dueño confirmó la regla del negocio:

- solo Lunacell Store emite factura con CAI y numeración autorizada;
- los camiones venden, pero con documento interno;
- la bodega hoy no vende, pero debe quedar preparada para hacerlo, y
  cuando lo haga será también con documento interno.

Y una restricción de diseño: la regla no puede depender del nombre de la
ubicación.

## Decisión

### 1. Tres conceptos, y por qué no son dos

| | Pregunta | Dónde vive |
|---|---|---|
| **Vender** | ¿puede salir mercadería de aquí por una venta? | `ubicaciones.vende` |
| **Emitir fiscal** | ¿lo que emite es factura autorizada o documento interno? | `ubicaciones.emite_fiscal` |
| **Configuración** | ¿con qué CAI, qué rango y qué contador? | `empresas`, como hasta ahora |

Son dos marcas y no una porque **el caso de la bodega lo exige**: se quiere
que pueda vender algún día sin que por ello emita factura fiscal. Con una
sola marca habría que elegir entre las dos cosas.

Y son marcas y no tipos porque `tipo` describe qué **es** el sitio —bodega,
tienda, camión— y no qué **puede hacer**. Derivar la regla de
`tipo <> 'bodega'` habría dejado sin salida el día que exista un segundo
almacén que sí venda, y habría escondido una decisión de negocio dentro de
una clasificación física.

### 2. La asimetría de los valores por omisión

`vende` nace en **verdadero** y `emite_fiscal` en **falso**, y esa
diferencia es el centro de la decisión.

`vende` en verdadero conserva lo que el sistema hace hoy: ninguna ubicación
está marcada y todas son igual de capaces. Ponerlo en falso dejaría a la
tienda y a los camiones sin poder facturar hasta que alguien se acordara de
encenderlos.

`emite_fiscal` en falso es la respuesta segura, y es lo que hace que **la
invariante se cumpla por omisión y no por configuración**: ninguna
ubicación puede consumir el rango autorizado mientras nadie diga
expresamente cuál lo emite. Si la migración se aplicara y nadie tocara nada
más, sería imposible gastar el CAI de la tienda por accidente.

Por eso la migración **no marca a ninguna ubicación como fiscal**. Hacerlo
buscándola por nombre es lo que la restricción prohíbe, y además es una
decisión de negocio sobre datos reales: la toma el dueño.

### 3. Como mucho una ubicación fiscal por empresa

```sql
create unique index ubicaciones_una_fiscal_por_empresa
  on ubicaciones (empresa_id) where emite_fiscal;
```

Es la pieza que convierte «qué ubicación usa la configuración fiscal» en una
pregunta con una sola respuesta. La configuración vive en `empresas` —un
CAI, un rango, un contador— así que dos ubicaciones marcadas compartirían el
mismo rango y nadie podría decir cuál lo gastó.

Y no se puede emitir desde donde no se vende:

```sql
check (not emite_fiscal or vende)
```

### 4. La configuración fiscal se queda donde está

Se evaluó moverla a `ubicaciones`. **No se movió**, por tres razones:

- hoy hay un solo emisor fiscal, así que mover las columnas no añade
  ninguna capacidad: solo cambia de sitio el mismo dato;
- `rtn` es de la empresa, no de la ubicación, así que la mudanza no sería
  limpia: habría que partir el bloque;
- el índice único de arriba ya da la relación inequívoca que hacía falta.

Si algún día hay dos CAI, las columnas se mueven entonces, con el caso real
delante. Mientras tanto, mover sería arquitectura para un futuro que no
existe.

### 5. Dos contadores, que es donde vive la invariante

```sql
alter table empresas add column proximo_correlativo_interno bigint not null default 1;
```

`siguiente_correlativo()` aprende un tercer tipo, `'interno'`, con el mismo
`UPDATE … RETURNING` que ya tomaba el candado de la fila de la empresa.

**Aquí está la garantía, y conviene decir exactamente dónde:** una venta
interna llama a `siguiente_correlativo('interno')`, que toca otra columna.
No existe ningún camino por el que una venta no fiscal avance el contador
autorizado, porque no lo nombra.

El contador nace detrás de las ventas que ya existían, para que un documento
interno nuevo no choque visualmente con un `FAC-` viejo. Ese arranque se une
**solo** a las empresas que tienen ventas y **solo** avanza cuando hay que
avanzar: `empresas` es multiempresa, y un `UPDATE` sin condición reescribiría
la fila de cada empresa del sistema sin cambiarle ningún valor, tomando su
candado y gastando WAL por nada.

La prueba de ese arranque **extrae la sentencia del propio archivo de
migración** por una marca, en vez de copiarla: una copia solo demostraría que
la copia funciona, y seguiría verde el día que la migración cambiara.

### 6. El número interno se llama VTA, no FAC

```
000-001-01-00000009   factura autorizada
VTA-000009            documento interno
FAC-00009             numeración interna anterior a esta separación
```

Se cambió el prefijo porque «FAC» se lee como factura, y llamar factura a un
documento que no lo es invita exactamente a la confusión que esta decisión
viene a evitar. Son tres formas y no dos porque las ocho ventas anteriores
no se renumeran.

### 7. La venta recuerda qué fue

`ventas.es_fiscal`, copia y no referencia, por el mismo motivo que
`cai_emision`: si mañana la tienda deja de ser fiscal, las facturas que
emitió siguen siendo facturas.

**Esta columna no guarda ninguna invariante** —lo que impide gastar el rango
son las marcas y la lógica del RPC— pero evita deducirlo de
`cai_emision <> ''`, y eso ya demostró ser frágil: así es exactamente como
la plantilla acabó imprimiendo un bloque «CAI» vacío.

### 8. Ser fiscal exige las dos cosas

```
es_fiscal_la_venta = ubicacion.emite_fiscal AND empresa tiene CAI, rango y fecha límite
```

Marcar la ubicación no basta. Sin la configuración completa no hay
numeración autorizada que usar, y emitir una «factura» con el CAI vacío
sería el mismo defecto por otra puerta.

Esto tiene una consecuencia cómoda: **hoy, sin CAI, todas las ventas son
internas, incluida la de la tienda**, así que la migración no cambia el
comportamiento actual. La tienda pasa a ser fiscal el día que se configure
el CAI, y solo ella.

## Consecuencias

**El conflicto latente queda cerrado.** Configurar el CAI de la tienda ya no
puede afectar a los camiones.

**La impresión distingue.** `aVentaDeApp` deja de construir el bloque fiscal
cuando no lo hay, y la plantilla titula «DOCUMENTO INTERNO» en vez de
«FACTURA». La regla mira la marca **y** el CAI, no solo la marca, porque
durante la transición conviven dos caminos: el RPC escribe `es_fiscal` y el
camino anterior —que el punto de venta sigue usando hasta INV-3.3— sella
`cai_emision` sin escribir la marca.

Y el documento se nombra en más de un sitio que la cabecera. El encabezado
del bloque de datos y el título, el trabajo de impresión y el nombre del PDF
siguen ahora la misma regla, porque mirar `fiscal` en un sitio y decir
«factura» en los otros deja al lector sin saber a cuál creer; y de todo el
documento, **el nombre del archivo es lo único que sobrevive a la pantalla**.

**El contrato de numeración cambió**, y tres pruebas SQL y una de
JavaScript se actualizaron para describir el nuevo. No se debilitaron: antes
afirmaban `FAC-\d{5}` y `fiscal.cai === ""`, ahora afirman `VTA-\d{6}`,
`fiscal === null` y la marca correspondiente.

**Las ocho ventas anteriores no se tocan.** `es_fiscal` nace en falso, que es
lo que de verdad fueron, y conservan su `FAC-`.

## Qué se sacrificó

Se sacrificó tener la configuración fiscal junto a quien la usa. Hoy la
marca está en `ubicaciones` y el CAI en `empresas`, así que para responder
«con qué CAI factura la tienda» hay que mirar dos tablas.

Se aceptó porque la alternativa era mover ocho columnas y partir `rtn` para
no ganar ninguna capacidad, y porque el índice único deja la relación sin
ambigüedad. El día que haya dos CAI, esa mudanza tendrá un motivo; hoy sería
solo movimiento.

## Qué queda fuera

Medios de pago, bancos y link de pago: fase propia, decidida ya como
posterior. Conectar el punto de venta al RPC: INV-3.3. Traslados: INV-4.

Y una decisión que sigue siendo del dueño y de su contador: **qué documento
corresponde legalmente a una venta desde un camión**. Esta decisión le da al
sistema dónde guardar la respuesta; no dice cuál es.
