import '@claude-alive/i18n';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Registering the (non-caching) service worker is what makes Chrome offer "Install app".
// Installing is the only way to drop the `localhost:3141` origin line the browser adds to
// every web notification — an installed app's notifications carry the app name instead.
// Failure is non-fatal: the dashboard works fine, notifications just keep the origin line.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[claude-alive] service worker registration failed', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
