// @vitest-environment happy-dom
import type { DtcInfo } from '@carheadsup/core';
import { lookupDtc } from '@carheadsup/core/dtc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadDtcLookup,
  onceDtcLookup,
  useDtcLookup,
  type DtcLookup,
  type DtcLookupLoader,
} from '../../src/dev/dtc-lookup.ts';
import { mount, settle, text } from '../settings/dom.ts';
import type { Mounted } from '../settings/dom.ts';

const fake: DtcLookup = (code) => ({ ...lookupDtc(code), short: `short ${code}` }) as DtcInfo;

/** A loader the test settles by hand. */
function deferredLoader() {
  const calls: Array<{ resolve: (fn: DtcLookup) => void; reject: (err: Error) => void }> = [];
  const load = vi.fn<DtcLookupLoader>(
    () =>
      new Promise<DtcLookup>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { load, calls };
}

describe('onceDtcLookup', () => {
  it('loads once and shares the result with every caller', async () => {
    const { load, calls } = deferredLoader();
    const once = onceDtcLookup(load);
    const a = once();
    const b = once();
    expect(load).toHaveBeenCalledTimes(1);
    calls[0]?.resolve(fake);
    expect(await a).toBe(fake);
    expect(await b).toBe(fake);
    expect(await once()).toBe(fake);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load so the next call retries', async () => {
    const { load, calls } = deferredLoader();
    const once = onceDtcLookup(load);
    const first = once();
    calls[0]?.reject(new Error('chunk failed to load'));
    await expect(first).rejects.toThrow('chunk failed to load');
    const second = once();
    expect(load).toHaveBeenCalledTimes(2);
    calls[1]?.resolve(fake);
    expect(await second).toBe(fake);
  });
});

describe('loadDtcLookup', () => {
  it('imports the real database lazily', async () => {
    const lookup = await loadDtcLookup();
    expect(lookup('p0420')).toEqual(lookupDtc('P0420'));
    expect(await loadDtcLookup()).toBe(lookup);
  });
});

describe('useDtcLookup', () => {
  let mounted: Mounted | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  function Probe({ load }: { load: DtcLookupLoader }) {
    const lookup = useDtcLookup(load);
    return <span>{lookup ? lookup('P0420').short : 'loading'}</span>;
  }

  it('is null until the database arrives, then the lookup', async () => {
    const { load, calls } = deferredLoader();
    mounted = mount(<Probe load={load} />);
    expect(text(mounted.container)).toBe('loading');
    calls[0]?.resolve(fake);
    await settle();
    expect(text(mounted.container)).toBe('short P0420');
  });

  it('stays null when loading fails', async () => {
    const { load, calls } = deferredLoader();
    mounted = mount(<Probe load={load} />);
    calls[0]?.reject(new Error('offline'));
    await settle();
    expect(text(mounted.container)).toBe('loading');
  });

  it('ignores a lookup that arrives after unmounting', async () => {
    const { load, calls } = deferredLoader();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mounted = mount(<Probe load={load} />);
    mounted.unmount();
    mounted = null;
    calls[0]?.resolve(fake);
    await settle();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
