// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoApp } from '../../src/demo/App.tsx';
import { DemoEngine } from '../../src/demo/engine.ts';
import { DEFAULT_PREFS } from '../../src/demo/model.ts';
import type { DemoPrefs } from '../../src/demo/model.ts';
import { mount, text } from '../settings/dom.ts';
import type { Mounted } from '../settings/dom.ts';

const T0 = Date.UTC(2026, 8, 30, 7, 30);

let mounted: Mounted | null = null;
let engine: DemoEngine | null = null;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  engine?.stop();
  engine = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function start(prefs: DemoPrefs = DEFAULT_PREFS) {
  const clock = () => Date.now();
  engine = new DemoEngine({ now: clock, monotonic: clock });
  engine.start();
  const saved: DemoPrefs[] = [];
  mounted = mount(
    <DemoApp engine={engine} initialPrefs={prefs} savePrefs={(p) => saved.push(p)} />,
  );
  const root = mounted.container;
  const el = <E extends HTMLElement = HTMLButtonElement>(id: string): E => {
    const found = root.querySelector<E>(`#${id}`);
    if (!found) throw new Error(`no #${id}`);
    return found;
  };
  return { engine, root, saved, el };
}

/** Advance virtual time, letting Preact render what the engine published. */
function run(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function click(button: HTMLElement): void {
  act(() => {
    button.click();
  });
}

function key(name: string): void {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
  });
}

describe('the drive simulator page', () => {
  it('shows the live HUD from the start, with a stable id on every control', () => {
    const { root } = start();
    const hud = root.querySelector('.hud');
    expect(hud?.getAttribute('data-context')).toBe('parked');
    expect(text(hud)).toContain('Overview');
    expect(text(root.querySelector('.readout'))).toContain('warm-up 0:00/0:20');
    expect(text(root.querySelector('.note'))).toContain('shown unmirrored');

    const controls = [...root.querySelectorAll('button, input, output')];
    expect(controls.length).toBeGreaterThan(40);
    expect(controls.filter((c) => c.id === '')).toEqual([]);
    expect(new Set(controls.map((c) => c.id)).size).toBe(controls.length);

    run(30_000);
    expect(root.querySelector('.hud')?.getAttribute('data-context')).toBe('city');
    expect(text(root.querySelector('.readout'))).toMatch(/^City \d+ km\/h Gear \d/);
  });

  it('rings the phone and accepts the call with the Accept button or Enter', () => {
    const { engine, root, el } = start();
    click(el('phone-call'));
    run(300);
    expect(text(root.querySelector('.hud'))).toContain('Maria Lopez');
    expect(engine.frame.call?.state).toBe('ringing');
    key('Enter');
    expect(el('input-primary').classList.contains('key--flash')).toBe(true);
    run(300);
    expect(engine.frame.call?.state).toBe('active');
    expect(el('input-primary').classList.contains('key--flash')).toBe(false);
    click(el('input-secondary'));
    run(300);
    expect(engine.frame.call?.state ?? 'ended').toBe('ended');

    click(el('phone-call'));
    run(300);
    click(el('input-primary'));
    run(300);
    expect(engine.frame.call?.state).toBe('active');
  });

  it('switches faults, conditions and driver assistance, and shows them as latched', () => {
    const { engine, el } = start();
    click(el('fault-P0217'));
    click(el('fault-battery'));
    click(el('adas-blind-left'));
    click(el('light-night'));
    run(500);
    expect(el('fault-P0217').getAttribute('aria-pressed')).toBe('true');
    expect(el('fault-battery').getAttribute('aria-pressed')).toBe('true');
    expect(el('adas-blind-left').getAttribute('aria-pressed')).toBe('true');
    expect(el('light-night').getAttribute('aria-pressed')).toBe('true');
    expect(engine.status()).toMatchObject({
      dtcs: ['P0217'],
      coolantOverrideC: 121,
      voltageOverrideV: 11.6,
      adas: { blindSpotLeft: true },
    });
    expect(engine.frame.blindSpot.left).toBe(true);
    expect(engine.frame.theme.night).toBe(true);

    click(el('fault-clear'));
    run(300);
    expect(el('fault-P0217').getAttribute('aria-pressed')).toBe('false');
    expect(engine.status()).toMatchObject({ dtcs: [], coolantOverrideC: null });
  });

  it('takes over from the script with the pedals', () => {
    const { engine, el, root } = start();
    const throttle = el<HTMLInputElement>('drive-throttle');
    act(() => {
      throttle.value = '0.6';
      throttle.dispatchEvent(new Event('input', { bubbles: true }));
    });
    run(5000);
    expect(engine.status()).toMatchObject({ mode: 'manual', throttle: 0.6 });
    expect(el('drive-mode-manual').getAttribute('aria-pressed')).toBe('true');
    expect(text(root.querySelector('.readout'))).toContain('Manual driving');
    click(el('drive-restart'));
    run(300);
    expect(engine.status().script?.step).toBe('warm-up');
  });

  it('applies and remembers units, layout, shift light and the screen shape', () => {
    const { engine, el, saved, root } = start();
    click(el('units-imperial'));
    click(el('layout-sport'));
    click(el('display-shift-light'));
    click(el('panel-1280x480'));
    click(el('display-backdrop'));
    run(300);
    expect(engine.config.units.system).toBe('imperial');
    expect(engine.config.display.layout.preset).toBe('sport');
    expect(engine.config.shiftLight.enabled).toBe(true);
    expect(saved.at(-1)).toEqual({
      panel: '1280x480',
      backdrop: true,
      units: 'imperial',
      layout: 'sport',
      shiftLight: true,
    });
    expect(root.querySelector('.preview__frame')?.getAttribute('data-panel')).toBe('1280x480');
    expect(root.querySelector('.preview__backdrop')?.getAttribute('data-scene')).toBe('day');
  });
});
