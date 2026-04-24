import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Shared emoji library — used by EmojiStickerPanel, EmojiPicker, StickerStudioModal
          if (id.includes('node_modules/@emoji-mart') || id.includes('node_modules/emoji-mart')) {
            return 'emoji';
          }
          // Sticker studio + emoji panel (heavy, opened on demand)
          if (
            id.includes('StickerStudioModal') ||
            id.includes('EmojiStickerPanel') ||
            id.includes('EmojiPackSection') ||
            id.includes('StickersTab')
          ) {
            return 'stickers';
          }
          // Video/media trimming (opened on demand inside sticker studio)
          if (id.includes('VideoTrimmerModal')) {
            return 'media';
          }
        },
      },
    },
  },
})
