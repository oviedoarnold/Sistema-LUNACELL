/*
  Agrega guardas a las migraciones para que volver a correrlas no falle ni
  duplique nada.

  Las migraciones se corren a mano en el SQL Editor de Supabase, así que
  repetir una por error —o no acordarse de cuál ya se aplicó— es un
  escenario cotidiano, no hipotético.

  Se ejecuta una sola vez sobre los archivos existentes; las migraciones
  nuevas ya deberían nacer con sus guardas.
*/
import fs from "node:fs"

const politicasDe = (sql) =>
  [...sql.matchAll(/^create policy (\w+) on ([\w.]+)/gm)].map((m) => ({
    politica: m[1],
    tabla: m[2],
  }))

function conGuardas(sql) {
  let s = sql

  s = s.replace(/^create table (?!if not exists)/gm, "create table if not exists ")
  s = s.replace(/^create index (?!if not exists)/gm, "create index if not exists ")
  s = s.replace(
    /^create unique index (?!if not exists)/gm,
    "create unique index if not exists "
  )
  s = s.replace(/^create view /gm, "create or replace view ")
  s = s.replace(/^create function /gm, "create or replace function ")
  s = s.replace(
    /^alter table (\w+) add column (?!if not exists)/gm,
    "alter table $1 add column if not exists "
  )

  /*
    Ni los triggers ni las políticas admiten "if not exists" en PostgreSQL,
    así que la única forma de repetirlos sin error es borrarlos antes.
  */
  s = s.replace(
    /^create trigger (\w+)([\s\S]*?)on ([\w.]+)/gm,
    (_todo, nombre, medio, tabla) =>
      "drop trigger if exists " +
      nombre +
      " on " +
      tabla +
      ";\n\ncreate trigger " +
      nombre +
      medio +
      "on " +
      tabla
  )

  for (const { politica, tabla } of politicasDe(s)) {
    s = s.replace(
      new RegExp("^create policy " + politica + " on " + tabla, "m"),
      "drop policy if exists " +
        politica +
        " on " +
        tabla +
        ";\ncreate policy " +
        politica +
        " on " +
        tabla
    )
  }

  return s
}

const nombreDe = (ruta) => ruta.split(/[/\\]/).pop()

for (const ruta of process.argv.slice(2)) {
  const antes = fs.readFileSync(ruta, "utf8")
  const despues = conGuardas(antes)

  if (antes === despues) {
    console.log("  sin cambios  " + nombreDe(ruta))
    continue
  }

  fs.writeFileSync(ruta, despues)
  console.log("  con guardas  " + nombreDe(ruta))
}
