// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHudApi, memoryTokenStore } from '../../src/common/api.ts';
import { DevApp } from '../../src/dev/App.tsx';
import { SAMPLE_FRAMES, SAMPLE_FRAME_NAMES } from '../../src/hud/fixtures.ts';
import { FakeSocket } from '../common/fake-socket.ts';
import {
  byText,
  button,
  click,
  mount,
  press,
  settle,
  text,
  type,
  waitFor,
} from '../settings/dom.ts';
import type { Mounted } from '../settings/dom.ts';
import { MockHud } from '../settings/mock-hud.ts';

let mounted: Mounted | null = null;

beforeEach(() => {
  FakeSocket.reset();
  localStorage.clear();
  history.replaceState(null, '', '/dev.html');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

function start(hud: MockHud, tab: 'live' | 'gallery' = 'live') {
  localStorage.setItem('carheadsup.dev', JSON.stringify({ tab, panel: 0, backdrop: 'night' }));
  const api = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore() });
  mounted = mount(
    <DevApp
      api={api}
      feedOptions={{
        url: 'ws://hud.test/ws/hud',
        createSocket: FakeSocket.factory,
        now: () => Date.now(),
      }}
    />,
  );
  return mounted.container;
}

const simBodies = (hud: MockHud) =>
  hud.requests.filter((r) => r.method === 'POST' && r.path === '/api/sim').map((r) => r.body);

