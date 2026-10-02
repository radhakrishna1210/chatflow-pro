import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Recharts is only needed on the two analytics screens, and React
        // itself changes far less often than app code. Splitting both out
        // keeps the entry chunk small and lets them stay cached across
        // deploys instead of being re-downloaded with every app change.
        // React has to be named too: Recharts depends on it, and a chunk
        // listing only 'recharts' swallowed React with it, so the entry chunk
        // imported (and index.html preloaded) the whole charts chunk on every
        // page, the landing page included.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          // Recharts and its d3/redux/etc. dependencies — the only other
          // runtime packages the app ships.
          return 'charts';
        },
      },
    },
  },
  server: {
    port: 5173,
    // Landing.jsx imports the site copy from backend/src/data/siteContent.js —
    // one source of truth shared with the assistant's indexer. That path is
    // outside this package, so the dev server has to be told it may serve it.
    // Vite infers the same root from the repo lockfile today, but relying on
    // that inference means a lockfile move breaks `npm run dev` with a
    // confusing 403 instead of an error that names the cause.
    fs: { allow: [repoRoot] },
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
