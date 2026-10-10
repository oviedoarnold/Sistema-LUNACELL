// Edge Function `acceso` (USR-1): entrada en Deno.
//
// Solo enruta: crea los clientes de Supabase, lee el token y el cuerpo, y
// delega en logica.js, que es lo que se prueba. La clave de servicio existe
// únicamente aquí, en el servidor; nunca llega al navegador.
//
// Se despliega con verify_jwt = false: la aplicación usa una clave
// publicable (no es un JWT) e `iniciar` es pública. Las acciones de
// administrador y `cambiar` comprueban la sesión ellas mismas.

import { createClient } from "npm:@supabase/supabase-js@2"

import { crearAcceso } from "./logica.js"

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!
const CLAVE_SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const CLAVE_PUBLICA = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!

const ORIGENES = (Deno.env.get("ORIGENES_PERMITIDOS") ?? "https://lunacell.oviedoarnold.lat")
  .split(",")
  .map((o) => o.trim())

const SIN_SESION = { auth: { persistSession: false, autoRefreshToken: false } }

const servicio = createClient(URL_SUPABASE, CLAVE_SERVICIO, SIN_SESION)

const manejar = crearAcceso({
  rpc: (nombre: string, argumentos: Record<string, unknown>) => servicio.rpc(nombre, argumentos),
  auth: {
    usuarioDelToken: async (token: string) => (await servicio.auth.getUser(token)).data.user ?? null,
    // Un cliente nuevo por intento: la sesión de un empleado no se mezcla con la de otro.
    iniciar: (email: string, password: string) =>
      createClient(URL_SUPABASE, CLAVE_PUBLICA, SIN_SESION).auth.signInWithPassword({ email, password }),
    crearUsuario: (email: string, password: string) =>
      servicio.auth.admin.createUser({ email, password, email_confirm: true }),
    borrarUsuario: (id: string) => servicio.auth.admin.deleteUser(id),
    cambiarContrasena: (id: string, password: string) => servicio.auth.admin.updateUserById(id, { password }),
    // Cierra solo esa sesión: la que se abrió para comprobar y no se entrega.
    cerrarSesion: (accessToken: string) => servicio.auth.admin.signOut(accessToken, "local"),
  },
})

function cabeceras(origen: string | null) {
  return {
    "Access-Control-Allow-Origin": origen && ORIGENES.includes(origen) ? origen : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  }
}

Deno.serve(async (solicitud) => {
  const encabezados = cabeceras(solicitud.headers.get("origin"))

  if (solicitud.method === "OPTIONS") return new Response(null, { status: 204, headers: encabezados })
  if (solicitud.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido." }), { status: 405, headers: encabezados })
  }

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = await solicitud.json()
  } catch {
    return new Response(JSON.stringify({ error: "Solicitud inválida." }), { status: 400, headers: encabezados })
  }

  const token = (solicitud.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || null
  const { accion, ...resto } = cuerpo

  try {
    const { estado, cuerpo: respuesta } = await manejar({ accion: String(accion ?? ""), token, cuerpo: resto })
    return new Response(JSON.stringify(respuesta), { status: estado, headers: encabezados })
  } catch {
    // Sin detalles: podrían traer datos internos. La contraseña nunca se registra.
    return new Response(JSON.stringify({ error: "No se pudo completar la operación." }), { status: 500, headers: encabezados })
  }
})
