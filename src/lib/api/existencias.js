import { supabase } from "../supabase"

/*
  La existencia por ubicación, leída de `existencias_por_ubicacion`.

  La vista es el contrato de lectura que aprobó INV-2.1, y se consulta ella
  y no `inventario_ubicacion` por una razón que no es de estilo: la tabla
  guarda el cero como ausencia de fila, así que leerla directamente
  obligaría a esta capa a reconstruir la cuadrícula de ubicaciones por
  producto. Y reconstruirla aquí es exactamente cómo se fabrica un cero
  falso para una ubicación que el usuario no puede ver.

  La vista ya hizo ese trabajo del lado correcto: parte de las ubicaciones
  visibles, de modo que una que el usuario puede consultar y no tiene el
  producto llega con 0, y una que no puede consultar no llega.

  Aquí no se decide nada de permisos. No se envía `empresa_id`, no se
  filtra por ubicación y no se consulta el rol: eso lo resuelven la
  política de la base y las funciones de la 0015 contra `auth.uid()`. Si
  esta capa intentara ayudar, acabaría contradiciendo al motor.
*/

/*
  Las columnas se nombran una por una en vez de pedir `*`.

  No es cosmético: la vista hoy no expone costo, margen, utilidad ni
  precio, y el día que alguien le añada una columna, `*` la traería al
  navegador sin que nadie lo hubiera decidido. Nombrarlas deja el contrato
  escrito donde se lee.
*/
const COLUMNAS = [
  "ubicacion_id",
  "ubicacion",
  "ubicacion_tipo",
  "producto_id",
  "codigo",
  "producto",
  "cantidad",
].join(", ")

export const aExistenciaDeApp = (fila) => ({
  locationId: fila.ubicacion_id,
  locationName: fila.ubicacion,
  locationType: fila.ubicacion_tipo,
  productId: fila.producto_id,
  code: fila.codigo || "",
  productName: fila.producto,
  quantity: Number(fila.cantidad) || 0,
})

export async function traerExistenciasPorUbicacion() {
  const { data, error } = await supabase
    .from("existencias_por_ubicacion")
    .select(COLUMNAS)
    .order("producto")
    .order("ubicacion")

  if (error) {
    console.error("No se pudo cargar la existencia por ubicación:", error)

    throw new Error("No se pudo cargar la existencia por ubicación.")
  }

  return (data || []).map(aExistenciaDeApp)
}
