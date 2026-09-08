import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/archivo'
import '@fontsource-variable/jetbrains-mono'
import PlatformRouter from './platform/PlatformRouter'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlatformRouter />
  </React.StrictMode>,
)
