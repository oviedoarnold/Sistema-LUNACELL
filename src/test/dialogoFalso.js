import { vi } from "vitest"

/*
  Reemplaza a SweetAlert2 durante las pruebas.

  El diálogo real monta nodos en el body y guarda estado global entre
  llamadas. Cuando una prueba termina mientras un diálogo sigue animándose
  y la siguiente abre otro, la librería revienta con
  "swalPromiseResolve is not a function". Eso hacía fallar la suite en
  integración continua de forma intermitente, y nunca en local: depende de
  cuánto tarde la animación frente a lo que tarde el desmontaje.

  Ninguna prueba comprueba el contenido de un diálogo, así que no se pierde
  cobertura al cambiarlo por un doble.

  La respuesta por omisión es "descartado" y no "confirmado" a propósito:
  es lo que ya ocurría: sin nadie que pulse el botón, los flujos que
  esperan una confirmación no seguían adelante. Una prueba que quiera
  confirmar puede hacerlo con
  Swal.fire.mockResolvedValueOnce({ isConfirmed: true }).
*/

const DESCARTADO = {
  isConfirmed: false,
  isDenied: false,
  isDismissed: true,
  value: undefined,
}

const Swal = {
  fire: vi.fn(() => Promise.resolve({ ...DESCARTADO })),
  close: vi.fn(),
  isVisible: vi.fn(() => false),
  showLoading: vi.fn(),
  hideLoading: vi.fn(),
  getPopup: vi.fn(() => null),
  mixin: vi.fn(() => Swal),
}

export default Swal
