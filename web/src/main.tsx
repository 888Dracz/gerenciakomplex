import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { aplicarPrefs, leerPrefs } from './lib/prefs';
import { AppProvider } from './state/app';
import { UIProvider } from './state/ui';
import './styles/app.css';

aplicarPrefs(leerPrefs());

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
