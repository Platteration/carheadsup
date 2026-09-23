import type { DtcInfo } from '@carheadsup/core';
import { useEffect, useState } from 'preact/hooks';

/**
 * Trouble-code descriptions for the dev console, loaded on demand. The description database
 * (`@carheadsup/core/dtc`) is several hundred kB, so it lives in its own lazily loaded chunks
 * instead of the console's startup bundle; until it arrives, codes are shown without labels.
 */

/** Describe a trouble code (`lookupDtc` from `@carheadsup/core/dtc`). */
export type DtcLookup = (code: string) => DtcInfo;

/** Fetches the lookup; resolves once the database chunk has loaded. */
export type DtcLookupLoader = () => Promise<DtcLookup>;

/**
 * Wrap `load` so it runs at most once while it succeeds: concurrent and later callers share the
 * same promise. A failed load is forgotten, so the next call (e.g. the next mount) retries.
 */
export function onceDtcLookup(load: DtcLookupLoader): DtcLookupLoader {
  let pending: Promise<DtcLookup> | null = null;
  return () => {
    pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  };
}

/** The console's shared loader: a dynamic import, so bundlers split the database out. */
export const loadDtcLookup: DtcLookupLoader = onceDtcLookup(() =>
  import('@carheadsup/core/dtc').then((m) => m.lookupDtc),
);

/**
 * `lookupDtc` once loaded, else null (still loading, or the chunk failed to load — callers then
 * show bare codes). Starts loading on first mount.
 */
export function useDtcLookup(load: DtcLookupLoader = loadDtcLookup): DtcLookup | null {
  const [lookup, setLookup] = useState<DtcLookup | null>(null);
  useEffect(() => {
    let mounted = true;
    load().then(
      (fn) => {
        if (mounted) setLookup(() => fn);
      },
      () => {
        // Labels are a convenience; the controls work with bare codes.
      },
    );
    return () => {
      mounted = false;
    };
  }, [load]);
  return lookup;
}
