import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    minify: mode === 'production',
    sourcemap: mode !== 'production',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
}))
