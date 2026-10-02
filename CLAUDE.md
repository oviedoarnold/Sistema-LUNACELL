# CLAUDE.md — contrato mínimo de trabajo

Reglas permanentes para Claude y otros agentes. Mantener este archivo corto:
no guardar aquí historial, estado de fases, PR, resultados de CI ni informes.

## Proyecto

LUNACELL es un sistema empresarial real en producción.
Stack: React + Vite + Supabase (PostgreSQL/Auth/RLS) + Vercel + GitHub Actions + SonarCloud.

Prioridad: integridad de datos > seguridad > estabilidad > mantenibilidad > trazabilidad > calidad > UX.
El repositorio es la fuente de verdad: comprobar antes de asumir.

## Contexto mínimo

- Leer solo archivos necesarios para la tarea; ampliar contexto solo por una dependencia real.
- No recorrer ni cargar el repositorio completo por defecto.
- No repetir en prompts reglas ya contenidas aquí.
- Consultar Git/GitHub para historial cuando sea necesario; no cargar historial preventivamente.
- Procedimientos repetibles deben vivir en skills/documentación específica y consultarse solo cuando apliquen.
- Estado temporal de una fase o PR no pertenece a este archivo.
- Informes finales: breves y con evidencia suficiente, no transcripciones extensas.

## Alcance

Modificar únicamente lo necesario para la tarea actual. No refactorizar, cambiar arquitectura/branding/reglas de negocio, instalar dependencias ni resolver deuda ajena al alcance.
Si aparece deuda fuera de alcance: documentar evidencia, impacto y tarea futura; no corregirla sin autorización.
Cambios pequeños, verificables y reversibles.

## Reglas de negocio y datos

No modificar sin autorización explícita reglas de inventario, precios/costos/impuestos, facturación, cotizaciones, crédito/CxC/abonos, correlativos, permisos, autenticación, ubicaciones, movimientos, traslados o Kardex.
No inventar datos empresariales. Mocks/fixtures solo en pruebas.

## Supabase / producción

Sin autorización explícita no crear ni ejecutar migraciones, cambios de esquema, RLS/policies, funciones SQL/RPC ni operaciones destructivas.
Antes de un cambio autorizado: explicar cambio, riesgo, rollback y validación.
Nunca usar producción como entorno experimental ni alterar datos reales para facilitar pruebas.
Nunca exponer secrets, tokens, contraseñas o service-role keys. Respetar RLS y mínimo privilegio.

## Calidad

Todo cambio de código debe pasar:

```bash
npm test
npx eslint .
npm run build
```

No declarar terminado si alguno falla. No borrar/debilitar pruebas, usar `.skip` para ocultar fallos ni dejar `.only`.
Bug corregido => prueba de regresión cuando sea razonable.

En PR/main verificar cuando aplique: GitHub Actions + SonarCloud + Quality Gate + despliegue/regresión.
Objetivo de código nuevo: Quality Gate PASSED; 0 bugs/vulnerabilities/code smells/security hotspots; duplicación <= 3%.
No manipular exclusiones o métricas para pasar el gate.

## Git

No desarrollar en `main`; usar rama específica. Antes de modificar comprobar estado/rama y sincronización remota.
No `reset --hard`, force push ni reescritura de historial publicado sin autorización.
Commits pequeños con Conventional Commits.
Verificar identidad Git real antes de commitear; no inventarla y no añadir trailers de coautoría de IA.
No hacer merge sin autorización explícita.
La evidencia posterior al merge debe corresponder al nuevo hash de `main`; no reutilizar la del PR.

## Frontend

Preservar accesibilidad, responsive, semántica, navegación por teclado y consistencia visual.
Evitar CSS global innecesario.
Branding vigente: área principal clara, sidebar oscuro y dorado LUNACELL como acento; no convertir toda la aplicación a negro/dorado sin tarea autorizada.

## Inventario

Para productos no serializados, cantidades grandes se representan por cantidad, no una fila por unidad. Serializados/IMEI requieren modelo específico cuando se defina.

## Dependencias

No instalar/actualizar/eliminar paquetes sin necesidad demostrable y dentro del alcance.

## Cierre

Después de modificar: revisar diff, ejecutar validaciones aplicables y verificar el resultado real.
Informe final compacto: qué cambió, archivos, pruebas/validaciones, riesgos/deuda y estado Git.

**COMPRENDER -> CAMBIAR LO MÍNIMO -> PROBAR -> VERIFICAR -> INFORMAR -> DETENERSE**
