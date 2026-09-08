import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/ferreteria.css'
import './index.css'

import {AuthProvider} from './context/AuthContext'
import ProductProvider from './context/ProductContext'
import SalesProvider from './context/SalesContext'
import ClientsProvider from './context/ClientsContext'
import LocationsProvider from './context/LocationsContext'
import QuotesProvider from './context/QuotesContext'

import { registrarServiceWorker } from './registrarServiceWorker'


ReactDOM.createRoot(document.getElementById('root')).render(

  <React.StrictMode>

    <AuthProvider>
      <ProductProvider>
        <ClientsProvider>
          <LocationsProvider>
            <SalesProvider>
              <QuotesProvider>
                <App />
              </QuotesProvider>
            </SalesProvider>
          </LocationsProvider>
        </ClientsProvider>
      </ProductProvider>
    </AuthProvider>

  </React.StrictMode>
)

registrarServiceWorker()
