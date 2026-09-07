import Navbar from "../components/Navbar"

function MainLayout({ children }) {
  return (
    <div className="app-shell">
      <div className="main-content">
        <Navbar />
        <main>
          {children}
        </main>
      </div>
    </div>
  )
}

export default MainLayout