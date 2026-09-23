/**
 * Renderer half of the "never show stale data as live" rule: if frames stop arriving the HUD
 * must go dark (apart from a tiny "no signal" dot) instead of freezing the last values.
 */

/** A frame older than this (ms) is never shown. At 15 fps this is ~15 missed frames. */
export const FEED_STALE_MS = 1000;

/**
 * Ceiling of the adaptive limit ({@link feedStaleLimitMs}). `server.frameRate` may be as low as
 * 1 fps, where frames are inherently ~1 s apart; the limit then stretches to two frame intervals,
 * but never beyond this.
 */
export const FEED_STALE_MAX_MS = 2500;

/** How many recent frame intervals the frame-rate estimate looks at. */
export const FRAME_INTERVAL_SAMPLES = 8;

export interface FeedLiveness {
  connected: boolean;
  /** Receipt time of the latest frame on the same clock as `now`, or null before the first one. */
  lastFrameAt: number | null;
}

/**
 * Whether the latest frame may be displayed at `now`.
 *
 * Live means: connected, a frame has arrived, and it is at most `staleAfterMs` old. Any clock
 * works as long as `lastFrameAt` and `now` share it (a monotonic one such as `performance.now()`
 * is best). A negative age means the clock stepped backwards; that counts as stale, because a
 * wall clock that jumped back an hour would otherwise keep a frozen frame "fresh" for an hour —
 * the next frame re-arms liveness anyway.
 */
export function isFeedLive(
  feed: FeedLiveness,
  now: number,
  staleAfterMs: number = FEED_STALE_MS,
): boolean {
  if (!feed.connected || feed.lastFrameAt === null) return false;
  if (!Number.isFinite(feed.lastFrameAt) || !Number.isFinite(now)) return false;
  const age = now - feed.lastFrameAt;
  return age >= 0 && age <= staleAfterMs;
}

/**
 * Milliseconds until a frame received at `lastFrameAt` becomes stale (0 when it already is).
 * Used to arm a single timer per frame so the HUD blanks exactly on time.
 */
export function msUntilStale(
  lastFrameAt: number,
  now: number,
  staleAfterMs: number = FEED_STALE_MS,
): number {
  return Math.max(0, lastFrameAt + staleAfterMs - now);
}

/**
 * The typical gap between frames: the lower median of the recent samples, so one late or
 * bunched frame does not move it. Null without samples.
 */
export function typicalInterval(samples: readonly number[]): number | null {
  const valid = samples.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  return valid[Math.floor((valid.length - 1) / 2)] ?? null;
}

/**
 * Staleness limit for a feed whose frames arrive every `intervalMs`: `baseMs`, or two frame
 * intervals when frames come slower than that (a low `server.frameRate`), capped at
 * {@link FEED_STALE_MAX_MS}. The interval is measured from frames that did arrive, so a server
 * that stops sending cannot stretch the limit.
 */
export function feedStaleLimitMs(
  intervalMs: number | null,
  baseMs: number = FEED_STALE_MS,
): number {
  if (intervalMs === null || !Number.isFinite(intervalMs) || intervalMs <= 0) return baseMs;
  return Math.max(baseMs, Math.min(FEED_STALE_MAX_MS, Math.ceil(intervalMs * 2)));
}

/**
 * What the renderer knows about the frames of the current connection. Liveness runs on
 * `progressAt` — the moment the server's own frame time last moved forward — never on mere
 * arrival: a server whose frame loop has stalled may still replay its cached last frame on every
 * connect, or keep sending frames whose time stands still.
 */
export interface FeedProgress {
  /** `at` (server clock) of the latest frame on this connection. */
  lastAt: number | null;
  /** Local monotonic receipt time of the latest frame on this connection. */
  lastReceivedAt: number | null;
  /** Local monotonic time at which `at` last advanced; null until it has on this connection. */
  progressAt: number | null;
  /** Recent receipt intervals (ms), newest last. */
  intervals: readonly number[];
}

export const NO_PROGRESS: FeedProgress = {
  lastAt: null,
  lastReceivedAt: null,
  progressAt: null,
  intervals: [],
};

/**
 * Account for a frame composed at `at` (server clock) and received at `receivedAt` (local,
 * monotonic). Only a frame whose `at` is later than the previous frame's on the same connection
 * proves the server is alive, so the first frame after connecting (possibly hours old) is not
 * shown until a newer one follows. Only server-time differences are compared, so clock skew
 * between browser and HUD does not matter; a server clock stepping back costs one frame.
 */
export function trackFrame(progress: FeedProgress, at: number, receivedAt: number): FeedProgress {
  const advanced = progress.lastAt !== null && Number.isFinite(at) && at > progress.lastAt;
  const interval = progress.lastReceivedAt === null ? null : receivedAt - progress.lastReceivedAt;
  return {
    lastAt: Number.isFinite(at) ? at : progress.lastAt,
    lastReceivedAt: receivedAt,
    progressAt: advanced ? receivedAt : progress.progressAt,
    intervals:
      interval !== null && interval > 0
        ? [...progress.intervals, interval].slice(-FRAME_INTERVAL_SAMPLES)
        : progress.intervals,
  };
}
