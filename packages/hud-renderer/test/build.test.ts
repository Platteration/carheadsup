/**
 * Builds the renderer exactly as `vite build` does (in memory) and checks what each page loads
 * before any interaction: the projected HUD must stay free of zod and the trouble-code
 * database, the settings app must not carry the database either, the dev console may only load
 * it lazily, and no chunk may trip Vite's large-chunk warning. Catches an innocent-looking
 * `import { lookupDtc } from '@carheadsup/core'` long before it ships 600 kB to the car.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createLogger } from 'vite';
import type { Logger, Rolldown } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dtcChunkName } from '../vite.config.ts';

const rendererRoot = fileURLToPath(new URL('../', import.meta.url));

/** Vite's default `build.chunkSizeWarningLimit`, in kB of minified code. */
const CHUNK_WARNING_KB = 500;

const DTC_MODULE = /[\\/]core[\\/]src[\\/]obd[\\/](?:dtc-lookup|dtc-database|dtc-db-[\w-]+)\.ts$/;
const ZOD_MODULE = /[\\/]node_modules[\\/]zod[\\/]/;

type Chunk = Rolldown.OutputChunk;

interface BuildResult {
  chunks: Map<string, Chunk>;
  pages: Map<string, string>;
  warnings: string[];
}

let outDir = '';
let result: BuildResult;

/** A logger that records warnings and errors instead of printing them. */
function recordingLogger(warnings: string[]): Logger {
  const base = createLogger('warn', { allowClearScreen: false });
  return {
    ...base,
    info: () => undefined,
    warn: (msg) => void warnings.push(msg),
    warnOnce: (msg) => void warnings.push(msg),
    error: (msg) => void warnings.push(msg),
  };
}

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'hud-renderer-build-'));
  const warnings: string[] = [];
  const output = await build({
    configFile: join(rendererRoot, 'vite.config.ts'),
    root: rendererRoot,
    logLevel: 'warn',
    customLogger: recordingLogger(warnings),
    build: { outDir, emptyOutDir: true, write: false, reportCompressedSize: false },
  });
  const bundles = Array.isArray(output) ? output : [output];
  const chunks = new Map<string, Chunk>();
  const pages = new Map<string, string>();
  for (const bundle of bundles) {
    if (!('output' in bundle)) throw new Error('expected a build output, got a watcher');
    for (const item of bundle.output) {
      if (item.type === 'chunk') chunks.set(item.fileName, item);
      else if (item.fileName.endsWith('.html') && typeof item.source === 'string') {
        pages.set(item.fileName, item.source);
      }
    }
  }
  result = { chunks, pages, warnings };
}, 120_000);

afterAll(async () => {
  if (outDir !== '') await rm(outDir, { recursive: true, force: true });
});

/** JS files a page loads up front: its entry script, modulepreloads and their static imports. */
function eagerChunks(page: string): Chunk[] {
  const html = result.pages.get(page);
  if (html === undefined) throw new Error(`no ${page} in the build`);
  const queue = [...html.matchAll(/(?:src|href)="\/([^"]+\.js)"/g)].map((m) => m[1] ?? '');
  const seen = new Map<string, Chunk>();
  while (queue.length > 0) {
    const file = queue.shift() ?? '';
    if (seen.has(file)) continue;
    const chunk = result.chunks.get(file);
    if (chunk === undefined) throw new Error(`${page} references ${file}, which was not built`);
    seen.set(file, chunk);
    queue.push(...chunk.imports);
  }
  return [...seen.values()];
}

/** Modules whose code actually made it into the chunks (tree-shaken modules excluded). */
function renderedModules(chunks: readonly Chunk[]): string[] {
  return chunks.flatMap((chunk) =>
    Object.entries(chunk.modules)
      .filter(([, info]) => info.renderedLength > 0)
      .map(([id]) => id),
  );
}

