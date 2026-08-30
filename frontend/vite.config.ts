import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    minify: false,
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
