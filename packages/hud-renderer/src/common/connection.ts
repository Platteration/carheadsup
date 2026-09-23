import type {
  HudFrame,
  ProjectionConfig,
  RendererToServer,
  ServerToRenderer,
} from '@carheadsup/core';

/**
 * Reconnecting WebSocket client for the renderer channel (`/ws/hud`, see `core/types/protocol.ts`).
 * The server pushes `frame` and `display` messages; the renderer sends `input` actions back.
 */

/** Path of the renderer channel on the HUD server. */
export const HUD_SOCKET_PATH = '/ws/hud';

/** First reconnect delay; doubles per failed attempt up to `RECONNECT_MAX_MS`. */
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 5000;
/**
 * An open socket that delivers nothing for this long is treated as dead and replaced. The server
 * pushes frames at `server.frameRate` (15 fps by default), so silence means a half-open link.
 */
export const IDLE_TIMEOUT_MS = 5000;

/** WebSocket `readyState` value for an open socket (the DOM constant, without needing the global). */
const OPEN = 1;

/** The subset of the DOM WebSocket the client uses — lets tests inject a fake. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface HudConnectionOptions {
  /** Full ws:// or wss:// URL; see `hudSocketUrl`. */
  url: string;
  onMessage: (message: ServerToRenderer) => void;
  /**
   * Called with true when a socket opens and false when it is lost (not on every failed retry,
   * and not after `close()`).
   */
  onConnectionChange?: (connected: boolean) => void;
  createSocket?: SocketFactory;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** 0 disables the idle watchdog. */
  idleTimeoutMs?: number;
}

export interface HudConnection {
  /** Sends a message if the socket is open; returns false (message dropped) otherwise. */
  send(message: RendererToServer): boolean;
  readonly connected: boolean;
  /** Closes the socket and stops reconnecting. Idempotent. */
  close(): void;
}

/** The renderer channel URL on the page's own host (ws: for http:, wss: for https:). */
export function hudSocketUrl(location: { protocol: string; host: string }): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${HUD_SOCKET_PATH}`;
}

/**
 * Delay before reconnect attempt number `attempt` (0-based): 0.5 s, 1 s, 2 s, 4 s, then 5 s.
 * Deterministic on purpose — there is a single client per server, so no thundering herd to jitter.
 */
export function reconnectDelayMs(
  attempt: number,
  minDelayMs: number = RECONNECT_MIN_MS,
  maxDelayMs: number = RECONNECT_MAX_MS,
): number {
  const n = Math.max(0, Math.floor(attempt));
  // Cap the exponent so large attempt counts cannot overflow to Infinity/NaN.
  return Math.min(maxDelayMs, minDelayMs * 2 ** Math.min(n, 30));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFrame(value: unknown): value is HudFrame {
  if (!isObject(value)) return false;
  const { at, context, theme, widgets, alerts, blindSpot, status } = value;
  return (
    typeof at === 'number' &&
    typeof context === 'string' &&
    isObject(theme) &&
    typeof theme.brightness === 'number' &&
    Array.isArray(widgets) &&
    widgets.every((w) => isObject(w) && typeof w.id === 'string' && typeof w.zone === 'string') &&
    Array.isArray(alerts) &&
    isObject(blindSpot) &&
    isObject(status)
  );
}

function isPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

function isProjection(value: unknown): value is ProjectionConfig {
  if (!isObject(value)) return false;
  const { corners } = value;
  return (
    typeof value.mirrorX === 'boolean' &&
    typeof value.mirrorY === 'boolean' &&
    typeof value.rotation === 'number' &&
    typeof value.scale === 'number' &&
    typeof value.offsetX === 'number' &&
    typeof value.offsetY === 'number' &&
    typeof value.showGrid === 'boolean' &&
    isObject(corners) &&
    isPoint(corners.tl) &&
    isPoint(corners.tr) &&
    isPoint(corners.br) &&
    isPoint(corners.bl)
  );
}

/**
 * Decode one server message. The server is trusted (same origin), so this is a structural
 * sanity check that keeps a malformed message from crashing the view — not full validation.
 * Returns null for anything unrecognised (binary data, bad JSON, unknown `t`, wrong shape).
 */
export function parseServerMessage(data: unknown): ServerToRenderer | null {
  if (typeof data !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  if (parsed.t === 'frame' && isFrame(parsed.frame)) {
    return { t: 'frame', frame: parsed.frame };
  }
  if (
    parsed.t === 'display' &&
    isProjection(parsed.projection) &&
    typeof parsed.simulated === 'boolean'
  ) {
    return { t: 'display', projection: parsed.projection, simulated: parsed.simulated };
  }
  return null;
}

function defaultSocketFactory(url: string): SocketLike {
  return new WebSocket(url);
}

/**
 * Open the renderer channel and keep it open: reconnects with exponential backoff
 * (0.5 s → 5 s, reset after a successful open) and replaces sockets that go silent.
 */
export function openHudConnection(options: HudConnectionOptions): HudConnection {
  const createSocket = options.createSocket ?? defaultSocketFactory;
  const minDelay = options.minDelayMs ?? RECONNECT_MIN_MS;
  const maxDelay = options.maxDelayMs ?? RECONNECT_MAX_MS;
  const idleTimeout = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;

  let socket: SocketLike | null = null;
  let connected = false;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const setConnected = (value: boolean): void => {
    if (connected === value) return;
    connected = value;
    options.onConnectionChange?.(value);
  };

  const clearIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const armIdle = (target: SocketLike): void => {
    clearIdle();
    if (idleTimeout <= 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (socket === target) drop(target);
    }, idleTimeout);
  };

  const scheduleReconnect = (): void => {
    if (closed || retryTimer !== null) return;
    const delay = reconnectDelayMs(attempt, minDelay, maxDelay);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  /** Abandon `target` (if still current) and schedule a reconnect. */
  const drop = (target: SocketLike): void => {
    if (socket !== target) return;
    socket = null;
    clearIdle();
    target.onopen = target.onclose = target.onerror = target.onmessage = null;
    try {
      target.close();
    } catch {
      // Already closing or never opened — nothing to clean up.
    }
    setConnected(false);
    scheduleReconnect();
  };

  function connect(): void {
    if (closed) return;
    let next: SocketLike;
    try {
      next = createSocket(options.url);
    } catch {
      // Invalid URL or the constructor refused (e.g. too many sockets): retry later.
      scheduleReconnect();
      return;
    }
    socket = next;
    next.onopen = () => {
      if (socket !== next) return;
      attempt = 0;
      setConnected(true);
      armIdle(next);
    };
    next.onmessage = (event: MessageEvent) => {
      if (socket !== next) return;
      armIdle(next);
      const message = parseServerMessage(event.data);
      if (message) options.onMessage(message);
    };
    // Browsers always follow 'error' with 'close'; handling both is harmless because drop()
    // detaches the handlers and ignores sockets that are no longer current.
    next.onerror = () => drop(next);
    next.onclose = () => drop(next);
  }

  connect();

  return {
    send(message: RendererToServer): boolean {
      if (!socket || socket.readyState !== OPEN) return false;
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    get connected() {
      return connected;
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      clearIdle();
      const current = socket;
      socket = null;
      if (current) {
        current.onopen = current.onclose = current.onerror = current.onmessage = null;
        try {
          current.close();
        } catch {
          // Ignore — we are shutting down.
        }
      }
      // Deliberately silent: the owner asked for the close, so no onConnectionChange callback
      // (which would otherwise reach e.g. an unmounting component).
      connected = false;
    },
  };
}
