import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

import { AuthContext } from "./contexts"
import { supabase } from "../lib/supabase"
import { marcarSesionAbierta, borrarMarcaDeSesion } from "../lib/marcaDeSesion"
import {
  authIdDeLaSesionGuardada,
  esFalloDeRed,
  olvidarPerfil,
  perfilSinConexion,
  recordarPerfil,
} from "../lib/sinConexion/sesionSinConexion"
import {
  iniciarSesionConUsuario,
  crearEmpleado,
  restablecerContrasena,
  cambiarContrasena,
  desbloquearUsuario,
  guardarPermisosDeUsuario,
} from "../lib/api/acceso"

import {
  PERMISSIONS,
  ADMIN_PERMISSIONS,
  SELLER_PERMISSIONS,
  concedePermiso,
} from "./permissions"

/*
  Consulta el perfil del usuario en sesión junto con sus permisos.

  perfil es null si la cuenta existe en Supabase pero nadie la invitó a una
  empresa: tener credenciales válidas no da acceso por sí solo. `error`
  dice además si no se pudo preguntar (sin red), que no es lo mismo que una
  respuesta negativa: solo en ese caso se puede usar el perfil guardado
  para facturar sin conexión.
*/
async function consultarPerfil(authId) {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, empresa_id, email, nombre, nombre_usuario, rol, activo, ubicacion_id, debe_cambiar_contrasena")
    .eq("auth_id", authId)
    .eq("activo", true)
    .maybeSingle()

  if (error || !data) {
    return { perfil: null, error }
  }

  const { data: filas, error: errorDePermisos } = await supabase
    .from("permisos_usuario")
    .select("seccion")
    .eq("usuario_id", data.id)

  // Sin red, un perfil sin permisos lo dejaría sin ninguna pantalla.
  if (errorDePermisos && esFalloDeRed(errorDePermisos)) {
    return { perfil: null, error: errorDePermisos }
  }

  return { perfil: {
    ...data,
    name: data.nombre,
    role: data.rol,
    username: data.nombre_usuario || "",
    locationId: data.ubicacion_id || "",
    /*
      Mientras sea true la base no le deja operar (0026): la pantalla solo le
      pide cambiar la contraseña temporal.
    */
    debeCambiar: Boolean(data.debe_cambiar_contrasena),
    authId,
    permissions: (filas || []).map((f) => f.seccion),
  }, error: null }
}

async function cargarPerfil(authId) {
  return (await consultarPerfil(authId)).perfil
}

/*
  El perfil para facturar sin conexión, solo si el servidor NO respondió:
  - con sesión, si el perfil no se pudo consultar por falta de red;
  - sin sesión, si el navegador todavía guarda la de este usuario. Supabase
    la borra al cerrar sesión o si el servidor la revoca; si sigue ahí y aun
    así no hay sesión, es que no se pudo renovar el token por falta de red.
*/
async function perfilParaSinConexion(sesion, fallo) {
  if (sesion?.user) {
    return esFalloDeRed(fallo) ? perfilSinConexion(sesion.user.id) : null
  }

  const guardada = authIdDeLaSesionGuardada(supabase)

  return guardada ? perfilSinConexion(guardada) : null
}

const NOMBRE_DE_USUARIO = /^[a-z0-9._-]{3,30}$/

/* Solo un bloqueo que todavía no vence cuenta como bloqueo. */
function bloqueoVigente(fila) {
  const bloqueo = Array.isArray(fila.bloqueos_de_acceso) ? fila.bloqueos_de_acceso[0] : fila.bloqueos_de_acceso
  const hasta = bloqueo?.bloqueado_hasta

  return hasta && new Date(hasta) > new Date() ? hasta : null
}

/*
  Qué se le cuenta al administrador cuando la base rechaza guardar.

  Mismo criterio que en api/ubicaciones.js, y por el mismo motivo: P0001 es
  lo que devuelve un RAISE EXCEPTION, o sea un texto que alguien escribió
  para que lo lea una persona. Aquí lo levanta el disparador que impide
  asignar una ubicación operativa inactiva, y decirle «no se pudo» a quien
  solo tiene que activarla antes es dejarlo adivinando.

  23505 se traduce porque su texto trae el nombre de un índice, que no
  significa nada para quien lo lee.
*/
function motivoDelUsuario(error, queHacia) {
  if (error?.code === "23505") {
    return "Ya existe un usuario con ese correo."
  }

  if (error?.code === "P0001" && String(error.message || "").trim()) {
    return error.message
  }

  return `No se pudo ${queHacia}.`
}