describe('dev console', () => {
  it('renders every sample frame in the gallery without a server', async () => {
    const hud = new MockHud();
    hud.offline = true;
    const root = start(hud, 'gallery');
    const cards = root.querySelectorAll('.gallery__card');
    expect(cards).toHaveLength(SAMPLE_FRAME_NAMES.length);
    expect(root.querySelectorAll('.gallery__card .hud')).toHaveLength(SAMPLE_FRAME_NAMES.length);
    expect(text(cards[0])).toContain('City nav');
    // A thumbnail is the real HUD, scaled: 800 px wide at 320 px.
    const hudLayer = root.querySelector<HTMLElement>('.gallery__card .preview__hud')!;
    expect(hudLayer.style.width).toBe('800px');
    expect(hudLayer.style.transform).toBe('scale(0.4)');
    expect(root.querySelector('.gallery__card .preview__backdrop')).not.toBeNull();

    await click(cards[1]!);
    expect(text(root.querySelector('.lightbox h2'))).toBe('Highway cruise');
    await press(window, 'ArrowRight');
    expect(text(root.querySelector('.lightbox h2'))).toBe('Highway exit lanes');
    await press(window, 'Escape');
    expect(root.querySelector('.lightbox')).toBeNull();
  });

  it('drives the simulator through POST /api/sim', async () => {
    const hud = new MockHud({ simulated: true });
    const root = start(hud);
    await waitFor(() =>
      text(root.querySelector('.sim-status')).includes('city: approaching junction'),
    );
    expect(text(root.querySelector('.sim-status'))).toContain('48 km/h');

    await click(button(root, 'Manual'));
    await click(byText(root, '.dseg__item', '3')!);
    await click(button(root, 'Incoming call'));
    await click(byText(root, 'button.dchip', 'P0420')!);
    await waitFor(() => simBodies(hud).length === 4);
    expect(simBodies(hud)).toEqual([
      { mode: 'manual' },
      { gear: 3 },
      { phone: { kind: 'incoming-call', name: 'Maria Lopez' } },
      { dtcs: ['P0420'] },
    ]);
    await waitFor(
      () => byText(root, 'button.dchip', 'P0420')?.getAttribute('aria-pressed') === 'true',
    );
    await click(byText(root, 'button.dchip', 'P0420')!);
    await waitFor(() => simBodies(hud).length === 5);
    expect(simBodies(hud)[4]).toEqual({ dtcs: [] });

    const custom = root.querySelector<HTMLInputElement>('input[aria-label="Custom trouble code"]')!;
    await type(custom, 'x9');
    expect(text(root.querySelector('.sim-hint--error'))).toMatch(/Codes look like/);
    await type(custom, 'p0301');
    expect(button(root, 'Inject').disabled).toBe(false);
    await act(async () => {
      custom.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => simBodies(hud).length === 6);
    expect(simBodies(hud)[5]).toEqual({ dtcs: ['P0301'] });
  });

  it('sends overrides, ADAS and tyre pressures', async () => {
    const hud = new MockHud({ simulated: true });
    const root = start(hud);
    await waitFor(() => root.querySelector('.sim-status dd')?.textContent !== '–');
    const coolantToggle = byText(root, 'label.dswitch', 'Coolant')!.querySelector('input')!;
    await act(async () => {
      coolantToggle.click();
    });
    const blindLeft = byText(root, 'label.dswitch', 'Blind spot left')!.querySelector('input')!;
    await act(async () => {
      blindLeft.click();
    });
    await click(byText(root, '.dseg__item', 'Warning')!);
    const tpms = byText(root, 'label.dswitch', 'Report TPMS')!.querySelector('input')!;
    await act(async () => {
      tpms.click();
    });
    await waitFor(() => simBodies(hud).length === 4);
    expect(simBodies(hud)).toEqual([
      { coolantOverrideC: 118 },
      { adas: { blindSpotLeft: true } },
      { adas: { collision: 'warning' } },
      { tirePressuresKpa: { fl: 230, fr: 230, rl: 230, rr: 230 } },
    ]);
  });

  it('hides the simulator on a real vehicle', async () => {
    const root = start(new MockHud({ simulated: false }));
    await waitFor(() =>
      text(root.querySelector('.live__side')).includes('Connected to a real vehicle'),
    );
    expect(root.querySelector('.sim-fields')).toBeNull();
    // Driver inputs still work on a real car.
    expect(root.querySelectorAll('.input-pad__button')).toHaveLength(7);
  });

  it('explains when the server is unreachable and disables the controls', async () => {
    const hud = new MockHud({ simulated: true });
    hud.offline = true;
    const root = start(hud);
    await waitFor(() =>
      text(root.querySelector('.live__side')).includes('HUD server not reachable'),
    );
    expect(root.querySelector<HTMLFieldSetElement>('.sim-fields')!.disabled).toBe(true);
    expect(text(root.querySelector('.feed-badge'))).toBe('No feed · retrying');
    expect(text(root.querySelector('.preview-caption'))).toContain('No live frames');
  });

  it('sends driver inputs from buttons and keyboard shortcuts, but not while typing', async () => {
    const hud = new MockHud({ simulated: true });
    const root = start(hud);
    await click(button(root, 'Accept'));
    await press(document.body, 'ArrowRight');
    await press(document.body, 'b');
    const custom = root.querySelector<HTMLInputElement>('input[aria-label="Custom trouble code"]')!;
    await press(custom, 'b');
    await press(document.body, 'x');
    await waitFor(() => hud.requests.filter((r) => r.path === '/api/input').length === 3);
    await settle(20);
    expect(hud.requests.filter((r) => r.path === '/api/input').map((r) => r.body)).toEqual([
      { action: 'primary' },
      { action: 'next-page' },
      { action: 'toggle-blank' },
    ]);
  });

  it('previews live frames and logs what changes between them', async () => {
    const root = start(new MockHud({ simulated: true }));
    const socket = FakeSocket.latest();
    await act(async () => {
      socket.open();
      socket.receiveJson({ t: 'frame', frame: SAMPLE_FRAMES['city-nav'] });
    });
    await waitFor(() => root.querySelector('.feed-badge--live'));
    expect(text(root.querySelector('.preview-caption'))).toContain('Context city');
    await act(async () => {
      socket.receiveJson({ t: 'frame', frame: SAMPLE_FRAMES['check-engine'] });
    });
    await act(async () => {
      socket.receiveJson({ t: 'frame', frame: SAMPLE_FRAMES['incoming-call'] });
    });
    const log = await waitFor(() => {
      const entries = [...root.querySelectorAll('.event__text')].map((e) => text(e));
      return entries.length >= 4 ? entries : null;
    });
    // Newest frame first; within a frame, the order the changes were derived in.
    expect(log).toEqual([
      'Context Stopped → City',
      'Alert gone: CHECK ENGINE',
      'Call ringing: Maria Lopez',
      'Context City → Stopped',
      'Alert: CHECK ENGINE — P0420 – Catalytic converter efficiency',
      'Feed live · City',
    ]);
    await click(button(root, 'Clear'));
    expect(root.querySelector('.event__text')).toBeNull();
  });

  it('switches tabs, panel size and backdrop, remembering them', async () => {
    const hud = new MockHud();
    hud.offline = true;
    const root = start(hud);
    const panel = byText<HTMLLabelElement>(root, 'label.dev-select', 'Panel')!.querySelector(
      'select',
    )!;
    await act(async () => {
      panel.value = '2';
      panel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(root.querySelector<HTMLElement>('.preview__frame')!.dataset.panel).toBe('1280x480');
    const backdrop = byText<HTMLLabelElement>(
      root,
      'label.dev-select',
      'Behind the glass',
    )!.querySelector('select')!;
    await act(async () => {
      backdrop.value = 'none';
      backdrop.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(root.querySelector('.preview__backdrop')).toBeNull();
    await click(byText(root, '.dev-tab', 'Gallery')!);
    expect(root.querySelector('.gallery')).not.toBeNull();
    expect(location.hash).toBe('#gallery');
    expect(JSON.parse(localStorage.getItem('carheadsup.dev')!)).toEqual({
      tab: 'gallery',
      panel: 2,
      backdrop: 'none',
    });
  });
});
