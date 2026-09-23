// @vitest-environment happy-dom
import type { HudFrame } from '@carheadsup/core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFrameLog } from '../../src/dev/EventLog.tsx';
import type { LogEntry } from '../../src/dev/log.ts';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';

let container: HTMLElement;
let log: LogEntry[] = [];
let clock = 0;

function Probe({ frame }: { frame: HudFrame | null }) {
  [log] = useFrameLog(frame, () => clock);
  return null;
}

beforeEach(() => {
  log = [];
  clock = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe('useFrameLog', () => {
  it('stamps "feed lost" on the HUD clock, whatever the browser clock says', () => {
    const frame = SAMPLE_FRAMES['check-engine']!;
    clock = 50_000;
    act(() => render(<Probe frame={frame} />, container));
    // 2.5 s later (on this machine's monotonic clock) the feed goes away.
    clock = 52_500;
    act(() => render(<Probe frame={null} />, container));
    const lost = log.find((e) => e.kind === 'feed' && e.text.startsWith('Feed lost'));
    expect(lost?.at).toBe(frame.at + 2500);
    // Everything else carries the frame's own time.
    expect(log.filter((e) => e !== lost).every((e) => e.at === frame.at)).toBe(true);
  });
});
