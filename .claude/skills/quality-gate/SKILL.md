---
name: quality-gate
description: Ejecuta y verifica la puerta de calidad de LUNACELL. Úsala al terminar una implementación, antes de dar un PR por listo, después de un merge autorizado y al validar producción. Cubre diff y alcance, npm test, eslint, build, CI de GitHub Actions, SonarCloud, Quality Gate, métricas de código nuevo y comprobación en producción. Verifica; no decide, no mergea, no despliega.
---

# Puerta de calidad

Procedimiento. Las **reglas** viven en `CLAUDE.md` (secciones «Puerta de
calidad», «Git», «Producción»): no se repiten aquí. Si algo de este archivo
pareciera contradecirlo, manda `CLAUDE.md`.

## Qué hace y qué no

Comprueba y reporta. **No** autoriza el merge, **no** mergea, **no** borra
ramas, **no** despliega, **no** toca producción y **no** sustituye la
revisión humana.

Ante un gate obligatorio en rojo: **detenerse y reportar**. No corregir nada
fuera del alcance de la tarea, no tocar pruebas para conseguir verde, no
rebajar el Quality Gate y no añadir exclusiones.

## Elegir el nivel

Ejecutar **solo** el nivel que corresponda al momento del flujo. Cada nivel
supone el anterior ya verde.

| Momento | Nivel |
|---|---|
| Terminé de implementar | **L** |
| El PR debe darse por listo | **L + P** |
| Hay autorización explícita para cerrar y ya se mergeó | **L + P + M** |
| El cierre incluye despliegue | **L + P + M + D** |

Una implementación **sin autorización de merge se queda en L**. Exigir
producción ahí es ruido: no hay nada desplegado que comprobar.

---

## L · Local

```bash
git status --short
git diff --check
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

1. **Alcance** — los archivos del diff son los que la tarea justifica. Si
   aparece algo más, parar y explicarlo antes de seguir.
2. `git diff --check` sin salida.
3. Los tres comandos, capturando su código de salida:

```bash
npm test -- --run; echo "tests=$?"
npx eslint .;      echo "lint=$?"
npm run build;     echo "build=$?"
```

Los tres deben dar `0`. **Un pipe que se traga el código de salida no sirve
como evidencia.**

4. Comparar el número de pruebas con el de partida. Si bajó sin que la tarea
   lo explique, parar: puede haber una prueba borrada o saltada.

### Duplicación (cuando la tarea añade código)

```bash
npx jscpd@5.3.0 src --min-lines 10 --min-tokens 100 --reporters console --silent
```

Versión fijada a propósito: entre versiones cambia el recuento y las
comparaciones dejan de serlo. Lo que importa no es el porcentaje sino si
aparecen **clones nuevos**; medir la rama y `main` con el mismo comando.

---

## P · Pull request

Los tres checks sobre el **SHA de HEAD de la rama**, no sobre otro:

```bash
SHA=$(git rev-parse HEAD)
gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" \
  --jq '.check_runs[] | "\(.status) \(.conclusion) \(.name)"'
```

Esperado: `Lint, tests y build` y `SonarCloud Code Analysis` en
`completed success`.

`skipped`, `not run`, `queued` o ausente **no es verde**: es «todavía no se
sabe». Esperar.

SonarCloud, sustituyendo `<PR>`:

```bash
curl -s "https://sonarcloud.io/api/qualitygates/project_status?projectKey=oviedoarnold_Sistema-LUNACELL&pullRequest=<PR>"
curl -s "https://sonarcloud.io/api/measures/component?component=oviedoarnold_Sistema-LUNACELL&pullRequest=<PR>&metricKeys=new_bugs,new_vulnerabilities,new_code_smells,new_security_hotspots,new_duplicated_lines_density,new_lines"
curl -s "https://sonarcloud.io/api/issues/search?componentKeys=oviedoarnold_Sistema-LUNACELL&pullRequest=<PR>&resolved=false"
```

Los objetivos de código nuevo están en `CLAUDE.md`. Si aparece un hallazgo:
**analizarlo antes que descartarlo.** Suele ser real. Se corrige y se vuelve
a analizar; no se silencia.

Comprobar además que la rama **no** rebajó el gate ni añadió exclusiones:

```bash
git diff main...HEAD -- sonar-project.properties .github/workflows/
```

Cualquier cambio ahí tiene que estar explicado por la tarea.

---

## M · Post-merge

La evidencia del PR **no** vale aquí: se genera otra.

```bash
git checkout main && git pull --ff-only origin main
git rev-parse HEAD          # este hash es el que hay que verificar
```

1. Repetir los tres comandos de **L** sobre `main`.
2. El CI **nuevo** del hash de `main` — que el workflow corresponda a ese
   hash, no al del PR.
3. El análisis **nuevo** de SonarCloud, comprobando la revisión:

```bash
curl -s "https://sonarcloud.io/api/project_analyses/search?project=oviedoarnold_Sistema-LUNACELL&branch=main&ps=3"
```

El `revision` del análisis más reciente debe ser el hash de `main`. Si no lo
es, el análisis todavía no llegó: esperar, no dar por bueno el anterior.

4. Quality Gate de `main` (`&branch=main` en lugar de `&pullRequest=`).

---

## D · Producción

Solo si el cierre incluye despliegue.

1. **Que el despliegue exista y sea el del hash nuevo.** Que el build o el
   deployment terminaran no demuestra que producción los sirva.
2. **Comparar el bundle**: los hashes de `dist/assets/index-*.{js,css}` del
   build local deben coincidir con los que sirve el dominio. Es la prueba de
   que producción tiene este código y no el anterior.
3. En un navegador real, sobre las rutas que la tarea tocó y las que podría
   haber roto: funcionalidad principal, regresión, consola sin errores ni
   warnings nuevos, sin peticiones fallidas, sin violaciones de CSP, y
   responsive y recursos cuando apliquen.
4. **Mirar las capturas.** Un selector que cuenta elementos no ve que algo
   quedó ilegible, deformado o pegado.
5. No alterar datos reales para probar. Si una comprobación los exige,
   pedirlo antes y dejar escrito qué se cambió.

---

## Evidencia

Compacta y verificable. Por cada nivel ejecutado: qué se comprobó, el
resultado y el dato que lo respalda —código de salida, número de pruebas,
hash, conclusión del check—.

No volcar la salida completa de los comandos. No inventar evidencia: lo que
no se comprobó se dice.

Al terminar, decir explícitamente **qué nivel se ejecutó** y cuál no, y por
qué.
