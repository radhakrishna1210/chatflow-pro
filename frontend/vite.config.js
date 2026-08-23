import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  plugins: [react()],
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
