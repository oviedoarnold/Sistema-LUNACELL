import {
  useContext,
  useEffect,
  useState,
} from "react"

import Swal from "sweetalert2"

import { LocationsContext } from "../context/contexts"
import { ProductContext } from "../context/contexts"
import { SalesContext } from "../context/contexts"
import { useAuth } from "../hooks/useAuth"

import { FaPlus } from "react-icons/fa"

import PageHeader from "../components/crud/PageHeader"
import ModalShell from "../components/forms/ModalShell"

import {
  ADMIN_PERMISSIONS,
  PERMISSIONS,
} from "../context/permissions"

import {
  FISCAL_VACIO,
  getFiscalStatus,
} from "../utils/fiscal"

const EMPTY_USER_FORM = {
  id: null,
  name: "",
  username: "",
  email: "",
  role: "vendedor",
  active: true,
  locationId: "",
  permissions: [],
}

/*
  Qué inventario puede consultar un usuario, en las palabras que usa quien
  reparte los permisos.

  Son tres niveles excluyentes y no dos casillas sueltas porque es una sola
  pregunta —«¿cuánto inventario ve?»— y porque dos casillas obligarían a
  explicar qué significa marcar «todas» sin marcar «la suya». Debajo siguen
  siendo los permisos que la base ya conoce.
*/
const NIVEL_INVENTARIO = {
  NINGUNO: "ninguno",
  PROPIA: "propia",
  TODAS: "todas",
}

const OPCIONES_DE_INVENTARIO = [
  {
    id: NIVEL_INVENTARIO.NINGUNO,
    label: "No puede consultar existencias",
  },
  {
    id: NIVEL_INVENTARIO.PROPIA,
    label: "Solo el inventario de su ubicación",
  },
  {
    id: NIVEL_INVENTARIO.TODAS,
    label: "El inventario de todas las ubicaciones",
  },
]

/* De los permisos guardados al nivel que muestra el selector. */
function nivelDeInventario(permisos = []) {
  if (permisos.includes(PERMISSIONS.INVENTORY_ALL)) {
    return NIVEL_INVENTARIO.TODAS
  }

  if (permisos.includes(PERMISSIONS.INVENTORY_OWN)) {
    return NIVEL_INVENTARIO.PROPIA
  }

  return NIVEL_INVENTARIO.NINGUNO
}

/*
  Y al revés. «Todas» no guarda también «la suya»: la implicación la deriva
  concedePermiso(), igual que la deriva la base. Guardarla aquí sería
  dejar escrito dos veces algo que puede separarse.
*/
function permisosDelNivel(permisos = [], nivel) {
  const resto = permisos.filter(
    (p) =>
      p !== PERMISSIONS.INVENTORY_OWN && p !== PERMISSIONS.INVENTORY_ALL
  )

  if (nivel === NIVEL_INVENTARIO.TODAS) {
    return [...resto, PERMISSIONS.INVENTORY_ALL]
  }

  if (nivel === NIVEL_INVENTARIO.PROPIA) {
    return [...resto, PERMISSIONS.INVENTORY_OWN]
  }

  return resto
}

function buildCompanyForm(company) {
  return {
    name: company?.name || "",
    address: company?.address || "",
    phone: company?.phone || "",
    currency: company?.currency || "L",
    taxRate: company?.taxRate ?? 15,

    ...FISCAL_VACIO,
    ...(company?.fiscal || {}),
  }
}

