import type { HudFrame, ProjectionConfig, RendererToServer } from '@carheadsup/core';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { hudSocketUrl, openHudConnection } from './connection.ts';
import type { HudConnection, SocketFactory } from './connection.ts';
import { FEED_STALE_MS, isFeedLive, msUntilStale } from './staleness.ts';

export interface HudFeed {
  /**
   * The latest frame, or null when there is nothing safe to show: not connected, no frame yet,
   * or the last frame is older than the staleness limit. Never a frozen frame.
   */
  frame: HudFrame | null;
  /** Projection from the server's `display` message; null until the first one arrives. */
  projection: ProjectionConfig | null;
  /** The server runs the simulator. */
  simulated: boolean;
  connected: boolean;
  /** Wall-clock epoch ms when the latest frame arrived (for diagnostics), or null. */
  lastFrameAt: number | null;
  /** Send a message to the server; false when it could not be sent (not connected). */
  send: (message: RendererToServer) => boolean;
}

export interface HudFeedOptions {
  /** False keeps the hook idle (no socket), e.g. while rendering a fixture. Default true. */
  enabled?: boolean;
  /** Defaults to `/ws/hud` on the page's own host. */
  url?: string;
  /** Default `FEED_STALE_MS` (1 s). */
  staleAfterMs?: number;
  /** Test seam: socket constructor. */
  createSocket?: SocketFactory;
  /** Test seam: monotonic clock used for staleness. Default `performance.now()`. */
  now?: () => number;
}

interface FeedState {
  frame: HudFrame | null;
  /** Monotonic receipt time of `frame`. */
  receivedAt: number | null;
  lastFrameAt: number | null;
  projection: ProjectionConfig | null;
  simulated: boolean;
  connected: boolean;
}

const INITIAL: FeedState = {
  frame: null,
  receivedAt: null,
  lastFrameAt: null,
  projection: null,
  simulated: false,
  connected: false,
};

const monotonicNow = (): number => performance.now();

function defaultUrl(): string {
  return typeof window === 'undefined' ? '' : hudSocketUrl(window.location);
}

/**
 * Subscribe to the HUD server's renderer channel. Reconnects automatically and enforces the
 * staleness rule: `frame` turns null the moment the feed stops being live, so a consumer can
 * render `frame` directly without ever showing frozen values.
 */
export function useHudFeed(options: HudFeedOptions = {}): HudFeed {
  const enabled = options.enabled ?? true;
  const staleAfterMs = options.staleAfterMs ?? FEED_STALE_MS;
  const url = options.url ?? defaultUrl();

  // Seams are read through refs so passing new function identities never reconnects.
  const nowRef = useRef(options.now ?? monotonicNow);
  nowRef.current = options.now ?? monotonicNow;
  const createSocketRef = useRef(options.createSocket);
  createSocketRef.current = options.createSocket;

  const [state, setState] = useState<FeedState>(INITIAL);
  // Bumped by the staleness timer purely to re-render and re-evaluate liveness.
  const [, setTick] = useState(0);
  const connectionRef = useRef<HudConnection | null>(null);

  useEffect(() => {
    if (!enabled || url === '') return undefined;
    const connection = openHudConnection({
      url,
      createSocket: createSocketRef.current,
      onMessage: (message) => {
        if (message.t === 'frame') {
          const receivedAt = nowRef.current();
          const lastFrameAt = Date.now();
          setState((s) => ({ ...s, frame: message.frame, receivedAt, lastFrameAt }));
        } else {
          setState((s) => ({ ...s, projection: message.projection, simulated: message.simulated }));
        }
      },
      onConnectionChange: (connected) => {
        // Drop the frame on disconnect so a quick reconnect cannot resurrect old values.
        setState((s) =>
          connected ? { ...s, connected } : { ...s, connected, frame: null, receivedAt: null },
        );
      },
    });
    connectionRef.current = connection;
    return () => {
      connection.close();
      connectionRef.current = null;
      setState(INITIAL);
    };
  }, [enabled, url]);

  // One timer per frame, firing just after the frame expires, so the HUD blanks on time.
  useEffect(() => {
    if (!state.connected || state.receivedAt === null) return undefined;
    const delay = msUntilStale(state.receivedAt, nowRef.current(), staleAfterMs);
    const timer = setTimeout(() => setTick((n) => n + 1), delay + 1);
    return () => clearTimeout(timer);
  }, [state.connected, state.receivedAt, staleAfterMs]);

  const send = useCallback(
    (message: RendererToServer): boolean => connectionRef.current?.send(message) ?? false,
    [],
  );

  const live = isFeedLive(
    { connected: state.connected, lastFrameAt: state.receivedAt },
    nowRef.current(),
    staleAfterMs,
  );

  return {
    frame: live ? state.frame : null,
    projection: state.projection,
    simulated: state.simulated,
    connected: state.connected,
    lastFrameAt: state.lastFrameAt,
    send,
  };
}