async function traerUsuariosDeLaEmpresa() {
  if (!supabase) {
    return []
  }

  /*
    permisos_usuario apunta a usuarios por dos llaves (usuario_id y, desde
    0021, usuario_id + empresa_id). Sin nombrar una, PostgREST responde
    PGRST201 y no devuelve ninguna fila.
  */
  const { data, error } = await supabase
    .from("usuarios")
    .select(
      "id, email, nombre, nombre_usuario, rol, activo, entro_en, ubicacion_id, debe_cambiar_contrasena, permisos_usuario!permisos_usuario_usuario_id_fkey(seccion), bloqueos_de_acceso(bloqueado_hasta)"
    )
    .order("nombre")

  if (error) {
    throw new Error(error.message || "La base rechazó la consulta de usuarios.")
  }

  return (data || []).map((fila) => ({
    id: fila.id,
    email: fila.email,
    name: fila.nombre,
    username: fila.nombre_usuario || "",
    debeCambiar: Boolean(fila.debe_cambiar_contrasena),
    bloqueadoHasta: bloqueoVigente(fila),
    role: fila.rol,
    locationId: fila.ubicacion_id || "",
    active: fila.activo,
    // Sin entro_en, la invitación sigue sin aceptarse.
    aceptoInvitacion: Boolean(fila.entro_en),
    permissions: (fila.permisos_usuario || []).map((p) => p.seccion),
  }))
}

