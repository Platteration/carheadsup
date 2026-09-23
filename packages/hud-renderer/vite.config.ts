import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const server = process.env.HUD_SERVER ?? 'http://localhost:8080';

export default defineConfig({
  root,
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        hud: resolve(root, 'index.html'),
        settings: resolve(root, 'settings.html'),
        dev: resolve(root, 'dev.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': server,
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
    },
  },
});
