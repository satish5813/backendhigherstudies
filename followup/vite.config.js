import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development /api and /uploads go to the local backend; in production
// vercel.json (or nginx) forwards them the same way, so the app itself only
// ever uses relative paths.
const API = process.env.API_PROXY || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
