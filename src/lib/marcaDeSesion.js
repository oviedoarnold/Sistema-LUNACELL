/*
  Deja una marca en las cookies mientras haya sesión abierta.

  La sesión de Supabase vive en el almacenamiento del navegador, que el
  servidor no puede leer. Sin esta marca, pedir /dashboard sin haber
  entrado devuelve el armazón de la aplicación y es el JavaScript, ya en la
  máquina del usuario, quien decide mandarlo al login.

  Con la marca, el redirección ocurre antes: en el borde, sin llegar a
  servir nada.

  Importante de entender qué es y qué no es esto. La marca no lleva el
  token ni prueba nada: cualquiera puede escribirla a mano en su navegador.
  Lo único que consigue quien lo haga es que le sirvan el mismo armazón
  vacío de antes, porque los datos siguen protegidos donde corresponde, en
  las políticas de la base. Es una mejora de comportamiento, no una barrera
  de seguridad, y conviene no confundirlas.
*/

const NOMBRE = "ferreteria-sesion"

const hayNavegador = () => typeof document !== "undefined"

export function marcarSesionAbierta() {
  if (!hayNavegador()) return

  const seguro = location.protocol === "https:" ? "; Secure" : ""

  document.cookie = `${NOMBRE}=1; Path=/; SameSite=Lax; Max-Age=604800${seguro}`
}

export function borrarMarcaDeSesion() {
  if (!hayNavegador()) return

  document.cookie = `${NOMBRE}=; Path=/; SameSite=Lax; Max-Age=0`
}

export function hayMarcaDeSesion() {
  if (!hayNavegador()) return false

  return document.cookie
    .split(";")
    .some((trozo) => trozo.trim().startsWith(`${NOMBRE}=1`))
}
