import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom"

import Landing from "../pages/Landing"
import NotFound from "../pages/NotFound"
import Demo from "../pages/Demo"
import Login from "../pages/Login"
import Dashboard from "../pages/Dashboard"
import Products from "../pages/Products"
import POS from "../pages/POS"
import Quotes from "../pages/Quotes"
import SalesHistory from "../pages/SalesHistory"
import Clients from "../pages/Clients"
import Suppliers from "../pages/Suppliers"
import Settings from "../pages/Settings"
import MainLayout from "../layouts/MainLayout"
import ProtectedRoute from "./ProtectedRoute"
import { PERMISSIONS } from "../context/permissions"

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* LANDING */}
        <Route
          path="/"
          element={<Landing />}
        />

        {/* LOGIN */}
        <Route
          path="/login"
          element={<Login />}
        />

        {/* DEMOSTRACION GUIADA */}
        <Route
          path="/demo"
          element={<Demo />}
        />

        {/* DASHBOARD */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute permission={PERMISSIONS.DASHBOARD}>
              <MainLayout>
                <Dashboard />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* PRODUCTOS */}
        <Route
          path="/products"
          element={
            <ProtectedRoute permission={PERMISSIONS.PRODUCTS}>
              <MainLayout>
                <Products />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* CLIENTES */}
        <Route
          path="/clients"
          element={
            <ProtectedRoute permission={PERMISSIONS.CLIENTS}>
              <MainLayout>
                <Clients />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* FACTURAR */}
        <Route
          path="/pos"
          element={
            <ProtectedRoute permission={PERMISSIONS.POS}>
              <MainLayout>
                <POS />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* COTIZAR */}
        <Route
          path="/quotes"
          element={
            <ProtectedRoute permission={PERMISSIONS.QUOTES}>
              <MainLayout>
                <Quotes />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* HISTORIAL */}
        <Route
          path="/sales-history"
          element={
            <ProtectedRoute permission={PERMISSIONS.SALES_HISTORY}>
              <MainLayout>
                <SalesHistory />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* PROVEEDORES */}
        <Route
          path="/suppliers"
          element={
            <ProtectedRoute permission={PERMISSIONS.SUPPLIERS}>
              <MainLayout>
                <Suppliers />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        {/* CONFIGURACIÓN */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute permission={PERMISSIONS.SETTINGS}>
              <MainLayout>
                <Settings />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* 404 */}
        <Route
          path="*"
          element={<NotFound />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default AppRouter