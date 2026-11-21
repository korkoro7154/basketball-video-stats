import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './portal/portal.css'
import { PortalApp } from './portal/PortalApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PortalApp />
  </StrictMode>,
)
