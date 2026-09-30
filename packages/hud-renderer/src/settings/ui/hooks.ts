import { GENERATED_TOKEN_ALPHABET, GENERATED_TOKEN_LENGTH } from '@carheadsup/core';
import type { RefObject } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { isAbortError } from '../../common/api.ts';

export interface Resource<T> {
  data: T | null;
  /** The last load's error; `data` keeps the previous successful value. */
  error: unknown;
  loading: boolean;
  /** Epoch ms of the last successful load. */
  loadedAt: number | null;
  reload: () => void;
  /** Replace the data locally (e.g. with a mutation's response). */
  setData: (data: T) => void;
}

export interface ResourceOptions {
  /** Poll interval; null or 0 loads once (plus `reload`). */
  pollMs?: number | null;
  /** False pauses loading and polling (e.g. section scrolled away, tab hidden). */
  enabled?: boolean;
}

/**
 * Load (and optionally poll) something from the HUD. Requests are aborted on unmount and never
 * overlap; a failed poll keeps the last data but reports `error`, so callers can mark it stale.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  options: ResourceOptions = {},
): Resource<T> {
  const { pollMs = null, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const next = await loadRef.current(controller.signal);
        if (!active) return;
        setData(next);
        setError(null);
        setLoadedAt(Date.now());
      } catch (err) {
        if (!active || isAbortError(err)) return;
        setError(err);
      } finally {
        if (active) setLoading(false);
      }
      if (active && pollMs !== null && pollMs > 0) timer = setTimeout(run, pollMs);
    };
    void run();
    return () => {
      active = false;
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled, pollMs, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const replace = useCallback((next: T) => {
    setData(next);
    setError(null);
    setLoadedAt(Date.now());
  }, []);
  return { data, error, loading, loadedAt, reload, setData: replace };
}

/** Whether the element is (at least partly) on screen. True where IntersectionObserver is missing. */
export function useOnScreen(ref: RefObject<Element>, rootMargin = '0px'): boolean {
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return visible;
}

/** Whether the page is in the foreground (polling pauses in background tabs and apps). */
export function usePageVisible(): boolean {
  const read = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const [visible, setVisible] = useState(read);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onChange = () => setVisible(read());
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/**
 * A two-step "Delete? / Confirm" button state that resets itself after a few seconds. Native
 * `confirm()` is avoided because Android WebViews silently return false without a handler.
 */
export function useArmed(timeoutMs = 4000): [boolean, () => void, () => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), timeoutMs);
    return () => clearTimeout(timer);
  }, [armed, timeoutMs]);
  return [armed, () => setArmed(true), () => setArmed(false)];
}

export interface RowKeys {
  /** One stable key per row, in row order. */
  keys: readonly number[];
  /** Call just before removing row `index`, so the rows after it keep their keys. */
  remove: (index: number) => void;
}

/**
 * Stable keys for the rows of an editable list that has no ids of its own. Keyed by index, a
 * removed row's component (and state such as an armed "Remove") would be handed to the row
 * that moves up into its place. Rows added or dropped from outside (a rebase, Discard) are
 * matched at the end of the list.
 */
export function useRowKeys(length: number): RowKeys {
  const next = useRef(0);
  const keys = useRef<number[]>([]);
  while (keys.current.length < length) keys.current.push(next.current++);
  if (keys.current.length > length) keys.current = keys.current.slice(0, length);
  return {
    keys: keys.current,
    remove: (index) => {
      keys.current = keys.current.filter((_, i) => i !== index);
    },
  };
}

/** Copy text; falls back to a hidden textarea for WebViews without the async clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context (plain http on the car's Wi-Fi): try the fallback.
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

const TOKEN_ALPHABET = GENERATED_TOKEN_ALPHABET;

/**
 * Random token for pairing / API access from the Crypto API: 24 characters ≈ 139 bits, easy to
 * type into a phone (letters and digits without look-alikes, as the HUD makes the pairing token
 * of a new config). Rejection sampling keeps every character equally likely.
 */
export function generateToken(length = GENERATED_TOKEN_LENGTH): string {
  const limit = 256 - (256 % TOKEN_ALPHABET.length);
  let out = '';
  while (out.length < length) {
    const buffer = new Uint8Array(length * 2);
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte < limit && out.length < length) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
    }
  }
  return out;
}
