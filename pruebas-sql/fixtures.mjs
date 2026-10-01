/*
  Datos de prueba que se construyen desde cero en cada caso.

  Ninguno sale de producción: se inventan aquí una empresa, su cliente y
  sus facturas, con los montos que el caso necesita. Así una prueba puede
  montar la deuda exacta que quiere comprobar sin depender de lo que haya
  en la base del cliente, que además cambia.
*/

let contador = 0

function siguiente() {
  contador += 1

  return contador
}

/*
  Una empresa con su administrador, listo para autenticarse. Devuelve lo
  necesario para hacerse pasar por él: el auth_id va al JWT.
*/
export async function crearEmpresa(cliente, nombre = "Empresa de prueba") {
  const n = siguiente()

  const empresa = (
    await cliente.query(
      "insert into empresas (nombre) values ($1) returning id",
      [`${nombre} ${n}`]
    )
  ).rows[0].id

  const authId = (
    await cliente.query(
      "insert into auth.users (email) values ($1) returning id",
      [`usuario${n}@prueba.local`]
    )
  ).rows[0].id

  const usuario = (
    await cliente.query(
      `insert into usuarios (empresa_id, auth_id, email, nombre, rol, activo)
       values ($1, $2, $3, $4, 'admin', true) returning id`,
      [empresa, authId, `usuario${n}@prueba.local`, `Usuario ${n}`]
    )
  ).rows[0].id

  return { empresa, usuario, authId }
}

export async function crearCliente(cliente, empresa, nombre = "Cliente") {
  const n = siguiente()

  return (
    await cliente.query(
      "insert into clientes (empresa_id, nombre) values ($1, $2) returning id",
      [empresa, `${nombre} ${n}`]
    )
  ).rows[0].id
}

/*
  Una factura a crédito con el total que pida el caso.

  `fecha` y `correlativo` se pueden fijar porque son justo lo que ordena el
  reparto: una prueba de FIFO necesita decidirlos, no heredarlos.
*/
export async function crearFactura(
  conexion,
  { empresa, clienteId, usuario = null, total, fecha, correlativo, estado = "pendiente" }
) {
  const n = siguiente()

  return (
    await conexion.query(
      `insert into ventas (
         empresa_id, cliente_id, usuario_id,
         numero_factura, correlativo, fecha,
         nombre_cliente, subtotal, isv, tasa_isv, total,
         forma_pago, estado
       )
       values ($1, $2, $3, $4, $5, $6, 'Cliente de prueba', $7, 0, 15, $7,
               'credito', $8)
       returning id`,
      [
        empresa,
        clienteId,
        usuario,
        `FAC-${String(correlativo ?? n).padStart(5, "0")}`,
        correlativo ?? n,
        fecha ?? new Date().toISOString(),
        total,
        estado,
      ]
    )
  ).rows[0].id
}

/* Un abono contra la factura suelta, como el que crea el camino viejo. */
export async function crearAbonoLegado(conexion, { empresa, ventaId, monto }) {
  return (
    await conexion.query(
      `insert into abonos (empresa_id, venta_id, monto)
       values ($1, $2, $3) returning id`,
      [empresa, ventaId, monto]
    )
  ).rows[0].id
}

/* La deuda del cliente, con la misma regla que usa el sistema. */
export async function deudaDe(conexion, clienteId) {
  const r = await conexion.query(
    `select coalesce(sum(s.saldo), 0) as deuda from (
       select round(v.total - coalesce((
                select sum(a.monto) from abonos a where a.venta_id = v.id
              ), 0), 2) as saldo
         from ventas v
        where v.cliente_id = $1
          and v.forma_pago = 'credito'
          and v.estado <> 'anulada'
     ) s where s.saldo > 0`,
    [clienteId]
  )

  return Number(r.rows[0].deuda)
}

export async function contar(conexion, tabla, donde = "true", valores = []) {
  const r = await conexion.query(
    `select count(*)::int as n from ${tabla} where ${donde}`,
    valores
  )

  return r.rows[0].n
}

/*
  Un vendedor de una empresa que ya existe, con los permisos que pida el
  caso y, si se le da, una ubicación operativa.

  crearEmpresa() solo sabe hacer administradores, y un administrador tiene
  todos los permisos por definición: con él no se puede comprobar que
  `inventory-own` limite nada. La visibilidad por ubicación solo se puede
  probar con alguien que NO sea administrador.
*/
export async function crearVendedor(
  conexion,
  { empresa, ubicacion = null, permisos = [], activo = true } = {}
) {
  const n = siguiente()

  const authId = (
    await conexion.query(
      "insert into auth.users (email) values ($1) returning id",
      [`vendedor${n}@prueba.local`]
    )
  ).rows[0].id

  const usuario = (
    await conexion.query(
      `insert into usuarios (empresa_id, auth_id, email, nombre, rol, activo, ubicacion_id)
       values ($1, $2, $3, $4, 'vendedor', $5, $6) returning id`,
      [empresa, authId, `vendedor${n}@prueba.local`, `Vendedor ${n}`, activo, ubicacion]
    )
  ).rows[0].id

  for (const seccion of permisos) {
    await conexion.query(
      `insert into permisos_usuario (usuario_id, empresa_id, seccion)
       values ($1, $2, $3)`,
      [usuario, empresa, seccion]
    )
  }

  return { usuario, authId }
}
