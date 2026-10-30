import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './api'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
