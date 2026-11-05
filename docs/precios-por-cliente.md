# Precios especiales por cliente

Cada cliente puede tener productos habituales con un precio propio. Sin precio
especial, vale el precio general del catálogo.

## Reglas

- **Los cambia solo un administrador**, en Clientes, y se guardan con
  `guardar_precios_de_cliente()`: la lista completa, todo o nada. Un producto no se
  repite (`precios_por_cliente_unico`).
- **El servidor decide el precio de cada venta** con `precio_de_venta()`. No llega del
  navegador.
- **Sin cliente registrado se usa el precio general**, también con un nombre escrito a
  mano.
- **Las ventas ya hechas no cambian:** cada renglón guarda su precio.
- **No incluye costos.** Toda la empresa puede leer los precios, porque el POS los
  necesita; no pueden escribirlos.

## En el POS

Al elegir un cliente, sus habituales salen primero, con su precio. Si ya hay productos
en el carrito, se recalculan y se avisa. No se agrega nada solo. Mientras cargan los
precios, o si no se pudieron leer, no se puede facturar.

## Sin conexión

La copia local trae los precios de todos los clientes. La venta guarda el precio con el
que se cobró:

| Caso | Qué pasa |
|---|---|
| El precio sigue vigente al sincronizar | Se registra |
| El precio cambió mientras estaba sin conexión | Va a conciliación con lo cobrado (`precio-distinto`) |
| Copia anterior a esta versión | Vende al precio general; si no valía, va a conciliación |
| Reintento | La clave y la huella evitan duplicados |

## Despliegue

**Primero la 0042, después el frontend.** La versión publicada sigue funcionando, pero
una vez que un cliente tenga precios especiales, esa versión muestra el general: el
servidor rechaza un contado que no cuadre (`LM002`), y sin conexión va a conciliación.

## Fuera de esta fase

Precio negociado durante la venta y mínimos. Las cotizaciones usan el precio general; al
pasarlas al POS con un cliente, se recalculan y se avisa.
