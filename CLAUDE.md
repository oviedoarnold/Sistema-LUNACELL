# CLAUDE.md — contrato de trabajo del repositorio

Reglas permanentes para Claude y cualquier agente que trabaje en este
repositorio. Se aplican a **toda** tarea sin necesidad de repetirlas en el
prompt.

---

## Proyecto

**LUNACELL es un sistema empresarial real, en producción, para un cliente.**
No es un proyecto universitario, una demo ni un prototipo.

Prioridades, en este orden:

1. integridad de datos
2. seguridad
3. estabilidad
4. mantenibilidad
5. trazabilidad
6. calidad
7. experiencia del usuario

Stack: React · Vite · Supabase (PostgreSQL, Auth, RLS) · Vercel ·
GitHub Actions · SonarCloud.

**El repositorio es la fuente de verdad.** Nunca asumas que algo existe
porque lo mencione un prompt o un informe anterior: compruébalo.

---

## Antes de modificar

1. inspeccionar el estado real del repositorio
2. localizar el flujo afectado
3. identificar sus consumidores
4. localizar las pruebas existentes
5. identificar dependencias
6. confirmar el alcance
7. revisar las reglas de este archivo que apliquen

Leer solo los archivos necesarios. Ampliar contexto únicamente cuando
aparezca una dependencia real. No recorrer ni cargar el repositorio entero.

---

## Alcance

Modificar únicamente lo necesario para la tarea actual.

No aprovechar una tarea para refactorizar código no relacionado, resolver
deuda no solicitada, cambiar arquitectura, cambiar branding, cambiar reglas
de negocio, instalar dependencias, cambiar la base de datos ni agregar
funcionalidad no pedida.

Si aparece un problema fuera de alcance: **documentarlo con evidencia e
impacto y proponer una fase o tarea futura. No corregirlo por iniciativa
propia.**

### Trabajo incremental

Cambios pequeños, verificables, reversibles y fáciles de revisar. Evitar
cambios masivos cuando basta una modificación puntual. Una tarea debe poder
probarse y revisarse de forma aislada siempre que sea razonable.

---

## Reglas de negocio

**No modificar reglas de negocio sin autorización explícita.** Incluye:
inventario, existencias, precios, costos, ISV e impuestos, facturación,
cotizaciones, crédito, cuentas por cobrar, abonos, correlativos, permisos,
autenticación, ubicaciones, movimientos, traslados y Kardex.

Cuando una tarea autorizada cambie comportamiento:

1. identificar el contrato actual
2. identificar las pruebas existentes
3. implementar el nuevo contrato
4. agregar o actualizar las pruebas correspondientes

---

## Supabase y base de datos

Sin autorización explícita **no** crear ni ejecutar: migraciones,
`ALTER TABLE`, `DROP`, cambios destructivos, cambios de RLS, policies,
funciones SQL, RPC ni modificaciones de esquema.

Antes de un cambio de base autorizado: explicar el cambio, justificarlo,
identificar riesgos, definir el rollback y definir cómo se valida.

**Producción nunca es un entorno experimental.** Nunca borrar ni alterar
datos reales para facilitar una prueba sin autorización explícita.

---

## Datos reales

No inventar datos empresariales para que una pantalla parezca completa.
Dashboard, reportes y métricas usan los datos reales disponibles; si una
cifra todavía no puede calcularse bien, no se muestra.

Mocks, fixtures y datos artificiales se limitan al entorno de pruebas.

---

## Puerta de calidad

Todo cambio de código debe pasar, como mínimo:

```
npm test
npx eslint .
npm run build
```

Los tres deben terminar correctamente. **No declarar una implementación
terminada si alguno falla.**

Cuando la tarea llegue a PR o a main, validar además: GitHub Actions,
SonarCloud, Quality Gate, despliegue, producción y la regresión relacionada.

### Pruebas

Las pruebas son parte del contrato del sistema. **Prohibido**: borrar
pruebas para que pase el código, debilitar assertions correctas, usar
`.skip` para tapar fallos, dejar `.only` en lo entregado, ocultar errores o
cambiar expectativas válidas para acomodar un defecto.

- Corrección de un bug → agregar prueba de regresión cuando sea razonable.
- Cambio de comportamiento autorizado → actualizar o agregar las pruebas
  que definen el nuevo contrato.

### SonarCloud

Parte obligatoria de la puerta de calidad. Objetivo sobre **código nuevo**:

| Métrica | Objetivo |
|---|---|
| Quality Gate | PASSED |
| New Bugs | 0 |
| New Vulnerabilities | 0 |
| New Code Smells | 0 |
| New Security Hotspots | 0 |
| Duplication on New Code | ≤ 3 % |

No rebajar el Quality Gate, no agregar exclusiones para esconder problemas,
no desactivar el análisis y no manipular métricas. Si la tarea introduce un
problema nuevo, **se corrige antes de cerrar**.

### Duplicación

Evitar duplicación nueva. Antes de copiar lógica, buscar si ya existe un
helper, utility, hook, componente o regla compartida.

No crear abstracciones artificiales solo para mejorar una métrica: la
abstracción debe tener sentido funcional.

---

## Git

No desarrollar en `main`. Una rama específica por trabajo.

Antes de empezar, comprobar como mínimo `git status`,
`git branch --show-current` y `git fetch origin`.

Sin autorización explícita **no** usar `git reset --hard`, force push ni
reescritura de historial publicado.

