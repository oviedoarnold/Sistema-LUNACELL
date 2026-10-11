import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import PanelDeVentasLocales from "./PanelDeVentasLocales"

/*
  El respaldo cifrado es la salida de emergencia de un teléfono. Un
  administrador que entra en el teléfono de un vendedor tiene que poder
  respaldar también las ventas de ese vendedor.
*/
const estado = (cambios = {}) => ({
  ventas: [],
  sinConfirmar: 0,
  ventasDeOtrosUsuarios: 0,
  puedeRespaldarTodo: false,
  sincronizarAhora: vi.fn(),
  sincronizando: false,
  exportarRespaldo: vi.fn(),
  ...cambios,
})

const respaldo = () => screen.getByRole("button", { name: /respaldo cifrado/i })

describe("panel de ventas del teléfono: respaldo", () => {
  it("sin ventas propias sin confirmar, un vendedor no tiene nada que respaldar", () => {
    render(<PanelDeVentasLocales estado={estado({ ventasDeOtrosUsuarios: 2 })} onCerrar={() => {}} onVerComprobante={() => {}} />)

    expect(respaldo()).toBeDisabled()
    expect(screen.getByText(/2 ventas de otro usuario/i)).toBeInTheDocument()
  })

  it("un administrador puede respaldar las ventas de otros usuarios del teléfono", () => {
    render(
      <PanelDeVentasLocales
        estado={estado({ ventasDeOtrosUsuarios: 2, puedeRespaldarTodo: true })}
        onCerrar={() => {}}
        onVerComprobante={() => {}}
      />
    )

    expect(respaldo()).toBeEnabled()
  })
})
