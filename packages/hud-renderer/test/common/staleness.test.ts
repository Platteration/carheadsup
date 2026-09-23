import { describe, expect, it } from 'vitest';
import {
  FEED_STALE_MAX_MS,
  FEED_STALE_MS,
  FRAME_INTERVAL_SAMPLES,
  NO_PROGRESS,
  feedStaleLimitMs,
  isFeedLive,
  msUntilStale,
  trackFrame,
  typicalInterval,
} from '../../src/common/staleness.ts';

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

describe('trackFrame', () => {
  it('counts progress only when the server time moves forward on the connection', () => {
    const first = trackFrame(NO_PROGRESS, 5000, 100);
    expect(first).toMatchObject({ lastAt: 5000, lastReceivedAt: 100, progressAt: null });
    const second = trackFrame(first, 5066, 166);
    expect(second.progressAt).toBe(166);
    // Same time again: arrival alone is not progress.
    const repeat = trackFrame(second, 5066, 232);
    expect(repeat.progressAt).toBe(166);
    // A clock stepping back is not progress either, but the next frame after it is.
    const back = trackFrame(repeat, 1000, 298);
    expect(back.progressAt).toBe(166);
    expect(trackFrame(back, 1066, 364).progressAt).toBe(364);
  });

  it('remembers the recent receipt intervals', () => {
    let p = NO_PROGRESS;
    for (let i = 0; i < 20; i += 1) p = trackFrame(p, i, i * 50);
    expect(p.intervals).toHaveLength(FRAME_INTERVAL_SAMPLES);
    expect(new Set(p.intervals)).toEqual(new Set([50]));
    expect(trackFrame(p, 99, p.lastReceivedAt!).intervals).toEqual(p.intervals);
  });
});

describe('adaptive staleness limit', () => {
  it('estimates the frame interval robustly', () => {
    expect(typicalInterval([])).toBeNull();
    expect(typicalInterval([66, 67, 66, 1500, 65])).toBe(66);
    expect(typicalInterval([1004, 1003])).toBe(1003);
    expect(typicalInterval([Number.NaN, -5, 0])).toBeNull();
  });

  it('keeps one second at normal frame rates and stretches for slow ones, within a cap', () => {
    expect(feedStaleLimitMs(null)).toBe(FEED_STALE_MS);
    expect(feedStaleLimitMs(66)).toBe(FEED_STALE_MS);
    expect(feedStaleLimitMs(500)).toBe(FEED_STALE_MS);
    expect(feedStaleLimitMs(1004)).toBe(2008);
    expect(feedStaleLimitMs(5000)).toBe(FEED_STALE_MAX_MS);
    expect(feedStaleLimitMs(66, 200)).toBe(200);
    expect(feedStaleLimitMs(Number.POSITIVE_INFINITY)).toBe(FEED_STALE_MS);
  });
});
