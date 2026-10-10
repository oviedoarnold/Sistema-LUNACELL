/*
  Las RPC del modo sin conexión (0027):
  - sincronizar_venta_sin_conexion: la llama el teléfono del vendedor;
  - rescatar_venta_sin_conexion: la llama un administrador con un archivo de
    emergencia (la pantalla llega en OFF-1.3).

  Los nombres de los parámetros son el contrato con la base: cambiar uno
  rompe la sincronización. Las pruebas los fijan.
*/

export function aParametrosDeSincronizacion(venta, enviadoEn = new Date()) {
  return {
    p_clave_idempotencia: venta.clave,
    p_usuario_auth: venta.usuarioAuth,
    p_ubicacion_id: venta.ubicacionId,
    p_dispositivo: venta.dispositivo,
    p_numero_provisional: venta.numeroProvisional,
    p_registrada_en: venta.registradaEn,
    // El reloj del teléfono AL ENVIAR: con él el servidor mide el desfase.
    p_reloj_dispositivo: enviadoEn.toISOString(),
    p_tasa_isv: venta.tasaIsv,
    p_renglones: venta.renglones,
    p_total_cobrado: venta.totalCobrado,
    p_forma_pago: venta.formaPago,
    p_cliente_id: venta.clienteId ?? null,
    p_nombre_cliente: venta.nombreCliente ?? null,
    p_rtn_comprador: venta.rtnComprador ?? "",
    p_fecha_vencimiento: venta.fechaVencimiento ?? null,
    p_nota: venta.nota ?? "",
  }
}

/*
  En un rescate el archivo pudo viajar días antes de subirse: el servidor no
  mide el desfase, así que el «reloj» que va es la hora de la venta.
*/
export function aParametrosDeRescate(venta, lote = null) {
  return {
    ...aParametrosDeSincronizacion(venta, new Date(venta.registradaEn)),
    p_lote: lote,
  }
}

/*
  La función de envío que usa el sincronizador. Devuelve { data, error,
  status } tal como responde supabase-js; una excepción (sin red) la maneja
  el sincronizador. Con `signal`, el sincronizador aborta la petición cuando
  se agota su tiempo límite.
*/
export function crearEnvio(supabase, ahora = () => new Date()) {
  return async (venta, { signal } = {}) => {
    const consulta = supabase.rpc("sincronizar_venta_sin_conexion", aParametrosDeSincronizacion(venta, ahora()))
    const { data, error, status } = await (signal && consulta.abortSignal ? consulta.abortSignal(signal) : consulta)

    return { data, error, status }
  }
}

/*
  El rescate lo hace un administrador con el archivo de emergencia. Igual
  que la sincronización: { data, error, status } y señal de corte.
*/
export function crearRescate(supabase) {
  return async (venta, lote, { signal } = {}) => {
    const consulta = supabase.rpc("rescatar_venta_sin_conexion", aParametrosDeRescate(venta, lote))
    const { data, error, status } = await (signal && consulta.abortSignal ? consulta.abortSignal(signal) : consulta)

    return { data, error, status }
  }
}

/*
  En qué quedaron las ventas de este vendedor que están en conciliación. El
  vendedor solo ve las suyas (0027, ventas_por_conciliar_lectura).
*/
export function crearConsultaDeConciliaciones(supabase) {
  return async (claves) => {
    const { data, error, status } = await supabase
      .from("ventas_por_conciliar")
      .select("clave_idempotencia, estado, resuelta_en, venta_id")
      .in("clave_idempotencia", claves)

    return { data: data ?? null, error, status }
  }
}

/*
  ¿Se registró el intento en línea con esta clave? Lo pregunta el
  sincronizador antes de enviar una venta que nació de un intento sin
  respuesta. El vendedor ve las ventas de su ubicación (0029), que es donde
  se registró ese intento.
*/
export function crearVerificacionEnLinea(supabase) {
  return async (clave, { signal } = {}) => {
    const consulta = supabase.from("ventas").select("id, numero_factura").eq("clave_idempotencia", clave)
    const conSenal = signal && consulta.abortSignal ? consulta.abortSignal(signal) : consulta
    const { data, error, status } = await conSenal.maybeSingle()

    return { data: data ?? null, error, status }
  }
}