No borrar ramas hasta comprobar que el trabajo está integrado y validado.

### Identidad — regla permanente

Los commits nuevos usan la identidad Git del propietario del repositorio.
Antes de crear commits, verificar `git config user.name` y
`git config user.email`. **No inventar nombre ni correo.**

**Prohibido añadir trailers de coautoría de IA**, incluidos
`Co-Authored-By: Claude`, `Co-Authored-By: Anthropic`,
`Co-Authored-By: Claude Code` y cualquier equivalente de otra herramienta o
agente.

No modificar historial ya publicado solo para cambiar autoría sin
autorización.

Esta regla se cumple en **todos** los commits futuros.

### Commits

Commits pequeños, coherentes y revisables. Conventional Commits:
`feat:` `fix:` `refactor:` `test:` `style:` `docs:` `chore:`.

No mezclar cambios independientes en un mismo commit cuando puedan
separarse lógicamente.

### Pull requests

Antes de considerar un PR listo: árbol de trabajo limpio, tests verdes,
lint verde, build verde, CI verde, SonarCloud verde y Quality Gate PASSED.

**No hacer merge salvo autorización explícita.** Si el prompt es de
implementación y no autoriza el cierre, **detenerse** tras presentar la
evidencia.

### Cierre y merge

Con autorización explícita para cerrar:

1. verificar rama y estado
2. verificar tests, lint y build
3. verificar el CI del PR
4. verificar SonarCloud del PR
5. verificar el Quality Gate
6. hacer únicamente el tipo de merge autorizado
7. sincronizar main
8. volver a ejecutar tests, lint y build **sobre main**
9. comprobar el CI **nuevo** correspondiente al hash de main
10. comprobar el análisis de SonarCloud **nuevo** correspondiente a ese hash
11. comprobar el despliegue
12. validar producción
13. comprobar la regresión
14. solo entonces eliminar la rama, si corresponde

**No reutilizar la evidencia del PR como si fuera evidencia posterior al
merge.**

---

## Producción

No afirmar que producción funciona solo porque el build o el deployment
terminaron.

Cuando corresponda, validar: rutas afectadas, funcionalidad principal,
regresión, consola, warnings nuevos, peticiones fallidas, CSP, responsive,
imágenes y recursos, y los datos reales sin modificarlos innecesariamente.

**No inventar evidencia de producción.**

---

## Seguridad

Nunca exponer tokens, contraseñas, secrets, claves service-role,
credenciales ni información sensible. No incluirlos en código, commits,
logs, documentación ni informes.

Respetar RLS y el principio de mínimo privilegio.

---

## Frontend

Preservar accesibilidad, responsive, contraste, semántica HTML, navegación
por teclado cuando corresponda y consistencia visual.

Evitar CSS global que contamine pantallas no relacionadas: preferir estilos
acotados.

### Branding aprobado

Dirección visual vigente: área principal clara, sidebar oscuro, el dorado
oficial de LUNACELL como acento del sidebar y el logo dorado
**LUNACELL & ASOCS.** en el sidebar.

**No convertir toda la aplicación a negro y dorado.** El branding se
implementa solo cuando una tarea lo autorice.

---

## Inventario y volumen mayorista

LUNACELL opera tienda y bodega mayorista. Las cantidades grandes **no** se
convierten en una fila por unidad.

Para productos no serializados, un movimiento se representa con: producto,
cantidad, ubicación, transacción, fecha y usuario. Vender 100 unidades del
mismo cargador es **una línea con cantidad 100**, no 100 filas.

Los productos serializados o con IMEI podrán requerir otro modelo cuando esa
necesidad se defina.

---

## Deuda técnica

**Detectar deuda no autoriza corregirla.** Registrar el problema, su
evidencia, su impacto y el destino recomendado.

No mezclar deuda técnica con una funcionalidad no relacionada.

---

## Dependencias

No instalar, actualizar ni eliminar paquetes sin necesidad demostrable.

Antes de agregar una dependencia: comprobar si las herramientas existentes
resuelven el problema, justificarla, evaluar su impacto y pedir
autorización si queda fuera del alcance.

---

## Contexto y tokens

Política de contexto mínimo suficiente. No cargar archivos innecesarios, no
repetir lo que ya dice este archivo, no releer el repositorio entero en cada
tarea y no producir informes enormes cuando basta evidencia compacta.

| Dónde | Qué |
|---|---|
| `CLAUDE.md` | reglas permanentes |
| skills | procedimientos repetibles |
| prompt | el objetivo concreto de la tarea |

---

## Herramientas y agentes

**Que una herramienta termine sin error no demuestra que el resultado sea
correcto.** Después de modificar: revisar el diff, ejecutar las pruebas,
verificar el resultado, corregir lo que falle y volver a validar.

No confiar ciegamente en salida generada por IA.

---

## Informe final de tarea

Compacto. Como mínimo: qué cambió, archivos afectados, pruebas agregadas o
modificadas, resultado de tests, lint y build, CI y SonarCloud cuando
apliquen, riesgos o deuda encontrada, y estado de Git.

No repetir cientos de líneas de evidencia cuando un resumen verificable
basta.

---

## Principio operativo

> **COMPRENDER → CAMBIAR LO MÍNIMO → PROBAR → VERIFICAR → INFORMAR → DETENERSE**

La velocidad nunca justifica sacrificar integridad de datos, seguridad,
calidad ni estabilidad.
