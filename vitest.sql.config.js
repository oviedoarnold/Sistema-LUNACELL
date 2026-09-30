import { defineConfig } from "vitest/config"

/*
  Configuración aparte para las pruebas contra PostgreSQL de verdad.

  Van separadas de `npm test` a propósito. La suite normal corre en jsdom,
  no toca la red ni el disco y tarda medio minuto; estas levantan un motor
  de base de datos, así que mezclarlas volvería lenta y frágil la suite que
  se corre a cada rato. Se lanzan con `npm run test:sql`.
*/
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["pruebas-sql/**/*.test.mjs"],

    /*
      initdb, arrancar el motor y aplicar diez migraciones no entra en los
      cinco segundos que Vitest da por omisión.
    */
    testTimeout: 60000,
    hookTimeout: 180000,

    /*
      Un archivo cada vez. Cada uno levanta su propio postmaster, y
      dejarlos arrancar a la vez sirve para pelearse por puertos y por
      memoria sin ganar nada: son pruebas de una función, no una suite
      ancha.
    */
    fileParallelism: false,
    pool: "forks",
    singleFork: true,
  },
})
