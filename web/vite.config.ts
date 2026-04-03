import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          'emoji-mart': ['emoji-mart', '@emoji-mart/data', '@emoji-mart/react'],
        },
      },
    },
  },
})
