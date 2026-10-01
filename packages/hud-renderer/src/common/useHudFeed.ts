import type { HudFrame, ProjectionConfig, RendererToServer } from '@carheadsup/core';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { hudSocketUrl, openHudConnection, withToken } from './connection.ts';
import type { HudConnection, SocketFactory } from './connection.ts';
import {
  FEED_STALE_MS,
  NO_PROGRESS,
  feedStaleLimitMs,
  isFeedLive,
  msUntilStale,
  trackFrame,
  typicalInterval,
} from './staleness.ts';
import type { FeedProgress } from './staleness.ts';

export interface HudFeed {
  /**
   * The latest frame, or null when there is nothing safe to show: not connected, no frame yet,
   * or the server's frame time has not moved forward within the staleness limit (see
   * `trackFrame`). Never a frozen frame.
   */
  frame: HudFrame | null;
  /** Projection from the server's `display` message; null until the first one arrives. */
  projection: ProjectionConfig | null;
  /** The server runs the simulator. */
  simulated: boolean;
  /**
   * The server applies the frames' brightness to the display's backlight, so the kiosk must not
   * dim the content as well (see `RendererDisplayMessage.hardwareBrightness`).
   */
  hardwareBrightness: boolean;
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
  /**
   * API token, sent as `?token=` (browsers cannot set headers on a WebSocket). Needed by pages
   * on other devices once `server.apiToken` is set; the HUD's own kiosk needs none.
   */
  token?: string;
  /**
   * Base staleness limit, default `FEED_STALE_MS` (1 s). It stretches to two frame intervals
   * when the server sends fewer than two frames a second (see `feedStaleLimitMs`).
   */
  staleAfterMs?: number;
  /** Test seam: socket constructor. */
  createSocket?: SocketFactory;
  /** Test seam: monotonic clock used for staleness. Default `performance.now()`. */
  now?: () => number;
}

interface FeedState {
  frame: HudFrame | null;
  /** Progress of the server's frame time on this connection (liveness runs on it). */
  progress: FeedProgress;
  lastFrameAt: number | null;
  projection: ProjectionConfig | null;
  simulated: boolean;
  hardwareBrightness: boolean;
  connected: boolean;
}

const INITIAL: FeedState = {
  frame: null,
  progress: NO_PROGRESS,
  lastFrameAt: null,
  projection: null,
  simulated: false,
  hardwareBrightness: false,
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
  const baseStaleMs = options.staleAfterMs ?? FEED_STALE_MS;
  const url = withToken(options.url ?? defaultUrl(), options.token ?? '');

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
          const { frame } = message;
          setState((s) => ({
            ...s,
            frame,
            progress: trackFrame(s.progress, frame.at, receivedAt),
            lastFrameAt,
          }));
        } else {
          setState((s) => ({
            ...s,
            projection: message.projection,
            simulated: message.simulated,
            hardwareBrightness: message.hardwareBrightness,
          }));
        }
      },
      onConnectionChange: (connected) => {
        // Every connection starts from scratch: a quick reconnect cannot resurrect old values,
        // and a new connection is live only once the server's frame time moves on it. The
        // server may have changed (e.g. restarted without its backlight), so the renderer dims
        // by itself until the new connection's `display` message says otherwise.
        setState((s) => ({
          ...s,
          connected,
          frame: null,
          progress: NO_PROGRESS,
          hardwareBrightness: false,
        }));
      },
    });
    connectionRef.current = connection;
    return () => {
      connection.close();
      connectionRef.current = null;
      setState(INITIAL);
    };
  }, [enabled, url]);

  const staleAfterMs = feedStaleLimitMs(typicalInterval(state.progress.intervals), baseStaleMs);
  const progressAt = state.progress.progressAt;

  // One timer per step of progress, firing just after it expires, so the HUD blanks on time.
  useEffect(() => {
    if (!state.connected || progressAt === null) return undefined;
    const delay = msUntilStale(progressAt, nowRef.current(), staleAfterMs);
    const timer = setTimeout(() => setTick((n) => n + 1), delay + 1);
    return () => clearTimeout(timer);
  }, [state.connected, progressAt, staleAfterMs]);

  const send = useCallback(
    (message: RendererToServer): boolean => connectionRef.current?.send(message) ?? false,
    [],
  );

  const live = isFeedLive(
    { connected: state.connected, lastFrameAt: progressAt },
    nowRef.current(),
    staleAfterMs,
  );

  return {
    frame: live ? state.frame : null,
    projection: state.projection,
    simulated: state.simulated,
    hardwareBrightness: state.hardwareBrightness,
    connected: state.connected,
    lastFrameAt: state.lastFrameAt,
    send,
  };
}
