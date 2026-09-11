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
  1.3:1 y desaparecen. Por eso la cabecera y el pie de la portada, que van
  sobre oscuro, usan el símbolo —cuya media luna dorada sí se lee, a
  6.2:1— acompañado del nombre en texto.

  Para poner el logo entero sobre fondo oscuro haría falta una variante
  con el teléfono y el subtítulo en claro, que es material del diseñador y
  no algo que deba inventarse aquí.
*/

const ARCHIVOS = {
  completo: "/brand/lunacell-logo-transparent.png",
  simbolo: "/brand/lunacell-simbolo.png",
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
