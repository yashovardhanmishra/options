import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA service worker is DISABLED while the coming-soon gate is up. Registering /sw.js now
// would fetch the Caddy kill-switch worker (which reloads the tab) and loop for logged-in
// users. Instead, proactively remove any leftover worker + its caches so no stale app-shell
// is ever served in front of the gate. Re-enable registration when the site goes fully public.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {})
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {})
  }
}
