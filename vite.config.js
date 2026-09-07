import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { defineConfig, build as construir } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const CARPETA_TEMPORAL = 'dist-prerender'

/*
  Escribe dist/login.html con el formulario de acceso ya dibujado dentro.

  Sin esto, /login llega al navegador como un div vacío que solo se llena
  cuando termina de cargar y ejecutarse el JavaScript. El formulario se
  genera desde el mismo componente que usa la aplicación, así que no puede
  quedar desactualizado respecto a lo que el usuario ve.
*/
function prerenderizarLogin() {
  let esCompilacionDeServidor = false

  return {
    name: 'prerenderizar-login',
    apply: 'build',

    configResolved(configuracion) {
      esCompilacionDeServidor = Boolean(configuracion.build.ssr)
    },

    async closeBundle() {
      // La compilación de servidor la lanza este mismo plugin: sin esta
      // guarda se llamaría a sí misma sin fin.
      if (esCompilacionDeServidor) return

      await construir({
        configFile: false,
        logLevel: 'warn',
        plugins: [react()],
        build: {
          ssr: 'src/prerender/login.jsx',
          outDir: CARPETA_TEMPORAL,
          emptyOutDir: true,
        },
      })

      const modulo = await import(
        pathToFileURL(`${process.cwd()}/${CARPETA_TEMPORAL}/login.js`).href
      )

      const plantilla = readFileSync('dist/index.html', 'utf8')

      const conFormulario = plantilla.replace(
        '<div id="root"></div>',
        `<div id="root">${modulo.renderizarLogin()}</div>`
      )

      writeFileSync('dist/login.html', conFormulario)

      rmSync(CARPETA_TEMPORAL, { recursive: true, force: true })
    },
  }
}

/*
  Escribe en dist/sw.js la lista de archivos que produjo la compilación.

  Sus nombres llevan el hash del contenido, así que el service worker no
  puede conocerlos de antemano. Sin esta lista guardaba el HTML pero no el
  JavaScript que lo hace funcionar: una instalación nueva abierta sin
  conexión mostraba una pantalla en blanco, y solo servía si el usuario ya
  había entrado antes con red y el navegador había cacheado los archivos
  por su cuenta.
*/
function precargarArchivosDelBuild() {
  return {
    name: 'precargar-archivos-del-build',
    apply: 'build',

    writeBundle(opciones, paquete) {
      // Solo la compilación del cliente escribe en dist/.
      if (opciones.dir && !opciones.dir.endsWith('dist')) return

      const rutas = Object.keys(paquete)
        .filter((archivo) => /\.(js|css|woff2?)$/.test(archivo))
        .map((archivo) => '/' + archivo)
        .sort()

      const sw = readFileSync('dist/sw.js', 'utf8')

      writeFileSync(
        'dist/sw.js',
        sw.replace(
          'const ARCHIVOS_DEL_BUILD = []',
          'const ARCHIVOS_DEL_BUILD = ' + JSON.stringify(rutas, null, 2)
        )
      )
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    prerenderizarLogin(),
    precargarArchivosDelBuild(),
  ],

  build: {
    /*
      Sin esto el minificador reescribe las media queries a la sintaxis de
      rango: @media(max-width:720px) sale publicado como (width<=620px).
      Safari anterior a 16.4 y Chrome anterior a 104 no la entienden, y en
      esos navegadores el diseño responsive se pierde por completo. En una
      caja de ferretería es perfectamente posible encontrarse una máquina
      así.
    */
    cssTarget: ['chrome87', 'safari14', 'firefox78', 'edge88'],
  },

  test: {
    environment: 'jsdom',

    /*
      SweetAlert2 monta nodos en el body y guarda estado global entre
      llamadas; si una prueba termina con un diálogo animándose y la
      siguiente abre otro, la librería revienta. Se sustituye por un doble.
    */
    alias: {
      sweetalert2: fileURLToPath(
        new URL('./src/test/dialogoFalso.js', import.meta.url)
      ),
    },

    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],

    coverage: {
      provider: 'v8',
      // json-summary genera coverage/coverage-summary.json, que el proyecto versiona.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/main.jsx',
        'src/prerender/**',
        'src/test/**',
        'src/**/*.{test,spec}.{js,jsx}',
        // Plantillas de impresión: son marcado, se validan mirando el PDF.
        'src/components/InvoiceTemplate.jsx',
        'src/components/QuoteTemplate.jsx',
        // Generación de PDF con jsPDF y html2canvas: probarlo en jsdom
        // no verificaría el archivo que realmente se produce.
        'src/utils/documentUtils.js',
      ],
    },
  },
})
