// @vitest-environment happy-dom
import type { CollisionLevel, HudFrame } from '@carheadsup/core';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLASH_HOLD_MS, phaseDelay } from '../../src/hud/flash.ts';
import { HudView } from '../../src/hud/HudView.tsx';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';

/**
 * Photosensitivity: a flashing overlay must not appear and disappear at the frame rate when its
 * input dithers around a threshold (ADAS module at its limit, rpm noise at the shift point).
 */

const FRAME_MS = 1000 / 15;
const HIGHWAY = SAMPLE_FRAMES['highway-cruise']!;

let container: HTMLElement;
let show: (frame: HudFrame | null) => void = () => undefined;

function Harness({ initial }: { initial: HudFrame | null }) {
  const [frame, setFrame] = useState<HudFrame | null>(initial);
  show = setFrame;
  return <HudView frame={frame} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Show each frame for one frame period; returns the border's presence after each ('X' / '.'). */
function play(frames: readonly HudFrame[], probe: () => boolean): string {
  let trace = '';
  for (const frame of frames) {
    act(() => show(frame));
    trace += probe() ? 'X' : '.';
    act(() => {
      vi.advanceTimersByTime(FRAME_MS);
    });
  }
  return trace;
}

const border = () => container.querySelector('.hud-collision-border') !== null;

describe('flash rate limiting', () => {
  it('keeps the collision warning up while the level dithers between warning and caution', () => {
    act(() => render(<Harness initial={HIGHWAY} />, container));
    const levels: CollisionLevel[] = Array.from({ length: 16 }, (_, i) =>
      i % 2 === 0 ? 'warning' : 'caution',
    );
    const frames = levels.map((collision, i) => ({ ...HIGHWAY, at: HIGHWAY.at + i, collision }));
    expect(play(frames, border)).toBe('X'.repeat(16));
    expect(container.querySelector('[data-collision="warning"]')).not.toBeNull();
  });

  it('holds a warning for the hold time after the last warning frame, then clears it', () => {
    act(() => render(<Harness initial={{ ...HIGHWAY, collision: 'warning' }} />, container));
    expect(border()).toBe(true);
    act(() => show({ ...HIGHWAY, at: HIGHWAY.at + 1, collision: 'none' }));
    expect(border()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(FLASH_HOLD_MS - 50);
    });
    expect(border()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(border()).toBe(false);
    expect(container.querySelector('[data-collision]')).toBeNull();
  });

  it('never toggles the shift flash faster than the hold time on noisy rpm', () => {
    const shift = (flash: boolean, i: number): HudFrame => ({
      ...SAMPLE_FRAMES['sport-shift']!,
      at: HIGHWAY.at + i,
      shiftLight: { level: 0.98, flash },
    });
    act(() => render(<Harness initial={shift(false, 0)} />, container));
    const flashing = () => container.querySelector('.hud-shift--flash') !== null;
    expect(flashing()).toBe(false);
    // 10 Hz OBD samples straddling the flash point: 6290, 6310, 6280, 6320 … rpm.
    const frames = Array.from({ length: 15 }, (_, i) => shift(i % 2 === 1, i + 1));
    expect(play(frames, flashing)).toBe(`.${'X'.repeat(14)}`);
  });

  it('keeps every blink on one clock, so remounting does not restart its phase', () => {
    expect(phaseDelay(400, 1000)).toBe('-200ms');
    expect(phaseDelay(400, 1399)).toBe('-199ms');
    expect(phaseDelay(1000, 1000)).toBe('0ms');
    expect(phaseDelay(1000, 999.7)).toBe('0ms');
    act(() => render(<Harness initial={{ ...HIGHWAY, collision: 'warning' }} />, container));
    const style = container.querySelector<HTMLElement>('.hud-collision-border')!.style;
    expect(style.animationDelay).toMatch(/^-?\d+ms$/);
  });
});

describe('calibration grid and the feed', () => {
  const PROJECTION = {
    mirrorX: false,
    mirrorY: false,
    rotation: 0 as const,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    corners: {
      tl: [0, 0] as [number, number],
      tr: [1, 0] as [number, number],
      br: [1, 1] as [number, number],
      bl: [0, 1] as [number, number],
    },
    showGrid: true,
  };

  function GridHarness({ initial }: { initial: HudFrame | null }) {
    const [frame, setFrame] = useState<HudFrame | null>(initial);
    show = setFrame;
    return <HudView frame={frame} projection={PROJECTION} />;
  }

  const grid = () => container.querySelector('[data-alignment-grid]') !== null;

  it('does not bring the grid up when the feed of a moving car drops out', () => {
    act(() => render(<GridHarness initial={HIGHWAY} />, container));
    expect(grid()).toBe(false);
    act(() => show(null));
    expect(grid()).toBe(false);
    expect(container.querySelector('[data-no-signal]')).not.toBeNull();
    act(() => show({ ...HIGHWAY, context: 'parked' }));
    expect(grid()).toBe(true);
    act(() => show(null));
    expect(grid()).toBe(true);
  });
});
