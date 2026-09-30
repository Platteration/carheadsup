import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * The fonts' `.woff` fallbacks, dropped from the bundled @font-face rules: every browser that
 * runs the demo reads the `.woff2` files, and each fallback would cost as much again inlined.
 */
function woff2Only(): Plugin {
  return {
    name: 'carheadsup:woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@fontsource[\\/][^?]+\.css$/.test(id)) return null;
      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '');
    },
  };
}

/**
 * The drive simulator (`npm run build:demo`): `demo.html` as one bundle — one script, one
 * stylesheet, the fonts inlined as data: URIs — that `scripts/inline-demo.ts` then folds into a
 * single self-contained HTML file. The script includes the core's trouble-code database (the
 * alert rules decode codes), hence the higher chunk-size limit: nothing is split or lazy-loaded.
 */
export default defineConfig({
  root,
  base: './',
  plugins: [preact(), woff2Only()],
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: resolve(root, 'demo.html'),
      output: { codeSplitting: false },
    },
  },
});
