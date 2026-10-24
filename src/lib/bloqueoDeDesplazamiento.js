/*
  Que el fondo no se desplace mientras hay algo encima: el cajón del menú o
  una ventana modal. Pueden coincidir, así que se cuentan: el fondo vuelve a
  desplazarse al liberarse el último bloqueo, no el primero.

  La clase la define shell.css (body.sin-desplazamiento).
*/
let activos = 0

export function bloquearDesplazamiento() {
  activos += 1
  document.body.classList.add("sin-desplazamiento")

  let liberado = false

  return () => {
    if (liberado) return
    liberado = true
    activos = Math.max(0, activos - 1)
    if (activos === 0) document.body.classList.remove("sin-desplazamiento")
  }
}
