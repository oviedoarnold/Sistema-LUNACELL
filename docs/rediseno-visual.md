# Rediseño visual de LUNACELL

Dirección aprobada por el cliente y referencia para las fases siguientes.
Los valores viven en `src/styles/tokens.css`; aquí solo se explica qué se
busca y qué queda pendiente.

## Lenguaje visual

Un ERP moderno, no una plantilla ni una landing dentro del sistema:

- navegación lateral en carbón;
- área de trabajo en gris muy claro, casi blanco;
- tarjetas blancas con borde suave y elevación mínima;
- dorado metálico y sobrio, solo como acento;
- alta densidad de información sin saturar.

Lo que se descartó: el tono beige de la primera propuesta, los fondos
dorados grandes y las sombras pesadas.

## Paleta

| | |
|---|---|
| Navegación | `#171A1D` |
| Área de trabajo | `#F7F7F5` |
| Tarjetas | `#FFFFFF` |
| Texto principal | `#181A1D` |
| Dorado de marca | `#C89C32` |

El dorado aparece en la acción primaria, el elemento activo de la
navegación, los indicadores y los detalles de marca. No en fondos
grandes, ni en todas las tarjetas, ni en todos los botones.

Los estados —éxito, advertencia, peligro, información— son colores
propios y no se convierten en dorado: el dorado es marca y acción, no
significa nada por sí mismo.

## Estructura que debe buscar la fase B

```
┌────────────────┬──────────────────────────────────┐
│ [ LOGO ]       │  Topbar: título · usuario        │
│                ├──────────────────────────────────┤
│ Dashboard      │                                  │
│ Facturar       │  Contenido claro:                │
│ Cotizaciones   │    tarjetas                      │
│                │    tablas                        │
│ Productos      │    gráficos                      │
│ Ubicaciones    │                                  │
│                │                                  │
│ Clientes       │                                  │
│ Proveedores    │                                  │
│                │                                  │
│ Historial      │                                  │
│                │                                  │
│ Configuración  │                                  │
└────────────────┴──────────────────────────────────┘
```

Los tokens `--sidebar-*` ya existen para que esa fase no tenga que
inventar la paleta oscura.

No se añaden módulos que todavía no existen. Cuentas por cobrar y
Reportes tendrán su sitio cuando se construyan; un menú con elementos
muertos invita a pulsarlos.

## Pendiente: el logo oficial

El sistema todavía muestra un emoji donde debería ir la marca.

Hace falta el archivo original de **LunaCell & ASOCIADOS** —media luna
dorada, teléfono oscuro, texto dorado y subtítulo oscuro— colocado en:

```
public/brand/lunacell-logo.png
```

Idealmente en PNG con fondo transparente, o en SVG. Si solo existe una
versión con fondo blanco, se conserva tal cual: recortar el fondo a mano
degrada los bordes del texto y del símbolo.

Mientras no esté, no se sustituye por nada: ni emoji, ni un logo
dibujado, ni una aproximación.

Dónde irá cuando llegue: portada, inicio de sesión y cabecera de la
navegación lateral. No hace falta repetirlo en cada pantalla; las
facturas y cotizaciones impresas ya llevan su propia cabecera.