function Settings() {
  const {
    company,
    setCompany,
  } = useContext(ProductContext)

  const {
    user,
    users,
    errorUsuarios,
    recargarUsuarios,
    addUser,
    updateUser,
    resetUserPassword,
    unlockUser,
    permissions,
    sellerPermissions,
  } = useAuth()

  const {
    counters,
  } = useContext(SalesContext)

  /*
    Solo las activas: una ubicación retirada no es un sitio desde el que
    nadie trabaje, y la base rechaza asignarla.
  */
  const { ubicacionesActivas = [] } = useContext(LocationsContext)

  const [
    companyForm,
    setCompanyForm,
  ] = useState(() =>
    buildCompanyForm(company)
  )

  const [
    empresaMostrada,
    setEmpresaMostrada,
  ] = useState(company)

  /*
    La empresa llega de la base después del primer render, y vuelve a
    llegar cada vez que se guarda. Cuando cambia, el formulario se vuelve
    a llenar con lo que quedó guardado.
  */
  if (company !== empresaMostrada) {
    setEmpresaMostrada(company)
    setCompanyForm(buildCompanyForm(company))
  }


  const handleCompanyChange = (
    event
  ) => {
    const {
      name,
      value,
    } = event.target

    setCompanyForm(
      (current) => ({
        ...current,
        [name]: value,
      })
    )
  }

  const saveCompany = (
    event
  ) => {
    event.preventDefault()

    const name =
      companyForm.name.trim()

    const address =
      companyForm.address.trim()

    const phone =
      companyForm.phone.trim()

    const currency =
      companyForm.currency.trim()

    const taxRate =
      Number(
        companyForm.taxRate
      )

    if (
      !name ||
      !address ||
      !phone ||
      !currency
    ) {
      Swal.fire({
        icon: "warning",
        title:
          "Faltan datos",
        text:
          "Completa todos los campos obligatorios.",
      })

      return
    }

    if (
      !Number.isFinite(
        taxRate
      ) ||
      taxRate < 0 ||
      taxRate > 100
    ) {
      Swal.fire({
        icon: "warning",
        title:
          "ISV inválido",
        text:
          "La tasa de ISV debe estar entre 0 y 100.",
      })

      return
    }

    setCompany({
      name,
      address,
      phone,
      currency,
      taxRate,

      fiscal: {
        rtn: companyForm.rtn.trim(),
        cai: companyForm.cai.trim(),
        establecimiento: companyForm.establecimiento,
        puntoEmision: companyForm.puntoEmision,
        tipoDocumento: companyForm.tipoDocumento || "01",
        rangoDesde: companyForm.rangoDesde,
        rangoHasta: companyForm.rangoHasta,
        fechaLimiteEmision: companyForm.fechaLimiteEmision,
      },
    })

    Swal.fire({
      icon: "success",
      title:
        "Configuración guardada",
      text:
        "Los datos de la empresa fueron actualizados.",
    })
  }

  const restoreCompanyForm = () =>
    setCompanyForm(
      buildCompanyForm(company)
    )

  /*
    Estado del rango autorizado frente al
    proximo correlativo que se emitiria.
  */
  const fiscalStatus =
    getFiscalStatus(
      companyForm,
      counters?.invoice ?? 0
    )

  const [
    userModalOpen,
    setUserModalOpen,
  ] = useState(false)

  const [
    userForm,
    setUserForm,
  ] = useState({
    ...EMPTY_USER_FORM,
    permissions:
      sellerPermissions,
  })

  const isEditingUser =
    Boolean(userForm.id)

  /*
    La hora con la que se calcula cuánto le queda a un bloqueo. Se renueva
    cada medio minuto para que el tiempo restante baje solo.
  */
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 30000)

    return () => clearInterval(reloj)
  }, [])

  /*
   * Los vendedores pueden recibir
   * permisos de módulos operativos.
   *
   * Settings queda reservado para
   * administradores.
   */
  const permissionOptions = [
    {
      id:
        permissions.DASHBOARD,
      label: "Dashboard",
      description:
        "Ver el panel principal y sus indicadores.",
    },
    {
      id: permissions.POS,
      label: "Facturar",
      description:
        "Crear ventas y generar facturas.",
    },
    {
      id:
        permissions.QUOTES,
      label: "Cotizar",
      description:
        "Crear y consultar cotizaciones.",
    },
    {
      id:
        permissions.PRODUCTS,
      label: "Inventario",
      description:
        "Consultar y administrar productos.",
    },
    {
      id:
        permissions.CLIENTS,
      label: "Clientes",
      description:
        "Consultar y administrar clientes.",
    },
    {
      id:
        permissions.SUPPLIERS,
      label: "Proveedores",
      description:
        "Consultar y administrar proveedores.",
    },
    {
      id:
        permissions.SALES_HISTORY,
      label:
        "Historial de facturas",
      description:
        "Consultar ventas y facturas anteriores.",
    },
    {
      id:
        permissions.LOCATIONS,
      label: "Ubicaciones",
      description:
        "Consultar y administrar bodegas, tiendas y camiones.",
    },
  ]

  const resetUserForm =
    () => {
      setUserForm({
        ...EMPTY_USER_FORM,

        permissions: [
          ...sellerPermissions,
        ],
      })
    }

  const openNewUser =
    () => {
      resetUserForm()

      setUserModalOpen(true)
    }

  const openEditUser = (
    selectedUser
  ) => {
    setUserForm({
      id:
        selectedUser.id,

      name:
        selectedUser.name ||
        "",

      username:
        selectedUser.username ||
        "",

      email:
        selectedUser.email ||
        "",

      role:
        selectedUser.role ||
        "vendedor",

      active:
        selectedUser.active !==
        false,

      locationId:
        selectedUser.locationId ||
        "",

      permissions:
        selectedUser.role ===
        "admin"
          ? ADMIN_PERMISSIONS
          : Array.isArray(
                selectedUser.permissions
              )
            ? [
                ...selectedUser.permissions,
              ]
            : [],
    })

    setUserModalOpen(true)
  }

  const closeUserModal =
    () => {
      setUserModalOpen(false)

      resetUserForm()
    }

  const handleUserChange = (
    event
  ) => {
    const {
      name,
      value,
      type,
      checked,
    } = event.target

    setUserForm(
      (current) => ({
        ...current,

        [name]:
          type === "checkbox"
            ? checked
            : value,
      })
    )
  }

  const handleRoleChange = (
    event
  ) => {
    const role =
      event.target.value

    setUserForm(
      (current) => ({
        ...current,

        role,

        /*
         * Admin obtiene todos los
         * permisos automáticamente.
         *
         * Vendedor comienza con los
         * permisos sugeridos.
         */
        permissions:
          role === "admin"
            ? ADMIN_PERMISSIONS
            : current.role ===
                "admin"
              ? [
                  ...sellerPermissions,
                ]
              : current.permissions,
      })
    )
  }

  /*
    El nivel de inventario reemplaza los dos permisos a la vez, no los
    acumula: son excluyentes de cara a quien los reparte.
  */
  const handleInventoryLevelChange = (event) => {
    const nivel = event.target.value

    setUserForm((current) => ({
      ...current,
      permissions: permisosDelNivel(current.permissions, nivel),
    }))
  }

  const togglePermission = (
    permissionId
  ) => {
    if (
      userForm.role ===
      "admin"
    ) {
      return
    }

    setUserForm(
      (current) => {
        const exists =
          current.permissions.includes(
            permissionId
          )

        return {
          ...current,

          permissions: exists
            ? current.permissions.filter(
                (item) =>
                  item !==
                  permissionId
              )
            : [
                ...current.permissions,
                permissionId,
              ],
        }
      }
    )
  }

  /*
    Cada acción espera la respuesta del servidor y solo entonces dice que
    salió bien; si falla, muestra el motivo. La contraseña temporal la
    genera el servidor y se muestra aquí una sola vez: no queda guardada.
  */
  const avisarError = (titulo, error) =>
    Swal.fire({
      icon: "error",
      title: titulo,
      text: error.message,
    })

  const mostrarTemporal = (titulo, nombre, temporal) =>
    Swal.fire({
      icon: "success",
      title: titulo,
      text: `Entrégale a ${nombre} esta contraseña temporal: ${temporal} — Solo se muestra esta vez. Al entrar deberá cambiarla.`,
    })

  /*
    Si el vendedor trabaja en una ubicación que vende sin conexión, puede
    tener ventas guardadas en su teléfono. Cambiarle la ubicación antes de
    que sincronice manda esas ventas a conciliación («ubicación cambiada»):
    se avisa antes, sin impedirlo.
  */
  const confirmarCambioDeUbicacion = async () => {
    const anterior = users.find((u) => String(u.id) === String(userForm.id))
    const ubicacionAnterior = ubicacionesActivas.find((u) => u.id === anterior?.locationId)

    if (!anterior?.locationId || anterior.locationId === userForm.locationId || !ubicacionAnterior?.offline) {
      return true
    }

    const respuesta = await Swal.fire({
      icon: "warning",
      title: "¿Cambiar la ubicación de este usuario?",
      text: `«${ubicacionAnterior.name}» vende sin conexión. Si ${anterior.name} tiene ventas sin sincronizar en su teléfono, al llegar quedarán en conciliación y habrá que revisarlas. Lo ideal es que sincronice antes del cambio.`,
      showCancelButton: true,
      confirmButtonText: "Cambiar igual",
      cancelButtonText: "Volver",
    })

    return respuesta.isConfirmed
  }

  const saveUser = async (
    event
  ) => {
    event.preventDefault()

    const permisos =
      userForm.role === "admin"
        ? ADMIN_PERMISSIONS
        : userForm.permissions

    try {
      if (isEditingUser && !(await confirmarCambioDeUbicacion())) {
        return
      }

      if (isEditingUser) {
        await updateUser(userForm.id, {
          name: userForm.name,
          role: userForm.role,
          active: userForm.active,
          locationId: userForm.locationId,
          permissions: permisos,
        })

        closeUserModal()

        await Swal.fire({
          icon: "success",
          title: "Usuario actualizado",
          text: "Los cambios fueron guardados correctamente.",
        })

        return
      }

      const temporal = await addUser({
        name: userForm.name,
        username: userForm.username,
        email: userForm.email,
        role: userForm.role,
        active: userForm.active,
        locationId: userForm.locationId,
        permissions: permisos,
      })

      closeUserModal()

      await mostrarTemporal("Usuario creado", userForm.name, temporal)
    } catch (error) {
      avisarError("No se pudo guardar", error)
    }
  }

  const handleToggleActive =
    async (
      selectedUser
    ) => {
      try {
        await updateUser(selectedUser.id, {
          active: !selectedUser.active,
        })

        Swal.fire({
          icon: "success",
          title: selectedUser.active
            ? "Usuario desactivado"
            : "Usuario activado",
        })
      } catch (error) {
        avisarError("No se pudo cambiar el estado", error)
      }
    }

  /* Limpia el bloqueo por intentos; no cambia la contraseña ni reactiva. */
  const handleUnlock = async (selectedUser) => {
    try {
      await unlockUser(selectedUser.id)

      Swal.fire({
        icon: "success",
        title: "Usuario desbloqueado",
        text: `${selectedUser.name} ya puede entrar con su contraseña actual.`,
      })
    } catch (error) {
      avisarError("No se pudo desbloquear", error)
    }
  }

  /* Contraseña temporal nueva: invalida la anterior y desbloquea. */
  const handleResetPassword = async (selectedUser) => {
    const respuesta = await Swal.fire({
      icon: "warning",
      title: "¿Restablecer contraseña?",
      text: `${selectedUser.name} dejará de poder entrar con su contraseña actual y deberá cambiar la temporal al entrar.`,
      showCancelButton: true,
      confirmButtonText: "Sí, restablecer",
      cancelButtonText: "Cancelar",
    })

    if (!respuesta.isConfirmed) return

    try {
      const temporal = await resetUserPassword(selectedUser.id)

      await mostrarTemporal("Contraseña restablecida", selectedUser.name, temporal)
    } catch (error) {
      avisarError("No se pudo restablecer", error)
    }
  }

  const minutosDeBloqueo = (hasta) =>
    Math.max(1, Math.ceil((new Date(hasta) - ahora) / 60000))

  const getRoleLabel = (
    role
  ) => {
    return role === "admin"
      ? "Administrador"
      : "Vendedor"
  }

  const getPermissionLabel = (
    permissionId
  ) => {
    return (
      permissionOptions.find(
        (item) =>
          item.id ===
          permissionId
      )?.label ||
      permissionId
    )
  }

  return (
    <div className="view active config">

      {/* =====================================
          ENCABEZADO
      ====================================== */}

      <PageHeader descripcion="Datos de tu empresa y administración de usuarios." />

      {/* =====================================
          DATOS DE LA FERRETERÍA
      ====================================== */}

      <section className="config-card" aria-labelledby="config-empresa">

        <div className="config-section">

          <h2 className="config-titulo" id="config-empresa">
            Datos de la empresa
          </h2>

          <p className="config-descripcion">
            Esta información aparece en las facturas y cotizaciones.
          </p>

          <form
            onSubmit={
              saveCompany
            }
          >
            <div className="form-grid">

              <div className="field full">
                <label htmlFor="settings-nombre-2">
                  Nombre
                </label>

                <input id="settings-nombre-2"
                  type="text"
                  name="name"
                  value={
                    companyForm.name
                  }
                  onChange={
                    handleCompanyChange
                  }
                  required
                />
              </div>

              <div className="field full">
                <label htmlFor="settings-direccion">
                  Dirección
                </label>

                <input id="settings-direccion"
                  type="text"
                  name="address"
                  value={
                    companyForm.address
                  }
                  onChange={
                    handleCompanyChange
                  }
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="settings-telefono">
                  Teléfono
                </label>

                <input id="settings-telefono"
                  type="text"
                  name="phone"
                  value={
                    companyForm.phone
                  }
                  onChange={
                    handleCompanyChange
                  }
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="settings-simbolo-de-moneda">
                  Símbolo de moneda
                </label>

                <input id="settings-simbolo-de-moneda"
                  type="text"
                  name="currency"
                  maxLength={4}
                  value={
                    companyForm.currency
                  }
                  onChange={
                    handleCompanyChange
                  }
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="settings-tasa-isv">
                  Tasa ISV (%)
                </label>

                <input id="settings-tasa-isv"
                  type="number"
                  name="taxRate"
                  min="0"
                  max="100"
                  step="0.5"
                  value={
                    companyForm.taxRate
                  }
                  onChange={
                    handleCompanyChange
                  }
                  required
                />
              </div>

            </div>

            {/* DATOS FISCALES */}
            <div className="config-subseccion">
              <h3 className="config-subtitulo">
                Datos fiscales
              </h3>

              <p className="config-descripcion">
                Con estos datos las facturas usan la numeración autorizada
                por el SAR. Sin ellos se emiten con numeración interna.
              </p>

              {/*
                El aviso cambia de color según lo apremiante que sea, pero
                el nivel se dice también con palabras: el color no es la
                única señal. Antes se pintaba con la clase de la pantalla
                de acceso y colores escritos a mano.
              */}
              <div
                className={`config-aviso ${fiscalStatus.level}`}
                role="status"
              >
                {fiscalStatus.message}
              </div>

              <div className="form-grid">

                <div className="field">
                  <label htmlFor="settings-rtn-de-la-empresa">
                    RTN de la empresa
                  </label>

                  <input id="settings-rtn-de-la-empresa"
                    type="text"
                    name="rtn"
                    placeholder="08019012345678"
                    value={
                      companyForm.rtn
                    }
                    onChange={
                      handleCompanyChange
                    }
                  />
                </div>

                <div className="field full">
                  <label htmlFor="settings-cai">CAI</label>

                  <input id="settings-cai"
                    type="text"
                    name="cai"
                    placeholder="A1B2C3-D4E5F6-A7B8C9-D1E2F3-A4B5C6-D7"
                    value={
                      companyForm.cai
                    }
                    onChange={
                      handleCompanyChange
                    }
                  />

                  <span className="hint">
                    Código de Autorización de
                    Impresión emitido por el SAR
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="settings-establecimiento">
                    Establecimiento
                  </label>

                  <input id="settings-establecimiento"
                    type="text"
                    name="establecimiento"
                    placeholder="000"
                    maxLength="3"
                    value={
                      companyForm.establecimiento
                    }
                    onChange={
                      handleCompanyChange
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="settings-punto-de-emision">
                    Punto de emisión
                  </label>

                  <input id="settings-punto-de-emision"
                    type="text"
                    name="puntoEmision"
                    placeholder="001"
                    maxLength="3"
                    value={
                      companyForm.puntoEmision
                    }
                    onChange={
                      handleCompanyChange
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="settings-rango-autorizado-desde">
                    Rango autorizado desde
                  </label>

                  <input id="settings-rango-autorizado-desde"
                    type="number"
                    name="rangoDesde"
                    min="1"
                    placeholder="1"
                    value={
                      companyForm.rangoDesde
                    }
                    onChange={
                      handleCompanyChange
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="settings-rango-autorizado-hasta">
                    Rango autorizado hasta
                  </label>

                  <input id="settings-rango-autorizado-hasta"
                    type="number"
                    name="rangoHasta"
                    min="1"
                    placeholder="5000"
                    value={
                      companyForm.rangoHasta
                    }
                    onChange={
                      handleCompanyChange
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="settings-fecha-limite-de-emision">
                    Fecha límite de emisión
                  </label>

                  <input id="settings-fecha-limite-de-emision"
                    type="date"
                    name="fechaLimiteEmision"
                    value={
                      companyForm.fechaLimiteEmision
                    }
                    onChange={
                      handleCompanyChange
                    }
                  />
                </div>

              </div>

              <p className="config-nota">
                La normativa del SAR cambia con el tiempo. Confirma con tu
                contador que estos datos y su formato son los vigentes
                antes de facturar formalmente.
              </p>
            </div>

            {/*
              Guardar primero y deshacer después: el orden en que se leen.
              Deshacer es secundario porque devuelve lo guardado, no borra.
            */}
            <div className="config-acciones">
              <button
                type="submit"
                className="btn btn-primary"
              >
                Guardar cambios
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={
                  restoreCompanyForm
                }
              >
                Deshacer cambios
              </button>
            </div>
          </form>

        </div>

      </section>

      {/* =====================================
          USUARIOS
      ====================================== */}

      <section className="config-card" aria-labelledby="config-usuarios">

        <div className="config-section">

          <div className="config-cabecera">

            <div>
              <h2 className="config-titulo" id="config-usuarios">
                Usuarios
              </h2>

              <p className="config-descripcion">
                Administra quién puede entrar al sistema y qué módulos
                puede utilizar.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={
                openNewUser
              }
            >
              <FaPlus aria-hidden="true" />Nuevo usuario
            </button>

          </div>

          {/* Un error de carga no es lo mismo que una empresa sin usuarios. */}
          {errorUsuarios && (
            <div className="empty-state" role="alert">
              <strong>{errorUsuarios}</strong>

              <button type="button" className="btn btn-secondary" onClick={() => recargarUsuarios()}>
                Reintentar
              </button>
            </div>
          )}

          {!errorUsuarios && users.length === 0 && (
            <div className="empty-state">
              <strong>
                No hay usuarios
              </strong>
            </div>
          )}

          {users.length > 0 && (
            <div className="table-wrap">

              <table aria-label="Usuarios">

                <thead>
                  <tr>
                    <th>
                      Nombre
                    </th>

                    <th>
                      Usuario
                    </th>

                    <th>
                      Rol
                    </th>

                    <th>
                      Estado
                    </th>

                    <th>
                      Permisos
                    </th>

                    <th>
                      Acciones
                    </th>
                  </tr>
                </thead>

                <tbody>

                  {users.map(
                    (
                      systemUser
                    ) => (
                      <tr
                        key={
                          systemUser.id
                        }
                      >

                        <td>
                          <strong>
                            {
                              systemUser.name
                            }
                          </strong>

                          {String(
                            systemUser.id
                          ) ===
                            String(
                              user?.id
                            ) && (
                            <div className="config-marca-sesion">
                              Sesión actual
                            </div>
                          )}
                        </td>

                        <td>
                          {systemUser.username
                            ? `@${systemUser.username}`
                            : systemUser.email}

                          {systemUser.bloqueadoHasta && (
                            <div>
                              <span className="badge badge-out">
                                <span className="badge-dot" />
                                Bloqueado · quedan {minutosDeBloqueo(systemUser.bloqueadoHasta)} min
                              </span>
                            </div>
                          )}
                        </td>

                        <td>
                          <span
                            className={
                              systemUser.role ===
                              "admin"
                                ? "badge badge-credit"
                                : "badge badge-paid"
                            }
                          >
                            <span className="badge-dot" />

                            {getRoleLabel(
                              systemUser.role
                            )}
                          </span>
                        </td>

                        <td>
                          <span
                            className={
                              systemUser.active
                                ? "badge badge-paid"
                                : "badge badge-out"
                            }
                          >
                            <span className="badge-dot" />

                            {systemUser.active
                              ? "Activo"
                              : "Inactivo"}
                          </span>
                        </td>

                        <td className="config-celda-permisos">
                          {systemUser.role ===
                          "admin" ? (
                            <span className="sub">
                              Acceso total
                            </span>
                          ) : systemUser
                              .permissions
                              ?.length ? (
                            <div className="config-fichas-permisos">
                              {systemUser.permissions.map(
                                (
                                  permission
                                ) => (
                                  <span
                                    key={
                                      permission
                                    }
                                    className="badge badge-ok"
                                  >
                                    {getPermissionLabel(
                                      permission
                                    )}
                                  </span>
                                )
                              )}
                            </div>
                          ) : (
                            <span className="sub">
                              Sin permisos
                            </span>
                          )}
                        </td>

                        <td className="row-actions">

                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() =>
                              openEditUser(
                                systemUser
                              )
                            }
                          >
                            Editar
                          </button>

                          {String(
                            systemUser.id
                          ) !==
                            String(
                              user?.id
                            ) && (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() =>
                                  handleToggleActive(
                                    systemUser
                                  )
                                }
                              >
                                {systemUser.active
                                  ? "Desactivar"
                                  : "Activar"}
                              </button>

                              {systemUser.bloqueadoHasta && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleUnlock(systemUser)}
                                >
                                  Desbloquear usuario
                                </button>
                              )}

                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleResetPassword(systemUser)}
                              >
                                Restablecer contraseña
                              </button>
                            </>
                          )}

                        </td>

                      </tr>
                    )
                  )}

                </tbody>

              </table>

            </div>
          )}

        </div>

      </section>

      {/* =====================================
          MODAL USUARIO
      ====================================== */}

      {userModalOpen && (
        <ModalShell
          titulo={isEditingUser ? "Editar usuario" : "Nuevo usuario"}
          onCerrar={closeUserModal}
          ancho="modal-lg"
          acciones={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeUserModal}
              >
                Cancelar
              </button>

              {/*
                El envío vive en el pie y el formulario en el cuerpo:
                form="..." los enlaza sin mover el submit de sitio.
              */}
              <button
                type="submit"
                form="form-usuario"
                className="btn btn-primary"
              >
                {isEditingUser ? "Guardar cambios" : "Crear usuario"}
              </button>
            </>
          }
        >
          <form id="form-usuario" onSubmit={saveUser}>

            <p className="config-descripcion">
              Configura las credenciales y permisos de acceso.
            </p>

              <div>

                <div className="form-grid">

                  {/* NOMBRE */}
                  <div className="field">
                    <label htmlFor="settings-nombre">
                      Nombre
                    </label>

                    <input id="settings-nombre"
                      type="text"
                      name="name"
                      value={
                        userForm.name
                      }
                      onChange={
                        handleUserChange
                      }
                      placeholder="Nombre completo"
                      required
                    />
                  </div>

                  {/* NOMBRE DE USUARIO */}
                  <div className="field">
                    <label htmlFor="settings-usuario">
                      Nombre de usuario
                    </label>

                    <input id="settings-usuario"
                      type="text"
                      name="username"
                      value={userForm.username}
                      onChange={handleUserChange}
                      placeholder="Ej. camion01"
                      autoComplete="off"
                      readOnly={isEditingUser}
                      required
                    />
                  </div>

                  {/* CORREO */}
                  <div className="field">
                    <label htmlFor="settings-correo">
                      Correo
                    </label>

                    <input id="settings-correo"
                      type="email"
                      name="email"
                      value={userForm.email}
                      onChange={handleUserChange}
                      placeholder="empleado@correo.com"
                      autoComplete="off"
                      readOnly={isEditingUser}
                      required
                    />
                  </div>

                  {!isEditingUser && (
                    <p className="sub config-nota-acceso">
                      Al guardar se genera una contraseña temporal que verás una
                      sola vez. El empleado entra con su nombre de usuario y
                      debe cambiarla en su primer inicio de sesión.
                    </p>
                  )}

                  {/* ROL */}
                  <div className="field">
                    <label htmlFor="settings-rol">
                      Rol
                    </label>

                    <select id="settings-rol"
                      name="role"
                      value={
                        userForm.role
                      }
                      onChange={
                        handleRoleChange
                      }
                    >
                      <option value="vendedor">
                        Vendedor
                      </option>

                      <option value="admin">
                        Administrador
                      </option>
                    </select>
                  </div>

                </div>

                {/* ACTIVO */}
                <div className="config-casilla">
                  <label htmlFor="settings-usuario-activo">
                    <input
                      id="settings-usuario-activo"
                      type="checkbox"
                      name="active"
                      checked={
                        userForm.active
                      }
                      onChange={
                        handleUserChange
                      }
                      aria-describedby="settings-usuario-activo-ayuda"
                    />

                    <strong>
                      Usuario activo
                    </strong>
                  </label>

                  <p
                    className="config-descripcion"
                    id="settings-usuario-activo-ayuda"
                  >
                    Un usuario inactivo no puede iniciar sesión.
                  </p>
                </div>

                <hr className="divider" />

                {/* PERMISOS */}
                <div>

                  <h4 className="config-subtitulo">
                    Permisos de acceso
                  </h4>

                  {userForm.role === "admin" ? (
                    <div className="permiso-admin">
                      <strong>Administrador</strong>

                      <p className="config-descripcion">
                        Los administradores tienen acceso completo a todos
                        los módulos y a Configuración.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="config-descripcion">
                        Selecciona los módulos que este usuario podrá utilizar.
                      </p>

                      <div className="permisos-rejilla">

                        {permissionOptions.map((permission) => {
                          const checked = userForm.permissions.includes(
                            permission.id
                          )

                          return (
                            <label
                              key={permission.id}
                              htmlFor={`permiso-${permission.id}`}
                              className={
                                checked
                                  ? "permiso-opcion elegido"
                                  : "permiso-opcion"
                              }
                            >
                              <input
                                id={`permiso-${permission.id}`}
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  togglePermission(permission.id)
                                }
                              />

                              <strong>{permission.label}</strong>

                              <small>{permission.description}</small>
                            </label>
                          )
                        })}

                      </div>
                    </>
                  )}

                </div>

                <hr className="divider" />

                {/* INVENTARIO Y UBICACIÓN OPERATIVA */}
                <div>

                  <h4 className="config-subtitulo">
                    Inventario y ubicación
                  </h4>

                  <div className="form-grid">

                    {/*
                      Desde dónde trabaja, que no es lo mismo que qué puede
                      consultar: un administrador puede estar en un camión y
                      seguir viendo la bodega entera.
                    */}
                    <div className="field">
                      <label htmlFor="settings-ubicacion">
                        Ubicación operativa
                      </label>

                      <select
                        id="settings-ubicacion"
                        name="locationId"
                        value={userForm.locationId}
                        onChange={handleUserChange}
                        aria-describedby="settings-ubicacion-ayuda"
                      >
                        <option value="">Sin asignar</option>

                        {ubicacionesActivas.map((ubicacion) => (
                          <option
                            key={ubicacion.id}
                            value={ubicacion.id}
                          >
                            {ubicacion.name}
                          </option>
                        ))}
                      </select>

                      <p
                        className="config-descripcion"
                        id="settings-ubicacion-ayuda"
                      >
                        Desde dónde trabaja esta persona. Solo aparecen las
                        ubicaciones activas.
                      </p>
                    </div>

                    {/*
                      Y cuánto inventario alcanza a ver. Tres niveles
                      excluyentes en vez de dos casillas: es una sola
                      pregunta.
                    */}
                    <div className="field">
                      <label htmlFor="settings-inventario">
                        Inventario que puede consultar
                      </label>

                      <select
                        id="settings-inventario"
                        value={
                          userForm.role === "admin"
                            ? NIVEL_INVENTARIO.TODAS
                            : nivelDeInventario(userForm.permissions)
                        }
                        onChange={handleInventoryLevelChange}
                        disabled={userForm.role === "admin"}
                        aria-describedby="settings-inventario-ayuda"
                      >
                        {OPCIONES_DE_INVENTARIO.map((opcion) => (
                          <option key={opcion.id} value={opcion.id}>
                            {opcion.label}
                          </option>
                        ))}
                      </select>

                      <p
                        className="config-descripcion"
                        id="settings-inventario-ayuda"
                      >
                        {userForm.role === "admin"
                          ? "Los administradores consultan el inventario de todas las ubicaciones."
                          : "Decide qué muestra la pantalla Existencias. «Solo su ubicación» enseña únicamente lo que hay donde trabaja."}
                      </p>
                    </div>

                  </div>

                </div>

              </div>

          </form>
        </ModalShell>
      )}

    </div>
  )
}

export default Settings