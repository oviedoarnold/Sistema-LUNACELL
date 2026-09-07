import { beforeEach } from "vitest"

import "@testing-library/jest-dom/vitest"

/*
  El sistema guarda todo en localStorage.
  Cada test arranca con el almacenamiento
  limpio para que no se contaminen entre sí.
*/
beforeEach(() => {
  localStorage.clear()
})
