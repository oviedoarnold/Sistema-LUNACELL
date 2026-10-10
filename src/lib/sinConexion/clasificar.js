/*
  Qué hacer con cada respuesta del servidor al sincronizar una venta.

  Respuestas con éxito (el servidor se quedó con la venta, no se reenvía):
  - registrada / ya_registrada       → registrada;
  - en_conciliacion / ya_en_conciliacion → en conciliación.

  Errores (la venta se conserva siempre):
  - red: no hubo respuesta útil (sin conexión, tiempo agotado, 5xx de la
    pasarela). Se detiene la ronda: las demás fallarían igual;
  - sesion: token vencido o identidad sin empresa. Se detiene la ronda hasta
    que el usuario vuelva a iniciar sesión;
  - otro_usuario (OF002): la venta es de otro usuario; espera a su dueño;
  - rechazo (OF001, OF003): el contenido no se puede aceptar tal cual. Se
    marca con error y solo se reintenta a mano;
  - temporal: cualquier otra cosa (un bloqueo, un fallo pasajero). Se
    reintenta en la siguiente ronda sin detener las demás ventas.
*/

export function clasificarRespuesta(data) {
  const estado = data?.estado

  if (estado === "registrada" || estado === "ya_registrada") return "registrada"
  if (estado === "en_conciliacion" || estado === "ya_en_conciliacion") return "en_conciliacion"

  return null
}

const PASARELA = new Set([0, 502, 503, 504])

export function clasificarError(error, status) {
  if (error instanceof TypeError) return "red"

  const codigo = String(error?.code ?? "")
  const mensaje = String(error?.message ?? "")

  if (PASARELA.has(status) || /failed to fetch|network|timeout|aborted|load failed/i.test(mensaje)) return "red"
  if (status === 401 || /^PGRST30[1-3]$/.test(codigo) || /jwt/i.test(mensaje) || codigo === "42501") return "sesion"
  if (codigo === "OF002") return "otro_usuario"
  if (codigo === "OF001" || codigo === "OF003") return "rechazo"

  return "temporal"
}
