import type { RendererToServer } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { ALIVE_INTERVAL_MS, startHeartbeat } from '../../src/hud/heartbeat.ts';
import type { AnimationFrames } from '../../src/hud/heartbeat.ts';

/** Animation frames driven by hand: `frame(t)` runs the pending callback at time `t`. */
function fakeFrames(): AnimationFrames & { frame(time: number): void; pending: number } {
  let next = 1;
  const callbacks = new Map<number, (time: number) => void>();
  return {
    request(callback) {
      const handle = next++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
    frame(time) {
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const callback of due) callback(time);
    },
    get pending() {
      return callbacks.size;
    },
  };
}

describe('startHeartbeat', () => {
  it('sends alive on the first animation frame, then at most once per interval', () => {
    const frames = fakeFrames();
    const sent: RendererToServer[] = [];
    const stop = startHeartbeat((m) => sent.push(m) > 0, { frames });
    expect(sent).toEqual([]);
    frames.frame(0);
    expect(sent).toEqual([{ t: 'alive' }]);
    // 60 fps for almost a second: nothing more.
    for (let t = 16; t < ALIVE_INTERVAL_MS; t += 16) frames.frame(t);
    expect(sent).toHaveLength(1);
    frames.frame(ALIVE_INTERVAL_MS);
    expect(sent).toHaveLength(2);
    stop();
  });

  it('sends nothing while animation frames stop (a hung page or compositor)', () => {
    const frames = fakeFrames();
    let count = 0;
    const stop = startHeartbeat(() => ++count > 0, { frames });
    frames.frame(0);
    // No frame callbacks for 10 s: no heartbeat, whatever the time.
    expect(count).toBe(1);
    frames.frame(10_000);
    expect(count).toBe(2);
    stop();
  });

  it('tries again on the next frame when it could not be sent', () => {
    const frames = fakeFrames();
    let connected = false;
    const sent: number[] = [];
    const stop = startHeartbeat(
      () => {
        if (connected) sent.push(1);
        return connected;
      },
      { frames },
    );
    frames.frame(0);
    frames.frame(16);
    expect(sent).toEqual([]);
    connected = true;
    frames.frame(32);
    expect(sent).toEqual([1]);
    stop();
  });

  it('stops requesting frames once stopped', () => {
    const frames = fakeFrames();
    let count = 0;
    const stop = startHeartbeat(() => ++count > 0, { frames, intervalMs: 0 });
    frames.frame(0);
    expect(frames.pending).toBe(1);
    stop();
    expect(frames.pending).toBe(0);
    frames.frame(100);
    expect(count).toBe(1);
  });
});
