/*
  El logo oficial de LunaCell & Asociados.

  Vive en un componente y no suelto en cada pantalla para que el texto
  alternativo sea el mismo en todas partes y para que el día que llegue una
  versión nueva del logo solo haya que cambiar una ruta.

  Hay dos piezas del mismo archivo original:

    completo   media luna, teléfono, "LunaCell" y "& ASOCIADOS"
    simbolo    solo la media luna con el teléfono

  El completo solo funciona sobre fondo claro. El teléfono y el subtítulo
  son gris oscuro casi negro: sobre el carbón de la navegación quedan en
  1.3:1 y desaparecen. Por eso la portada usa el símbolo —cuya media luna
  dorada sí se lee, a 6.2:1— acompañado del nombre en texto.

  El emblema resuelve ese caso: es la versión dorada sobre negro que
  faltaba, con el nombre y el lema ya dentro. Se le quitaron las esquinas
  —lo que queda fuera del aro— para que el disco se apoye en cualquier
  fondo oscuro sin arrastrar un cuadro negro.

  Pide sitio: por debajo de unos 88px su texto deja de leerse y se
  convierte en manchas. Donde no quepa, el símbolo con el nombre aparte
  sigue siendo la forma correcta.
*/

const ARCHIVOS = {
  completo: "/brand/lunacell-logo-transparent.png",
  simbolo: "/brand/lunacell-simbolo.png",
  emblema: "/brand/lunacell-emblema.png",
}

function LogoLunacell({ variante = "completo", alto, className = "" }) {
  return (
    <img
      src={ARCHIVOS[variante] || ARCHIVOS.completo}
      alt="LunaCell & Asociados"
      className={className ? `logo-lunacell ${className}` : "logo-lunacell"}
      style={alto ? { height: alto } : undefined}
      loading="eager"
      decoding="async"
    />
  )
}

export default LogoLunacell
