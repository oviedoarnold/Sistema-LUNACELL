/*
  Escribe en el resumen del run qué pruebas fallaron y por qué.

  Sin esto, averiguarlo exige descargar los logs de GitHub Actions, y para
  eso hacen falta permisos de administrador del repositorio. El resumen, en
  cambio, lo ve cualquiera que pueda ver el run.

  Existe por una intermitencia concreta: la misma suite pasaba en una
  corrida y fallaba en la siguiente, siempre en verde en local, y sin poder
  leer los logs no había forma de saber cuál prueba se caía.
*/
import fs from "node:fs"

const REPORTE = "test-report.json"

if (!fs.existsSync(REPORTE)) {
  console.log("## Pruebas\n")
  console.log(
    "No se generó `test-report.json`. El paso falló antes de que las " +
      "pruebas llegaran a correr; el error está en el log del paso anterior."
  )

  process.exit(0)
}

const reporte = JSON.parse(fs.readFileSync(REPORTE, "utf8"))

// El reporte trae barras normales; en Windows cwd las trae invertidas.
const conBarrasNormales = (ruta) => String(ruta || "").split("\\").join("/")

const raiz = conBarrasNormales(process.cwd())

const rutaCorta = (ruta) =>
  conBarrasNormales(ruta).replace(raiz, "").replace(/^\//, "")

const fallidas = (reporte.testResults || []).flatMap((archivo) =>
  (archivo.assertionResults || [])
    .filter((prueba) => prueba.status === "failed")
    .map((prueba) => ({
      archivo: rutaCorta(archivo.name),
      nombre: [...(prueba.ancestorTitles || []), prueba.title].join(" › "),
      mensajes: prueba.failureMessages || [],
    }))
)

console.log("## Pruebas que fallaron\n")

if (fallidas.length === 0) {
  console.log(
    "Ninguna prueba figura como fallida. Si el paso quedó en rojo, el fallo " +
      "fue del proceso y no de una aserción: revisá el final del log."
  )

  process.exit(0)
}

console.log(`**${fallidas.length}** de ${reporte.numTotalTests} pruebas.\n`)

for (const prueba of fallidas) {
  console.log(`### ${prueba.nombre}`)
  console.log(`\n\`${prueba.archivo}\`\n`)
  console.log("```")
  console.log(prueba.mensajes.join("\n").split("\n").slice(0, 25).join("\n"))
  console.log("```\n")
}