/** Chunks reachable from `chunks` through static and dynamic imports. */
function reachableChunks(chunks: readonly Chunk[]): Chunk[] {
  const queue = chunks.map((c) => c.fileName);
  const seen = new Map<string, Chunk>();
  while (queue.length > 0) {
    const file = queue.shift() ?? '';
    const chunk = result.chunks.get(file);
    if (chunk === undefined || seen.has(file)) continue;
    seen.set(file, chunk);
    queue.push(...chunk.imports, ...chunk.dynamicImports);
  }
  return [...seen.values()];
}

describe('renderer build', () => {
  it('builds the three pages without warnings', () => {
    expect([...result.pages.keys()].sort()).toEqual(['dev.html', 'index.html', 'settings.html']);
    expect(result.warnings).toEqual([]);
  });

  it('keeps every chunk under Vite’s large-chunk warning limit', () => {
    const large = [...result.chunks.values()]
      .filter((chunk) => chunk.code.length / 1000 > CHUNK_WARNING_KB)
      .map((chunk) => `${chunk.fileName} ${Math.round(chunk.code.length / 1000)} kB`);
    expect(large).toEqual([]);
  });

  it('keeps zod and the trouble-code database off the projected HUD', () => {
    const modules = renderedModules(eagerChunks('index.html'));
    expect(modules.length).toBeGreaterThan(0);
    expect(modules.filter((id) => ZOD_MODULE.test(id))).toEqual([]);
    expect(modules.filter((id) => DTC_MODULE.test(id))).toEqual([]);
    // Nothing the kiosk could load later carries them either.
    const later = renderedModules(reachableChunks(eagerChunks('index.html')));
    expect(later.filter((id) => ZOD_MODULE.test(id) || DTC_MODULE.test(id))).toEqual([]);
  });

  it('keeps the trouble-code database out of the settings app', () => {
    const modules = renderedModules(reachableChunks(eagerChunks('settings.html')));
    // The settings app validates config with the shared zod schema…
    expect(modules.some((id) => ZOD_MODULE.test(id))).toBe(true);
    // …but shows the server's decoded trouble codes, so never needs the database.
    expect(modules.filter((id) => DTC_MODULE.test(id))).toEqual([]);
  });

  it('loads the database into the dev console lazily, split into its own chunks', () => {
    const eager = renderedModules(eagerChunks('dev.html'));
    expect(eager.filter((id) => DTC_MODULE.test(id))).toEqual([]);
    const lazy = reachableChunks(eagerChunks('dev.html')).filter((chunk) =>
      Object.keys(chunk.modules).some((id) => DTC_MODULE.test(id)),
    );
    expect(lazy.map((chunk) => chunk.name).sort()).toEqual([
      'dtc',
      'dtc-db-network',
      'dtc-db-p0',
      'dtc-db-p2',
    ]);
  });
});

describe('dtcChunkName', () => {
  it('names each trouble-code data module, the lookup and table together', () => {
    const obd = '/repo/packages/core/src/obd/';
    expect(dtcChunkName(`${obd}dtc-db-p0.ts`)).toBe('dtc-db-p0');
    expect(dtcChunkName(`${obd}dtc-db-network.ts`)).toBe('dtc-db-network');
    expect(dtcChunkName(`${obd}dtc-database.ts`)).toBe('dtc');
    expect(dtcChunkName(`${obd}dtc-lookup.ts`)).toBe('dtc');
    expect(dtcChunkName('C:\\repo\\packages\\core\\src\\obd\\dtc-db-p2.ts')).toBe('dtc-db-p2');
  });

  it('leaves everything else to automatic chunking', () => {
    const obd = '/repo/packages/core/src/obd/';
    expect(dtcChunkName(`${obd}dtc.ts`)).toBeNull();
    expect(dtcChunkName(`${obd}dtc-ranges.ts`)).toBeNull();
    expect(dtcChunkName('/repo/packages/core/src/dtc.ts')).toBeNull();
    expect(dtcChunkName('/repo/packages/hud-renderer/src/dev/dtc-lookup.ts')).toBeNull();
  });
});
