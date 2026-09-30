/**
 * Builds the drive simulator as `npm run build:demo` does (into a temporary directory) and checks
 * what the single-file pages carry: one script and one stylesheet folded in without warnings (a
 * Node.js module reaching the bundle would warn), no request of any kind, only the woff2 fonts,
 * and a size far under the 16 MB an artifact may have.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createLogger } from 'vite';
import type { Logger } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { externalReferences, inlineBuild } from '../../scripts/inline-demo.ts';

const rendererRoot = fileURLToPath(new URL('../../', import.meta.url));

let outDir = '';
let assets: string[] = [];
let warnings: string[] = [];
let pages: { document: string; fragment: string };

function recordingLogger(into: string[]): Logger {
  const base = createLogger('warn', { allowClearScreen: false });
  return {
    ...base,
    info: () => undefined,
    warn: (msg) => void into.push(msg),
    warnOnce: (msg) => void into.push(msg),
    error: (msg) => void into.push(msg),
  };
}

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'hud-renderer-demo-'));
  warnings = [];
  await build({
    configFile: join(rendererRoot, 'vite.demo.config.ts'),
    root: rendererRoot,
    logLevel: 'warn',
    customLogger: recordingLogger(warnings),
    build: { outDir, emptyOutDir: true, reportCompressedSize: false },
  });
  assets = (await readdir(join(outDir, 'assets'))).sort();
  pages = await inlineBuild(outDir);
}, 120_000);

afterAll(async () => {
  if (outDir !== '') await rm(outDir, { recursive: true, force: true });
});

const script = (html: string): string =>
  /<script type="module">([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';

describe('drive simulator build', () => {
  it('bundles one script and one stylesheet, without warnings', () => {
    expect(warnings).toEqual([]);
    expect(assets.map((file) => file.replace(/-[\w-]+\./, '.'))).toEqual(['demo.js', 'style.css']);
  });

  it('makes pages that request nothing and stay small', () => {
    for (const html of [pages.document, pages.fragment]) {
      expect(externalReferences(html)).toEqual([]);
      expect(Buffer.byteLength(html)).toBeLessThan(1.5 * 1024 * 1024);
    }
    expect(pages.fragment.startsWith('<title>carheadsup Drive Simulator</title>\n<style>')).toBe(
      true,
    );
    const code = script(pages.document);
    expect(code.length).toBeGreaterThan(100_000);
    for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'import(', 'alert(', 'confirm(']) {
      expect(code, api).not.toContain(api);
    }
  });

  it('inlines the four B612 faces as woff2 only', () => {
    const fonts = [...pages.document.matchAll(/url\(data:font\/(\w+);base64,/g)].map((m) => m[1]);
    expect(fonts).toEqual(['woff2', 'woff2', 'woff2', 'woff2']);
    expect(pages.document).not.toMatch(/\.woff2?\b/);
  });
});
