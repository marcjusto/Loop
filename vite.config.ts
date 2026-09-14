import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    // The mini app is opened from a phone on the same network, so it has to
    // listen on the LAN, not just loopback.
    host: true,
    port: 5173,
    proxy: {
      // `npm run dev` gives hot reload; the API comes from `wrangler dev` on 8787.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
})