/*
  La lista o el aviso de que no se pudo traer; nunca lanza. La lista de
  usuarios es administrativa: si falla, la pantalla sigue funcionando, pero
  el fallo no se pierde, porque entonces la lista se ve vacía y dice «No
  hay usuarios» sin que nadie sepa por qué.
*/
function leerUsuariosDeLaEmpresa() {
  return traerUsuariosDeLaEmpresa().then(
    (lista) => ({ lista }),
    (error) => {
      console.error("No se pudieron cargar los usuarios de la empresa:", error)
      return { fallo: true }
    }
  )
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)

  /*
    Arranca en true cuando hay conexión que consultar: si ProtectedRoute
    viera user = null mientras la sesión todavía se resuelve, mandaría al
    login en cada refresco. Es el mismo error que ya corregimos con
    localStorage, y contra la red es más fácil de reintroducir.
  */
  const [cargando, setCargando] = useState(() => Boolean(supabase))

  useEffect(() => {
    if (!supabase) {
      return
    }

    let vigente = true

    /*
      Nunca rechaza. Si consultar el perfil falla —sin red, o la consulta
      se cae— lo que no puede pasar es quedarse cargando para siempre:
      ProtectedRoute enseñaría "Comprobando tu sesión" y la pantalla no
      avanzaría nunca. Ante el fallo se deja de cargar sin usuario, que es
      lo honesto: no se pudo establecer quién es, así que no entra.
    */
    const aplicarSesion = async (sesion) => {
      let perfil = null
      let fallo = null

      try {
        if (sesion?.user) ({ perfil, error: fallo } = await consultarPerfil(sesion.user.id))
      } catch (error) {
        fallo = error
        console.error("No se pudo cargar el perfil de la sesión:", error)
      }

      /*
        La marca acompaña al perfil y no a la sesión de Supabase: una
        cuenta válida que no está asignada a ninguna empresa no entra,
        y no debe quedar marcada como si hubiera entrado.

        Un perfil confirmado por el servidor se guarda para poder facturar
        sin conexión más adelante. Sin servidor, solo el guardado.
      */
      if (perfil) {
        marcarSesionAbierta()
        void recordarPerfil(perfil)
      } else {
        perfil = await perfilParaSinConexion(sesion, fallo)
        if (!perfil) borrarMarcaDeSesion()
      }

      if (vigente) {
        setUser(perfil)
        setCargando(false)
      }
    }

    /*
      Las dos llamadas se lanzan sin esperar a proposito: la sesión se
      resuelve por su cuenta y el efecto no puede ser asíncrono. El void
      lo dice explícitamente, y es seguro porque aplicarSesion ya no
      rechaza.
    */
    void supabase.auth
      .getSession()
      .then(({ data }) => aplicarSesion(data.session))

    const { data: suscripcion } = supabase.auth.onAuthStateChange(
      (_evento, sesion) => {
        void aplicarSesion(sesion)
      }
    )

    return () => {
      vigente = false
      suscripcion.subscription.unsubscribe()
    }
  }, [])

  /*
    Con nombre de usuario o con correo. La contraseña se comprueba en la
    función de acceso, que lleva la cuenta de intentos y bloquea a los
    cinco: el navegador nunca habla directo con Supabase Auth para entrar.
  */
  const login = useCallback(async (identificador, password) => {
    if (!supabase) {
      return { ok: false, mensaje: "Falta configurar la conexión." }
    }

    let tokens

    try {
      tokens = await iniciarSesionConUsuario(String(identificador || "").trim(), password)
    } catch (error) {
      return { ok: false, mensaje: error.message }
    }

    const { data, error } = await supabase.auth.setSession(tokens)

    if (error || !data?.user) {
      return { ok: false, mensaje: "No se pudo iniciar sesión. Intenta de nuevo." }
    }

    const perfil = await cargarPerfil(data.user.id)

    if (!perfil) {
      await supabase.auth.signOut()

      return {
        ok: false,
        mensaje:
          "Tu cuenta no está asignada a ninguna empresa. Pídele al administrador que te dé acceso.",
      }
    }

    setUser(perfil)

    return { ok: true }
  }, [])

  /*
    Sin red, signOut() no puede avisar al servidor y deja la sesión
    guardada: se cierra entonces en este navegador, para que nadie vuelva a
    entrar sin conexión con ella. El perfil sin conexión se borra siempre.
    Las ventas sin sincronizar NO se borran: siguen en el teléfono y se
    envían cuando su vendedor vuelva a iniciar sesión.
  */
  const logout = useCallback(async () => {
    if (supabase) {
      const resultado = await supabase.auth.signOut()

      if (resultado?.error) {
        await supabase.auth.signOut({ scope: "local" })
      }
    }

    await olvidarPerfil()
    setUser(null)
  }, [])

  /*
    Vuelve a preguntar quién es al servidor. Lo usa el modo sin conexión al
    recuperar la red: un perfil «sin conexión» se cambia por el confirmado.
  */
  const revalidarSesion = useCallback(async () => {
    if (!supabase) return

    const { data } = await supabase.auth.getSession()
    if (!data?.session?.user) return

    const { perfil } = await consultarPerfil(data.session.user.id).catch(() => ({ perfil: null }))

    if (perfil) {
      marcarSesionAbierta()
      void recordarPerfil(perfil)
      setUser(perfil)
    }
  }, [])

  const [users, setUsers] = useState([])
  const [errorUsuarios, setErrorUsuarios] = useState("")

  const aplicarUsuarios = useCallback(({ lista, fallo }) => {
    if (fallo) {
      setErrorUsuarios("No se pudieron cargar los usuarios. Revisa tu conexión e intenta de nuevo.")
      return
    }

    setUsers(lista)
    setErrorUsuarios("")
  }, [])

  // Después de guardar: un fallo al recargar no convierte en error lo que sí se guardó.
  const recargarUsuarios = useCallback(() => leerUsuariosDeLaEmpresa().then(aplicarUsuarios), [aplicarUsuarios])

  useEffect(() => {
    if (!user) {
      return
    }

    let vigente = true

    void leerUsuariosDeLaEmpresa().then((resultado) => {
      if (vigente) {
        aplicarUsuarios(resultado)
      }
    })

    return () => {
      vigente = false
    }
  }, [user, aplicarUsuarios])

  /*
    La identidad la crea la función de acceso con una contraseña temporal
    individual, que se devuelve aquí una sola vez para que el administrador
    se la entregue al empleado. No se guarda en ninguna parte.
  */
  const addUser = useCallback(
    async ({ name, username, email, role = "vendedor", permissions = [], active = true, locationId = "" }) => {
      const nombre = String(name || "").trim()
      const usuario = String(username || "").trim().toLowerCase()
      const correo = String(email || "").trim().toLowerCase()

      if (!nombre) throw new Error("El nombre es obligatorio.")
      if (!NOMBRE_DE_USUARIO.test(usuario)) {
        throw new Error(
          "El nombre de usuario debe tener de 3 a 30 caracteres: minúsculas, números, punto, guion o guion bajo."
        )
      }
      if (!correo.includes("@")) throw new Error("Escribe un correo válido.")

      const { contrasena_temporal: temporal } = await crearEmpleado({
        nombre,
        usuario,
        email: correo,
        rol: role,
        secciones: role === "admin" ? ADMIN_PERMISSIONS : permissions,
        ubicacion: locationId || null,
        activo: active,
      })

      await recargarUsuarios()

      return temporal
    },
    [recargarUsuarios]
  )

  /* Contraseña temporal nueva: la anterior deja de servir y hay que cambiarla. */
  const resetUserPassword = useCallback(
    async (id) => {
      const { contrasena_temporal: temporal } = await restablecerContrasena(id)

      await recargarUsuarios()

      return temporal
    },
    [recargarUsuarios]
  )

  /* Limpia el bloqueo por intentos; no cambia la contraseña ni reactiva. */
  const unlockUser = useCallback(
    async (id) => {
      await desbloquearUsuario(id)
      await recargarUsuarios()
    },
    [recargarUsuarios]
  )

  const changePassword = useCallback(
    async (actual, nueva) => {
      await cambiarContrasena(actual, nueva)

      // Con la exigencia levantada, la base vuelve a dejarle operar.
      const perfil = await cargarPerfil(user.authId)
      if (perfil) setUser(perfil)
    },
    [user]
  )

  const updateUser = useCallback(
    async (id, { name, role, active, permissions, locationId }) => {
      const cambios = {}

      if (name !== undefined) cambios.nombre = String(name).trim()
      if (role !== undefined) cambios.rol = role
      if (active !== undefined) cambios.activo = active
      if (locationId !== undefined) cambios.ubicacion_id = locationId || null

      if (Object.keys(cambios).length) {
        const { error } = await supabase
          .from("usuarios")
          .update(cambios)
          .eq("id", id)

        if (error) throw new Error(motivoDelUsuario(error, "actualizar el usuario"))
      }

      if (permissions !== undefined || role !== undefined) {
        await guardarPermisosDeUsuario(
          id,
          role === "admin" ? ADMIN_PERMISSIONS : permissions || []
        )
      }

      await recargarUsuarios()
    },
    [recargarUsuarios]
  )

  const setUserActive = useCallback(
    (id, active) => updateUser(id, { active }),
    [updateUser]
  )

  const getUserById = useCallback(
    (id) => users.find((u) => String(u.id) === String(id)) || null,
    [users]
  )

  const hasPermission = useCallback(
    (permission) => {
      if (!user) {
        return false
      }

      /*
        Sin conexión solo se puede facturar: el resto de las pantallas
        necesita al servidor y el perfil no está confirmado.
      */
      if (user.sinConexion) {
        return permission === PERMISSIONS.POS && (user.role === "admin" || concedePermiso(user.permissions, permission))
      }

      if (user.role === "admin") {
        return true
      }

      /*
        No basta con buscar el permiso en la lista: «ver el inventario de
        todas las ubicaciones» ya incluye ver el de la propia, y quien lo
        tenga debe poder abrir la pantalla sin que nadie le haya marcado
        además la casilla de su ubicación.
      */
      return concedePermiso(user.permissions, permission)
    },
    [user]
  )

  const contextValue = useMemo(
    () => ({
      user,
      cargando,

      login,
      logout,
      revalidarSesion,
      hasPermission,

      // Sin sesión no hay lista que mostrar: se deriva en vez de
      // vaciarla desde un efecto.
      users: user ? users : [],
      addUser,
      updateUser,
      setUserActive,
      resetUserPassword,
      unlockUser,
      changePassword,
      getUserById,
      errorUsuarios,
      recargarUsuarios,

      permissions: PERMISSIONS,
      adminPermissions: ADMIN_PERMISSIONS,
      sellerPermissions: SELLER_PERMISSIONS,

      isAdmin: user?.role === "admin" && !user?.sinConexion,
    }),
    [
      user,
      cargando,
      login,
      logout,
      revalidarSesion,
      hasPermission,
      users,
      addUser,
      updateUser,
      setUserActive,
      resetUserPassword,
      unlockUser,
      changePassword,
      getUserById,
      errorUsuarios,
      recargarUsuarios,
    ]
  )

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}
