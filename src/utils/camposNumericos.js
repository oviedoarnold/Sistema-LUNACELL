/*
  Propiedades para los campos `type="number"` de importes y cantidades.

  - `inputMode` abre en el teléfono el teclado numérico (con punto decimal
    para importes, sin él para cantidades).
  - En la computadora, girar la rueda del ratón sobre un campo numérico con
    el foco cambia su valor sin que nadie lo note. Al girarla, el campo
    pierde el foco: la página se desplaza como se esperaba y el número queda
    como estaba.

  No cambian el tipo, el paso, el mínimo ni cómo se lee el valor.
*/
export const sinCambioConLaRueda = (evento) => evento.currentTarget.blur()

export const CAMPO_DE_IMPORTE = { inputMode: "decimal", onWheel: sinCambioConLaRueda }

export const CAMPO_DE_CANTIDAD = { inputMode: "numeric", onWheel: sinCambioConLaRueda }
