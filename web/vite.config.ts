import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest: we supply the SW source; workbox injects the precache list
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',

      // SW registration is handled manually in main.tsx (prod-only) and push.ts
      injectRegister: null,

      manifest: {
        name: 'мои близкие',
        short_name: 'Blizkie',
        description: 'Приватный мессенджер',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },

      // SW is not useful during `vite dev` (no bundled assets to precache)
      devOptions: { enabled: false },
    }),
  ],

  build: {
    chunkSizeWarningLimit: 1600,
    // No manualChunks: the lazy() boundaries (EmojiStickerPanel, StickerStudioModal,
    // VideoTrimmerModal, modals, …) already define natural async split points. Forcing
    // named manual chunks made the bundler hoist them into the entry's modulepreload
    // graph, so the heavy emoji-mart dataset (~500 KB) downloaded on first paint even
    // though no one had opened the picker. Letting the splitter follow the dynamic
    // imports keeps that weight off the initial load.
  },
})
