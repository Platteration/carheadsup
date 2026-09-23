/**
 * The package's two entry points: the main index (everything a page or the server needs) and
 * `@carheadsup/core/dtc` (the large trouble-code database). Browser bundles stay lean only while
 * the database is reachable through the second one alone and the package is declared free of
 * side effects, so bundlers may drop whatever a page does not use.
 */
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as dtc from '../src/dtc.ts';
import * as core from '../src/index.ts';
import { lookupDtc as internalLookup } from '../src/obd/dtc-lookup.ts';

describe('package entry points', () => {
  it('maps the main index and the DTC database to their modules (imported above)', () => {
    expect(pkg.exports).toEqual({ '.': './src/index.ts', './dtc': './src/dtc.ts' });
  });

  it('declares the package free of side effects (it does no I/O at import time)', () => {
    expect(pkg.sideEffects).toBe(false);
  });

  it('keeps the database and its lookup out of the main index', () => {
    const names = Object.keys(core);
    expect(names).not.toContain('lookupDtc');
    expect(names).not.toContain('DTC_DATABASE');
    // The light code helpers stay available to every consumer.
    for (const name of [
      'normalizeDtc',
      'isValidDtc',
      'decodeDtcBytes',
      'parseDtcPayload',
      'describeDtcRange',
      'DTC_SHORT_MAX_LENGTH',
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it('serves the lookup and database from @carheadsup/core/dtc', async () => {
    expect(Object.keys(dtc).sort()).toEqual(['DTC_DATABASE', 'lookupDtc']);
    expect(dtc.lookupDtc).toBe(internalLookup);
    expect(dtc.lookupDtc(' p0420 ')).toMatchObject({ code: 'P0420', known: true });
    expect(Object.keys(dtc.DTC_DATABASE).length).toBeGreaterThan(4000);
    // Resolvable by package name, as the renderer and server import it.
    const viaName = await import('@carheadsup/core/dtc');
    expect(viaName.lookupDtc('U0100').code).toBe('U0100');
  });
});
