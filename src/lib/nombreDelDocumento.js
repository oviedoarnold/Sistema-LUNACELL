/*
  Cómo se llama un documento de venta cuando hay que nombrarlo fuera del
  propio documento: el título de la ventana, el del trabajo de impresión y
  el nombre del archivo PDF.

  Vive aquí y no dentro de la pantalla porque lo usan tres sitios y porque
  tiene que mirar exactamente la misma propiedad que la cabecera de la
  plantilla —`fiscal`— para que no puedan contradecirse: una cabecera que
  dice «DOCUMENTO INTERNO» dentro de un archivo llamado
  «Factura-VTA-000009.pdf» deja al lector sin saber a cuál creer.
*/
export const nombreDelDocumento = (venta) =>
  venta?.fiscal ? "Factura" : "Documento"
