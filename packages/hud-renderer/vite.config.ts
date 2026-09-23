import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const server = process.env.HUD_SERVER ?? 'http://localhost:8080';

/** Core's trouble-code modules: the lookup, the merged table and the per-range data files. */
const DTC_MODULE = /[\\/]core[\\/]src[\\/]obd[\\/](dtc-lookup|dtc-database|dtc-db-[\w-]+)\.ts$/;

/**
 * Chunk for a trouble-code module: each data file on its own (each well under the 500 kB warning
 * limit, and fetched in parallel), the lookup and merged table together. Only the dev console
 * reaches them, through a dynamic `import('@carheadsup/core/dtc')`, so no page loads them eagerly.
 */
export function dtcChunkName(moduleId: string): string | null {
  const name = DTC_MODULE.exec(moduleId)?.[1];
  if (name === undefined) return null;
  return name.startsWith('dtc-db-') ? name : 'dtc';
}

export default defineConfig({
  root,
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        hud: resolve(root, 'index.html'),
        settings: resolve(root, 'settings.html'),
        dev: resolve(root, 'dev.html'),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              debugName: 'dtc',
              name: dtcChunkName,
              // Keep the codes' shared helpers (normalizeDtc …) out of these chunks, or pages
              // that use only the helpers would statically import the database with them.
              includeDependenciesRecursively: false,
            },
          ],
        },
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
