import type { RendererToServer } from '@carheadsup/core';
import { useEffect } from 'preact/hooks';

/**
 * How often the kiosk page tells the server that it still draws (`alive`). The kiosk launcher
 * restarts the browser after 5 s without one (`deploy/kiosk.sh`).
 */
export const ALIVE_INTERVAL_MS = 1000;

/** `requestAnimationFrame` and its cancellation (a seam for tests). */
export interface AnimationFrames {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

const browserFrames: AnimationFrames = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface HeartbeatOptions {
  frames?: AnimationFrames;
  intervalMs?: number;
}

/**
 * Send the page's heartbeat (`{ t: 'alive' }`) from animation-frame callbacks, at most every
 * `intervalMs`. Animation frames run only while the page's main thread and the browser's
 * compositor both do, so the heartbeat stops when either hangs, when the renderer process
 * crashes ("Aw, Snap!") — every case in which the page's own staleness guards, which run on that
 * same thread, cannot blank a frozen image. One that cannot be sent (no connection) is tried
 * again on the next animation frame. Returns the function that stops it.
 */
export function startHeartbeat(
  send: (message: RendererToServer) => boolean,
  options: HeartbeatOptions = {},
): () => void {
  const frames = options.frames ?? browserFrames;
  const intervalMs = options.intervalMs ?? ALIVE_INTERVAL_MS;
  let handle: number | null = null;
  let lastSent = Number.NEGATIVE_INFINITY;
  let stopped = false;
  const onFrame = (time: number): void => {
    handle = null;
    if (stopped) return;
    if (time - lastSent >= intervalMs && send({ t: 'alive' })) lastSent = time;
    handle = frames.request(onFrame);
  };
  handle = frames.request(onFrame);
  return () => {
    stopped = true;
    if (handle !== null) frames.cancel(handle);
    handle = null;
  };
}

/** Run {@link startHeartbeat} while `enabled` (the live kiosk page). */
export function useKioskHeartbeat(
  send: (message: RendererToServer) => boolean,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame !== 'function') return undefined;
    return startHeartbeat(send);
  }, [send, enabled]);
}
