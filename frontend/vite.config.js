import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Recharts is only needed on the two analytics screens, and React
        // itself changes far less often than app code. Splitting both out
        // keeps the entry chunk small and lets them stay cached across
        // deploys instead of being re-downloaded with every app change.
        // Only Recharts is worth separating. React is needed on first paint
        // either way, so splitting it saved nothing and cost an extra
        // request; Recharts is used by two screens and is half the bundle.
        manualChunks: {
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
  },
});
