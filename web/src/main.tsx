import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LegalPage } from './components/legal/LegalPage';
import { initSentry } from './utils/sentry';

// As early as possible (docs/STORE_LAUNCH_TZ.md §6) — no-op without
// VITE_SENTRY_DSN set.
initSentry();

// Register service worker early so app shell is cached before login.
// Only in production — dev has no bundled assets to precache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

// /privacy и /terms должны открываться БЕЗ авторизации по прямому URL (это
// требование сторов при подаче карточки) — нет клиентского роутера в проекте,
// поэтому пути перехватываются здесь, до рендера <App/>, минуя весь auth-флоу.
const path = window.location.pathname;
const legalPage = path === '/privacy' ? 'privacy' : path === '/terms' ? 'terms' : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {legalPage ? (
      <LegalPage page={legalPage} />
    ) : (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    )}
  </StrictMode>,
);
