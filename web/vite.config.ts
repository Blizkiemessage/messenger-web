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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@emoji-mart') || id.includes('node_modules/emoji-mart')) {
            return 'emoji';
          }
          if (
            id.includes('StickerStudioModal') ||
            id.includes('EmojiStickerPanel') ||
            id.includes('EmojiPackSection') ||
            id.includes('StickersTab')
          ) {
            return 'stickers';
          }
          if (id.includes('VideoTrimmerModal')) {
            return 'media';
          }
        },
      },
    },
  },
})
