# La página /demo

`/demo` es una página **pública** que repasa los módulos del sistema y
separa los que ya funcionan de los que están planificados. Vive en
[`src/pages/Demo.jsx`](../src/pages/Demo.jsx).

## Qué no es

No es un acceso de prueba. **No publica ninguna credencial.**

La versión anterior sí lo hacía: enseñaba un usuario y una contraseña para
que cualquiera entrara a mirar el sistema de la ferretería. Esa cuenta era
de otro proyecto y ya no existe, y publicar credenciales en una página
abierta no es algo que convenga reponer: cualquiera que la lea entra, y lo
que registre queda guardado para todos los demás.

Quien tenga acceso entra por `/login` con su propia cuenta.

## Por qué distingue lo disponible de lo planificado

Un módulo que todavía no existe, presentado como terminado, es la forma más
rápida de que alguien cuente con él para trabajar y se encuentre con que no
está. Cada tarjeta lleva su etiqueta, y lo planificado va bajo un aviso que
lo dice sin rodeos.

**Al terminar un módulo hay que moverlo de `PLANIFICADO` a `DISPONIBLE`**
en el arreglo `MODULOS` de `Demo.jsx`. Las pruebas comprueban que la
separación existe y que ninguna credencial vuelve a la página, pero no
pueden saber si un módulo ya está hecho: eso queda en manos de quien lo
termine.
