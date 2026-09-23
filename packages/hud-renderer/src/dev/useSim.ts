import type { SimControl, SimStatus } from '@carheadsup/core';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { isAbortError, isHudApiError } from '../common/api.ts';
import type { HudApi } from '../common/api.ts';

/**
 * Whether the HUD runs its simulator: `real-vehicle` when `/api/sim` answers 404 (the controls
 * are hidden), `unreachable` when the HUD does not answer at all.
 */
export type SimAvailability = 'checking' | 'available' | 'real-vehicle' | 'unreachable';

/** Poll intervals per state: fast while simulating, slower while there is nothing to control. */
export const SIM_POLL_MS: Readonly<Record<SimAvailability, number>> = {
  checking: 1000,
  available: 1000,
  unreachable: 2000,
  'real-vehicle': 10_000,
};

export interface SimHandle {
  availability: SimAvailability;
  status: SimStatus | null;
  /** Why the HUD is unreachable, or why the last command failed. */
  error: unknown;
  /** Send a control; resolves true when the HUD accepted it. */
  send: (control: SimControl) => Promise<boolean>;
  /** Check again now (after an error). */
  refresh: () => void;
}

export function useSim(api: HudApi): SimHandle {
  const [availability, setAvailability] = useState<SimAvailability>('checking');
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    const poll = async () => {
      let next: SimAvailability = 'checking';
      try {
        const result = await api.getSim({ signal: controller.signal });
        if (!active) return;
        next = result === null ? 'real-vehicle' : 'available';
        setStatus(result);
        setError(null);
      } catch (err) {
        if (!active || isAbortError(err)) return;
        next = 'unreachable';
        setError(err);
      }
      setAvailability(next);
      timer = setTimeout(() => void poll(), SIM_POLL_MS[next]);
    };
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [api, nonce]);

  const send = useCallback(
    async (control: SimControl): Promise<boolean> => {
      try {
        const next = await api.controlSim(control);
        if (!mounted.current) return true;
        setStatus(next);
        setAvailability('available');
        setError(null);
        return true;
      } catch (err) {
        if (!mounted.current) return false;
        if (isHudApiError(err) && err.kind === 'not-found') {
          setAvailability('real-vehicle');
          setStatus(null);
        } else {
          setError(err);
        }
        return false;
      }
    },
    [api],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { availability, status, error, send, refresh };
}

/**
 * Rate-limit a sender (e.g. a slider): the first call goes out at once, later ones at most every
 * `intervalMs`, and the last value is always delivered.
 */
export function useThrottled<T>(fn: (value: T) => void, intervalMs: number): (value: T) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const last = useRef(0);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (value: T) => {
      const now = Date.now();
      const wait = last.current + intervalMs - now;
      if (wait <= 0 && timer.current === null) {
        last.current = now;
        fnRef.current(value);
        return;
      }
      pending.current = { value };
      if (timer.current === null) {
        timer.current = setTimeout(
          () => {
            timer.current = null;
            last.current = Date.now();
            const p = pending.current;
            pending.current = null;
            if (p) fnRef.current(p.value);
          },
          Math.max(0, wait),
        );
      }
    },
    [intervalMs],
  );
}
