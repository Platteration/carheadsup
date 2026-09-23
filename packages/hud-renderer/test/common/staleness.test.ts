import { describe, expect, it } from 'vitest';
import { FEED_STALE_MS, isFeedLive, msUntilStale } from '../../src/common/staleness.ts';

describe('isFeedLive', () => {
  const at = 10_000;

  it('is live while connected and the last frame is fresh', () => {
    expect(isFeedLive({ connected: true, lastFrameAt: at }, at)).toBe(true);
    expect(isFeedLive({ connected: true, lastFrameAt: at }, at + 999)).toBe(true);
  });

  it('allows exactly the staleness limit and nothing more', () => {
    expect(FEED_STALE_MS).toBe(1000);
    expect(isFeedLive({ connected: true, lastFrameAt: at }, at + 1000)).toBe(true);
    expect(isFeedLive({ connected: true, lastFrameAt: at }, at + 1001)).toBe(false);
  });

  it('is never live when disconnected, even with a fresh frame', () => {
    expect(isFeedLive({ connected: false, lastFrameAt: at }, at)).toBe(false);
  });

  it('is not live before the first frame', () => {
    expect(isFeedLive({ connected: true, lastFrameAt: null }, at)).toBe(false);
  });

  it('treats a clock that stepped backwards as stale', () => {
    expect(isFeedLive({ connected: true, lastFrameAt: at }, at - 1)).toBe(false);
    expect(isFeedLive({ connected: true, lastFrameAt: at }, at - 3_600_000)).toBe(false);
  });

  it('rejects non-finite timestamps', () => {
    expect(isFeedLive({ connected: true, lastFrameAt: Number.NaN }, at)).toBe(false);
    expect(isFeedLive({ connected: true, lastFrameAt: at }, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('honours a custom limit', () => {
    expect(isFeedLive({ connected: true, lastFrameAt: at }, at + 300, 250)).toBe(false);
    expect(isFeedLive({ connected: true, lastFrameAt: at }, at + 200, 250)).toBe(true);
  });
});

describe('msUntilStale', () => {
  it('counts down to the limit and never goes negative', () => {
    expect(msUntilStale(1000, 1000)).toBe(1000);
    expect(msUntilStale(1000, 1600)).toBe(400);
    expect(msUntilStale(1000, 5000)).toBe(0);
    expect(msUntilStale(1000, 1100, 250)).toBe(150);
  });
});
