import { beforeEach } from "vitest"

import "@testing-library/jest-dom/vitest"

/*
  jsdom no implementa matchMedia, y sin él cualquier componente que consulte
  una media query revienta al montarse. La portada lo usa para respetar
  "prefers-reduced-motion", que es justo lo que no se puede quitar del
  código para poder probarlo.

  El doble responde que no coincide ninguna consulta: es el caso por
  omisión de un navegador sin preferencias especiales. Una prueba que
  necesite lo contrario puede sobrescribirlo.
*/
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

/*
  La sesión de Supabase vive en el almacenamiento del navegador, y algunas
  pantallas dejan ahí preferencias sueltas. Cada prueba arranca con el
  almacenamiento limpio para que no se contaminen entre sí.
*/
beforeEach(() => {
  localStorage.clear()
})
