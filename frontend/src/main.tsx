import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installXREmulatorIfNeeded } from './xrEmulator'

// Must run before the globe asks which XR session modes are supported.
await installXREmulatorIfNeeded()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
