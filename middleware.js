/*
  Manda al login a quien pide una pantalla privada sin haber entrado.

  Antes, /dashboard respondía 200 con el armazón de la aplicación y era el
  JavaScript, ya descargado y corriendo, quien decidía redirigir. El
  armazón no lleva ningún dato del negocio, así que no se filtraba nada,
  pero servir una pantalla privada a quien no tiene sesión es una respuesta
  equivocada aunque venga vacía.

  Lo que de verdad protege los datos son las políticas de la base: sin
  sesión, Supabase no devuelve una sola fila de ninguna tabla. Esta capa no
  reemplaza eso ni lo pretende; la marca que lee ni siquiera contiene el
  token, y cualquiera puede escribirla a mano. Lo único que gana quien lo
  haga es que le sirvan el mismo armazón vacío.
*/

export const config = {
  matcher: [
    "/dashboard",
    "/pos",
    "/products",
    "/clients",
    "/suppliers",
    "/sales-history",
    "/quotes",
    "/settings",
  ],
}

const MARCA = "ferreteria-sesion"

function tieneMarcaDeSesion(peticion) {
  const cookies = peticion.headers.get("cookie") || ""

  return cookies
    .split(";")
    .some((trozo) => trozo.trim().startsWith(`${MARCA}=1`))
}

export default function middleware(peticion) {
  if (tieneMarcaDeSesion(peticion)) {
    return
  }

  const destino = new URL("/login", peticion.url)

  // 307 y no 302: el navegador no debe cachear la redirección, porque en
  // cuanto la persona entre, esa misma dirección sí tiene que servirse.
  return Response.redirect(destino, 307)
}
