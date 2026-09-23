// @vitest-environment happy-dom
import type { HudFrame, WidgetFrame } from '@carheadsup/core';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HudView } from '../../src/hud/HudView.tsx';
import { KioskBoundary } from '../../src/hud/KioskBoundary.tsx';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';

/**
 * A frame the view cannot draw (a newer or buggy server leaving out a field) must cost only the
 * broken piece for that one frame: the rest keeps updating, and later frames draw normally.
 * Without error boundaries Preact abandons the render with the component still marked dirty and
 * ignores every later update, freezing the last values on the glass.
 */

const CITY = SAMPLE_FRAMES['city-nav']!;

function withSpeed(frame: HudFrame, value: number, at: number): HudFrame {
  return {
    ...frame,
    at,
    widgets: frame.widgets.map((w) => (w.id === 'speed' ? { ...w, value } : w)),
  };
}

/** The nav widget without its `maneuver` (Nav reads `w.maneuver.type`). */
function withBrokenNav(frame: HudFrame): HudFrame {
  return {
    ...frame,
    widgets: frame.widgets.map((w) => {
      if (w.id !== 'nav') return w;
      const { maneuver: _dropped, ...rest } = w;
      return rest as unknown as WidgetFrame;
    }),
  };
}

let container: HTMLElement;
let show: (frame: HudFrame | null) => void = () => undefined;

function Harness({ initial }: { initial: HudFrame | null }) {
  const [frame, setFrame] = useState<HudFrame | null>(initial);
  show = setFrame;
  return <HudView frame={frame} />;
}

function speedText(): string | null {
  return container.querySelector('[data-widget="speed"] .hud-speed__value')?.textContent ?? null;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
});

describe('HudView with frames it cannot draw', () => {
  it('drops only the broken widget and keeps updating the rest', () => {
    act(() => render(<Harness initial={withSpeed(CITY, 115, 1)} />, container));
    expect(speedText()).toBe('115');
    expect(container.querySelector('[data-widget="nav"]')).not.toBeNull();

    act(() => show(withBrokenNav(withSpeed(CITY, 120, 2))));
    expect(speedText()).toBe('120');
    expect(container.querySelector('[data-widget="nav"]')).toBeNull();

    // Good frames draw normally again, nav included.
    act(() => show(withSpeed(CITY, 140, 3)));
    expect(speedText()).toBe('140');
    expect(container.querySelector('[data-widget="nav"]')).not.toBeNull();

    // And the view still blanks when the feed goes away.
    act(() => show(null));
    expect(container.querySelector('[data-no-signal]')).not.toBeNull();
    expect(speedText()).toBeNull();
  });

  it('never freezes on a frame whose overlays are malformed', () => {
    act(() => render(<Harness initial={withSpeed(CITY, 90, 1)} />, container));
    const broken = {
      ...withSpeed(CITY, 95, 2),
      call: { state: 'ringing', name: 'Maria' } as unknown as HudFrame['call'],
      alerts: [{ key: 'x' } as unknown as HudFrame['alerts'][number]],
    };
    act(() => show(broken));
    expect(speedText()).toBe('95');
    act(() => show(withSpeed(CITY, 100, 3)));
    expect(speedText()).toBe('100');
  });

  it('shows the good alerts of a frame whose alert list holds junk', () => {
    const good = {
      key: 'coolant',
      kind: 'coolant',
      severity: 'critical',
      title: 'Engine overheating',
      detail: null,
      code: null,
      dismissible: false,
    } as const;
    const junk = [null, 7, good] as unknown as HudFrame['alerts'];
    act(() => render(<Harness initial={{ ...withSpeed(CITY, 80, 1), alerts: junk }} />, container));
    expect(speedText()).toBe('80');
    expect(container.querySelector('[data-alert="coolant"]')).not.toBeNull();
  });

  it('blanks rather than freezes when the whole frame cannot be drawn', () => {
    act(() => render(<Harness initial={withSpeed(CITY, 60, 1)} />, container));
    const broken = { ...withSpeed(CITY, 65, 2), widgets: null } as unknown as HudFrame;
    act(() => show(broken));
    expect(speedText()).toBeNull();
    expect(container.querySelector('[data-no-signal]')).not.toBeNull();
    act(() => show(withSpeed(CITY, 70, 3)));
    expect(speedText()).toBe('70');
  });

  it('keeps a broken diagnostics page from freezing the dashboard', () => {
    const parked = SAMPLE_FRAMES['parked-overview']!;
    act(() => render(<Harness initial={parked} />, container));
    expect(container.querySelector('[data-mode="diagnostics"]')).not.toBeNull();
    const broken = {
      ...parked,
      at: parked.at + 1,
      diagnostics: { ...parked.diagnostics!, vehicle: undefined },
    } as unknown as HudFrame;
    act(() => show(broken));
    act(() => show(withSpeed(CITY, 30, parked.at + 2)));
    expect(speedText()).toBe('30');
  });
});

describe('kiosk boundary', () => {
  function Broken(): never {
    throw new Error('boom');
  }

  it('goes dark and reloads the page when something outside the view fails', async () => {
    vi.useFakeTimers();
    try {
      const reload = vi.fn();
      act(() =>
        render(
          <KioskBoundary reload={reload} serverAnswers={async () => true} reloadAfterMs={3000}>
            <Broken />
          </KioskBoundary>,
          container,
        ),
      );
      expect(container.querySelector('[data-no-signal]')).not.toBeNull();
      expect(container.textContent?.trim()).toBe('');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2999);
      });
      expect(reload).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays dark instead of reloading into the browser error page while the server is down', async () => {
    vi.useFakeTimers();
    try {
      const reload = vi.fn();
      let up = false;
      const checks: number[] = [];
      act(() =>
        render(
          <KioskBoundary
            reload={reload}
            serverAnswers={async () => {
              checks.push(Date.now());
              return up;
            }}
            reloadAfterMs={3000}
          >
            <Broken />
          </KioskBoundary>,
          container,
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(checks).toHaveLength(3);
      expect(reload).not.toHaveBeenCalled();
      expect(container.querySelector('[data-no-signal]')).not.toBeNull();
      up = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders its children untouched while they work', () => {
    act(() =>
      render(
        <KioskBoundary reload={() => undefined}>
          <HudView frame={withSpeed(CITY, 50, 1)} />
        </KioskBoundary>,
        container,
      ),
    );
    expect(speedText()).toBe('50');
  });
});
