import AppRouter from "./routes/AppRouter"
import AvisoDeActualizacion from "./components/AvisoDeActualizacion"

/*
  El aviso de versión nueva vive fuera de las rutas: tiene que aparecer en
  cualquier pantalla, también en el inicio de sesión.
*/
function App() {
  return (
    <>
      <AvisoDeActualizacion />
      <AppRouter />
    </>
  )
}

export default App