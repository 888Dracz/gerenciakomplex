import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { aplicarPrefs, leerPrefs } from './lib/prefs';
import { AppProvider } from './state/app';
import { UIProvider } from './state/ui';
import './styles/app.css';

aplicarPrefs(leerPrefs());

// Versión web: el service worker guarda la página para abrirla sin internet e instalarla como app.
if (__MODO_WEB__ && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo sin conexión */ });
  });
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    {/* Los modales se pintan dentro de UIProvider: tiene que ir dentro de AppProvider. */}
    <AppProvider>
      <UIProvider>
        <App />
      </UIProvider>
    </AppProvider>
  </StrictMode>,
);
