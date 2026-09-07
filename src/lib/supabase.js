import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const clavePublicable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const hayConexionConfigurada = Boolean(url && clavePublicable)

/*
  Si falta la configuración se devuelve null en vez de lanzar: durante la
  migración la aplicación todavía puede funcionar contra el almacenamiento
  del navegador, y una excepción aquí dejaría la pantalla en blanco.
*/
export const supabase = hayConexionConfigurada
  ? createClient(url, clavePublicable, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export function exigirSupabase() {
  if (!supabase) {
    throw new Error(
      "Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY."
    )
  }

  return supabase
}
