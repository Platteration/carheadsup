/**
 * Renderer half of the "never show stale data as live" rule: if frames stop arriving the HUD
 * must go dark (apart from a tiny "no signal" dot) instead of freezing the last values.
 */

/** A frame older than this (ms) is never shown. At 15 fps this is ~15 missed frames. */
export const FEED_STALE_MS = 1000;

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
