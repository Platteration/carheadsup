/**
 * The browser-safe entry points — `@carheadsup/obd/sim` and `/runtime`,
 * `@carheadsup/hud-server/sim` and `/engine` — run the simulation and the engine inside the
 * renderer's in-browser demo, so nothing they load at run time may be a Node.js built-in or a
 * Node-only package. The test follows every value import (static, re-export and dynamic; `import
 * type` is erased) from each entry through the workspace packages.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
/** Third-party packages the browser entries may use (all browser-safe). */
const BROWSER_SAFE_DEPENDENCIES: ReadonlySet<string> = new Set(['zod']);

function packageEntry(specifier: string): string {
  const [, name = '', sub = ''] = /^@carheadsup\/([^/]+)(?:\/(.+))?$/.exec(specifier) ?? [];
  const dir = join(PACKAGES, name);
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    exports: Record<string, string>;
  };
  const target = manifest.exports[sub === '' ? '.' : `./${sub}`];
  if (target === undefined) throw new Error(`${specifier} is not exported`);
  return resolve(dir, target);
}

/** Specifiers of the imports that survive compilation (comments removed first). */
function valueImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const found: string[] = [];
  // An import clause (`x`, `{ a, type B }`, `* as ns`) has no quotes, `=`, `(` or `;`, so a
  // match cannot run on into the next statement.
  const statements =
    /(?:^|[;\n])\s*(import|export)\s+(type\s+)?(?:[^;'"=()]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(statements)) if (m[2] === undefined) found.push(m[3] ?? '');
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1] ?? '');
  return found;
}

/** Imports reachable from `entry` that a browser cannot load, as "importer → specifier". */
function nodeOnlyImports(entry: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const queue = [packageEntry(entry)];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of valueImports(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else if (specifier.startsWith('@carheadsup/')) queue.push(packageEntry(specifier));
      else if (!BROWSER_SAFE_DEPENDENCIES.has(specifier)) {
        problems.push(`${file.slice(PACKAGES.length)} → ${specifier}`);
      }
    }
  }
  return problems;
}

describe('browser-safe entry points', () => {
  it.each([
    '@carheadsup/obd/sim',
    '@carheadsup/obd/runtime',
    '@carheadsup/hud-server/sim',
    '@carheadsup/hud-server/engine',
  ])('%s loads no Node.js built-ins or Node-only packages', (entry) => {
    expect(nodeOnlyImports(entry)).toEqual([]);
  });

  it('catches them where they are (the main entries use sockets and serial ports)', () => {
    expect(nodeOnlyImports('@carheadsup/obd')).toEqual(
      expect.arrayContaining([expect.stringMatching(/transport\.ts → node:net$/)]),
    );
    expect(nodeOnlyImports('@carheadsup/hud-server').length).toBeGreaterThan(0);
  });

  it('serves the same simulator class through both obd entries', async () => {
    const [main, sim] = await Promise.all([
      import('@carheadsup/obd'),
      import('@carheadsup/obd/sim'),
    ]);
    expect(sim.VehicleSimulator).toBe(main.VehicleSimulator);
    expect(sim.DEMO_SCENARIO).toBe(main.DEMO_SCENARIO);
  });
});
