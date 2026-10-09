import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './App';
import type { ComponentType } from 'react';

// Hosted demo (VITE_DEMO=1): the mock API runs in the page, and a strip switches panels.
let DemoBar: ComponentType | null = null;
if (import.meta.env.VITE_DEMO) {
  await import('./demo/inbrowser');
  const m = await import('./demo/DemoBar');
  DemoBar = m.DemoBar;
  if (!location.hash || location.hash === '#/' || location.hash === '#/login') m.signInAs('9847041736').catch(() => {});
}
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {DemoBar && <DemoBar />}
    <RouterProvider router={router} />
  </StrictMode>,
);

// Service worker: app shell only (see vite.config.ts). Not registered in dev or in the hosted demo.
if (import.meta.env.PROD && !import.meta.env.VITE_DEMO && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
