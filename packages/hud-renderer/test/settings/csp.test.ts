// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The HUD serves its pages with `script-src 'self'`: anything that calls `new Function` is
 * refused and reported as a CSP violation. zod probes `new Function` for its JIT when a schema is
 * built unless `jitless` is set first, so the settings entry must switch that on before the core
 * schemas load. Modules are imported fresh here, so this test is the first to load zod.
 */

const original = globalThis.Function;

afterEach(() => {
  globalThis.Function = original;
});

describe('settings page and the CSP', () => {
  it('never constructs a function from a string while loading and validating', async () => {
    const calls: string[] = [];
    globalThis.Function = new Proxy(original, {
      construct(target, args: unknown[], newTarget) {
        calls.push(new Error('new Function').stack ?? '');
        return Reflect.construct(target, args, newTarget) as object;
      },
      apply(target, thisArg, args: unknown[]) {
        calls.push(new Error('Function()').stack ?? '');
        return Reflect.apply(target, thisArg, args) as unknown;
      },
    });
    await import('../../src/main-settings.tsx');
    const { DEFAULT_CONFIG, hudConfigSchema } = await import('@carheadsup/core');
    expect(hudConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
    globalThis.Function = original;
    expect(calls.filter((stack) => /[\\/]zod[\\/]/.test(stack))).toEqual([]);
  });
});
