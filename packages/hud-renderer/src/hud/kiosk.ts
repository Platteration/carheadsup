import type { HudFrame, RendererToServer } from '@carheadsup/core';
import { useEffect, useState } from 'preact/hooks';
import { actionForKey } from './keyboard.ts';

/** Query parameters understood by the kiosk page (`/`). */
export interface KioskParams {
  /** `?fixture=<name>`: render a sample frame without a server. */
  fixture: string | null;
  /** `?preview=1`: ignore mirroring / rotation / keystone. */
  preview: boolean;
}

function flag(value: string | null): boolean {
  if (value === null) return false;
  const v = value.trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

export function readKioskParams(search: string): KioskParams {
  const params = new URLSearchParams(search);
  const fixture = params.get('fixture')?.trim() ?? '';
  return { fixture: fixture === '' ? null : fixture, preview: flag(params.get('preview')) };
}

export type FixtureState =
  | { status: 'idle' | 'loading'; frame: null; error: null }
  | { status: 'ready'; frame: HudFrame; error: null }
  | { status: 'error'; frame: null; error: string };

/**
 * Load a named sample frame. The fixtures module is imported lazily so the production kiosk
 * bundle does not carry the sample data.
 */
export function useFixture(name: string | null): FixtureState {
  const [state, setState] = useState<FixtureState>({
    status: name ? 'loading' : 'idle',
    frame: null,
    error: null,
  });
  useEffect(() => {
    if (!name) return undefined;
    let cancelled = false;
    import('./fixtures.ts').then(
      ({ SAMPLE_FRAMES, SAMPLE_FRAME_NAMES }) => {
        if (cancelled) return;
        const frame = Object.prototype.hasOwnProperty.call(SAMPLE_FRAMES, name)
          ? SAMPLE_FRAMES[name]
          : undefined;
        setState(
          frame
            ? { status: 'ready', frame, error: null }
            : {
                status: 'error',
                frame: null,
                error: `Unknown fixture "${name}".\nAvailable: ${SAMPLE_FRAME_NAMES.join(', ')}`,
              },
        );
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          frame: null,
          error: `Could not load fixtures: ${String(err)}`,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name]);
  return state;
}

/** Forward mapped key presses to the server as input actions (see `actionForKey`). */
export function useKioskKeyboard(
  send: (message: RendererToServer) => boolean,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionForKey(event);
      if (!action) return;
      event.preventDefault();
      send({ t: 'input', action });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [send, enabled]);
}

/**
 * Keep the screen on with the Screen Wake Lock API where available, re-acquiring it when the
 * page becomes visible again (the browser releases it on every visibility change). Failures are
 * ignored: the kiosk session also disables screen blanking at the OS level.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (disposed) {
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        // Not allowed here (insecure context, no activation, battery saver) — nothing to do.
      }
    };
    const onVisibility = () => {
      void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
