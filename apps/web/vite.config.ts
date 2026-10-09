import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Real API by default. VITE_MOCK=1 uses the dev-only mock in dev/mock-api.ts (port 4300); CITRUS_API overrides both.
const API = process.env.CITRUS_API ?? (process.env.VITE_MOCK === '1' ? 'http://localhost:4300' : 'http://localhost:4000');

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CITRUS Trade',
        short_name: 'CITRUS Trade',
        description: 'Order CITRUS menswear for your store: live stock, your usual sizes, rewards.',
        theme_color: '#0F1B2D',
        background_color: '#F3F4F3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en-IN',
        categories: ['business', 'shopping'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // App shell only. API responses (orders, cart, stock) are never cached by the service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/webhooks\//],
        runtimeCaching: [
          {
            // CITRUS product photos: cached on first view so the catalogue stays visual offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/photos/'),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/webhooks': { target: API, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/webhooks': { target: API, changeOrigin: true },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
