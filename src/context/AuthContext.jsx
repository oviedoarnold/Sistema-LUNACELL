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
  PERMISSIONS,
  ADMIN_PERMISSIONS,
  SELLER_PERMISSIONS,
} from "./permissions"

/*
  Carga el perfil del usuario en sesión junto con sus permisos.

  Devuelve null si la cuenta existe en Supabase pero nadie la invitó a una
  empresa: tener credenciales válidas no da acceso por sí solo.
*/
async function cargarPerfil(authId) {
  const { data, error } = await supabase
    .from("usuarios")
    .select("id, empresa_id, email, nombre, rol, activo")
    .eq("auth_id", authId)
    .eq("activo", true)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  const { data: filas } = await supabase
    .from("permisos_usuario")
    .select("seccion")
    .eq("usuario_id", data.id)

  return {
    ...data,
    name: data.nombre,
    role: data.rol,
    permissions: (filas || []).map((f) => f.seccion),
  }
}

async function traerUsuariosDeLaEmpresa() {
  if (!supabase) {
    return []
  }

  const { data } = await supabase
    .from("usuarios")
    .select("id, email, nombre, rol, activo, entro_en, permisos_usuario(seccion)")
    .order("nombre")

  return (data || []).map((fila) => ({
    id: fila.id,
    email: fila.email,
    name: fila.nombre,
    username: fila.email,
    role: fila.rol,
    active: fila.activo,
    // Sin entro_en, la invitación sigue sin aceptarse.
    aceptoInvitacion: Boolean(fila.entro_en),
    permissions: (fila.permisos_usuario || []).map((p) => p.seccion),
  }))
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

    const aplicarSesion = async (sesion) => {
      const perfil = sesion?.user
        ? await cargarPerfil(sesion.user.id)
        : null

      /*
        La marca acompaña al perfil y no a la sesión de Supabase: una
        cuenta válida que no está asignada a ninguna ferretería no entra,
        y no debe quedar marcada como si hubiera entrado.
      */
      if (perfil) marcarSesionAbierta()
      else borrarMarcaDeSesion()

      if (vigente) {
        setUser(perfil)
        setCargando(false)
      }
    }

    supabase.auth
      .getSession()
      .then(({ data }) => aplicarSesion(data.session))

    const { data: suscripcion } = supabase.auth.onAuthStateChange(
      (_evento, sesion) => {
        aplicarSesion(sesion)
      }
    )

    return () => {
      vigente = false
      suscripcion.subscription.unsubscribe()
    }
  }, [])

  const login = useCallback(async (email, password) => {
    if (!supabase) {
      return { ok: false, mensaje: "Falta configurar la conexión." }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email || "").trim().toLowerCase(),
      password,
    })

    if (error) {
      return { ok: false, mensaje: "Correo o contraseña incorrectos." }
    }

    const perfil = await cargarPerfil(data.user.id)

    if (!perfil) {
      await supabase.auth.signOut()

      return {
        ok: false,
        mensaje:
          "Tu cuenta no está asignada a ninguna ferretería. Pídele al administrador que te dé acceso.",
      }
    }

    setUser(perfil)

    return { ok: true }
  }, [])

  const logout = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut()
    }

    setUser(null)
  }, [])

  const [users, setUsers] = useState([])

  const recargarUsuarios = useCallback(async () => {
    setUsers(await traerUsuariosDeLaEmpresa())
  }, [])

  useEffect(() => {
    if (!user) {
      return
    }

    let vigente = true

    traerUsuariosDeLaEmpresa().then((lista) => {
      if (vigente) {
        setUsers(lista)
      }
    })

    return () => {
      vigente = false
    }
  }, [user])

  const guardarPermisos = useCallback(
    async (usuarioId, secciones) => {
      await supabase
        .from("permisos_usuario")
        .delete()
        .eq("usuario_id", usuarioId)

      if (!secciones.length) {
        return
      }

      await supabase.from("permisos_usuario").insert(
        secciones.map((seccion) => ({
          usuario_id: usuarioId,
          empresa_id: user.empresa_id,
          seccion,
        }))
      )
    },
    [user]
  )

  /*
    Con Supabase Auth no se crean contraseñas desde aquí: se invita por
    correo y la persona se registra con esa misma dirección. Un trigger
    en la base la vincula a la empresa al hacerlo.
  */
  const addUser = useCallback(
    async ({ name, email, role = "vendedor", permissions = [], active = true }) => {
      const correo = String(email || "").trim().toLowerCase()
      const nombre = String(name || "").trim()

      if (!nombre) throw new Error("El nombre es obligatorio.")
      if (!correo.includes("@")) throw new Error("Escribe un correo válido.")

      const { data, error } = await supabase
        .from("usuarios")
        .insert({
          empresa_id: user.empresa_id,
          email: correo,
          nombre,
          rol: role,
          activo: active,
        })
        .select("id")
        .single()

      if (error) {
        throw new Error(
          error.code === "23505"
            ? "Ya existe un usuario con ese correo."
            : "No se pudo crear el usuario."
        )
      }

      await guardarPermisos(
        data.id,
        role === "admin" ? ADMIN_PERMISSIONS : permissions
      )

      await recargarUsuarios()

      return data
    },
    [user, guardarPermisos, recargarUsuarios]
  )

  const updateUser = useCallback(
    async (id, { name, role, active, permissions }) => {
      const cambios = {}

      if (name !== undefined) cambios.nombre = String(name).trim()
      if (role !== undefined) cambios.rol = role
      if (active !== undefined) cambios.activo = active

      if (Object.keys(cambios).length) {
        const { error } = await supabase
          .from("usuarios")
          .update(cambios)
          .eq("id", id)

        if (error) throw new Error("No se pudo actualizar el usuario.")
      }

      if (permissions !== undefined || role !== undefined) {
        await guardarPermisos(
          id,
          role === "admin" ? ADMIN_PERMISSIONS : permissions || []
        )
      }

      await recargarUsuarios()
    },
    [guardarPermisos, recargarUsuarios]
  )

  const deleteUser = useCallback(
    async (id) => {
      const { error } = await supabase.from("usuarios").delete().eq("id", id)

      if (error) throw new Error("No se pudo eliminar el usuario.")

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

      if (user.role === "admin") {
        return true
      }

      return (
        Array.isArray(user.permissions) &&
        user.permissions.includes(permission)
      )
    },
    [user]
  )

  const contextValue = useMemo(
    () => ({
      user,
      cargando,

      login,
      logout,
      hasPermission,

      // Sin sesión no hay lista que mostrar: se deriva en vez de
      // vaciarla desde un efecto.
      users: user ? users : [],
      addUser,
      updateUser,
      deleteUser,
      setUserActive,
      getUserById,

      permissions: PERMISSIONS,
      adminPermissions: ADMIN_PERMISSIONS,
      sellerPermissions: SELLER_PERMISSIONS,

      isAdmin: user?.role === "admin",
    }),
    [
      user,
      cargando,
      login,
      logout,
      hasPermission,
      users,
      addUser,
      updateUser,
      deleteUser,
      setUserActive,
      getUserById,
    ]
  )

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}
