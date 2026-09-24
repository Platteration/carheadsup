// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHudApi, memoryTokenStore } from '../../src/common/api.ts';
import type { HudApi } from '../../src/common/api.ts';
import { HudApiError } from '../../src/common/api.ts';
import { SettingsApp, connectionOf } from '../../src/settings/App.tsx';
import {
  byText,
  button,
  check,
  click,
  field,
  mount,
  press,
  section,
  settle,
  text,
  type,
  waitFor,
} from './dom.ts';
import type { Mounted } from './dom.ts';
import { MockHud } from './mock-hud.ts';

let mounted: Mounted | null = null;
let savedIO: unknown;

beforeEach(() => {
  // happy-dom's IntersectionObserver never reports; without it sections count as on screen.
  savedIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = savedIO;
  vi.restoreAllMocks();
});

function start(
  hud: MockHud,
  api: HudApi = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore() }),
) {
  mounted = mount(<SettingsApp api={api} editorOptions={{ liveDelayMs: 20 }} />);
  return mounted.container;
}

async function ready(root: HTMLElement): Promise<void> {
  await waitFor(
    () => root.querySelector('.pill--online') && root.querySelector('section#display .field'),
  );
}

const saveBar = (root: HTMLElement) => root.querySelector<HTMLElement>('.save-bar');
const patches = (hud: MockHud) =>
  hud.requests.filter((r) => r.method === 'PATCH').map((r) => r.body);

describe('settings app', () => {
  it('shows live status, codes, trips, service items and every settings section', async () => {
    const root = start(new MockHud({ simulated: true }));
    await ready(root);
    expect(text(root.querySelector('.pill'))).toBe('Simulator');
    expect(text(section(root, 'status'))).toContain('OBDLink MX+ (STN2255)');
    await waitFor(() => text(section(root, 'diagnostics')).includes('P0420'));
    expect(text(section(root, 'diagnostics'))).toContain('Catalytic converter efficiency');
    expect(text(section(root, 'diagnostics'))).toContain('Check engine on');
    await waitFor(() => text(section(root, 'trips')).includes('42.7 km'));
    expect(text(section(root, 'trips'))).toContain('5 trips');
    await waitFor(() => text(section(root, 'maintenance')).includes('Overdue by 12 days'));
    for (const id of [
      'display',
      'projection',
      'layout',
      'shift-light',
      'alerts',
      'units',
      'vehicle',
      'phone',
      'obd',
      'sensors',
      'server',
    ]) {
      expect(section(root, id).querySelector('.card, .field, details')).not.toBeNull();
    }
    expect(root.querySelectorAll('.section-nav__link')).toHaveLength(15);
    expect(root.querySelector('[data-testid="layout-preview"] .hud')).not.toBeNull();
    expect(saveBar(root)).toBeNull();
  });

  it('saves only the changed subtree', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const input = field(section(root, 'alerts'), 'Warn at').querySelector('input')!;
    expect(input.value).toBe('110');
    await type(input, '105');
    expect(text(saveBar(root))).toContain('1 unsaved change');
    expect(field(section(root, 'alerts'), 'Warn at').classList.contains('field--dirty')).toBe(true);
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => text(saveBar(root)) === 'Saved');
    expect(patches(hud)).toEqual([{ alerts: { coolantHighC: 105 } }]);
    expect(hud.config.alerts.coolantHighC).toBe(105);
    expect(field(section(root, 'alerts'), 'Warn at').classList.contains('field--dirty')).toBe(
      false,
    );
  });

  it('converts display units back to canonical ones when saving', async () => {
    const hud = new MockHud();
    hud.config.units = { ...hud.config.units, system: 'imperial', temperature: 'F' };
    const root = start(hud);
    await ready(root);
    const input = field(section(root, 'alerts'), 'Warn at').querySelector('input')!;
    expect(input.value).toBe('230');
    expect(text(field(section(root, 'alerts'), 'Warn at'))).toContain('°F');
    await type(input, '221');
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => patches(hud).length === 1);
    expect(patches(hud)[0]).toEqual({ alerts: { coolantHighC: 105 } });
  });

  it('validates instantly and blocks saving until fixed', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const alerts = section(root, 'alerts');
    const critical = field(alerts, 'Critical at').querySelector('input')!;
    await type(critical, '170');
    expect(text(field(alerts, 'Critical at').querySelector('.field__error'))).toBe(
      'Must be at most 160 °C',
    );
    expect(text(saveBar(root))).toContain('1 field needs fixing');
    // Save is replaced by "Show", which jumps to the problem.
    expect(byText(saveBar(root)!, 'button', 'Save')).toBeNull();
    const scrolled = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);
    await click(button(saveBar(root)!, 'Show'));
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(critical);

    await type(critical, 'hot');
    expect(text(field(alerts, 'Critical at').querySelector('.field__error'))).toBe(
      'Enter a number',
    );

    await type(critical, '100');
    expect(text(field(alerts, 'Warn at').querySelector('.field__error'))).toBe(
      'Must be below the critical temperature',
    );

    await type(critical, '118,5');
    expect(field(alerts, 'Critical at').querySelector('.field__error')).toBeNull();
    expect(button(saveBar(root)!, 'Save').disabled).toBe(false);
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => patches(hud).length === 1);
    expect(patches(hud)[0]).toEqual({ alerts: { coolantCriticalC: 118.5 } });
  });

  it('shows the server’s validation errors next to the fields', async () => {
    const hud = new MockHud();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await hud.fetch(input, init);
      if (init?.method !== 'PATCH') return response;
      const body = (await response.json()) as { config: unknown; errors: string[] };
      return new Response(
        JSON.stringify({ ...body, errors: ['display.maxAlerts: expected number <= 2'] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };
    const root = start(hud, createHudApi({ fetch, tokens: memoryTokenStore() }));
    await ready(root);
    const radios = field(
      section(root, 'display'),
      'Alerts shown at once',
    ).querySelectorAll<HTMLInputElement>('input[type=radio]');
    await check(radios[3]!, true);
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() =>
      text(field(section(root, 'display'), 'Alerts shown at once')).includes(
        'Not saved: must be at most 2',
      ),
    );
    expect(text(saveBar(root))).toContain('the HUD rejected 1 value');
  });

  it('applies projection changes live, debounced, without Save', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const projection = section(root, 'projection');
    const mirror = field(projection, 'Mirror top').querySelector<HTMLInputElement>(
      'input[type=checkbox]',
    )!;
    await check(mirror, true);
    const grid = field(projection, 'calibration grid').querySelector<HTMLInputElement>(
      'input[type=checkbox]',
    )!;
    await check(grid, true);
    await waitFor(() => patches(hud).length === 1 && hud.config.display.projection.showGrid);
    // Both edits within the debounce window went out together.
    expect(patches(hud)).toEqual([{ display: { projection: { mirrorY: true, showGrid: true } } }]);
    expect(saveBar(root)).toBeNull();
    await settle(60);
    expect(patches(hud)).toHaveLength(1);
    expect(text(projection.querySelector('.section__aside'))).toBe('Live');
  });

  it('moves keystone corners with the keyboard and sends them live', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const handle = section(root, 'projection').querySelector<HTMLButtonElement>(
      '[data-corner="tl"]',
    )!;
    await keydown(handle, 'ArrowRight', true);
    await keydown(handle, 'ArrowDown', false);
    await waitFor(() => patches(hud).length === 1);
    expect(hud.config.display.projection.corners.tl).toEqual([0.01, 0.002]);
    expect(text(section(root, 'projection').querySelector('.keystone__readout'))).toBe(
      'Top left x 1.0 %, y 0.2 %',
    );
    await click(button(section(root, 'projection'), 'Reset corners'));
    await waitFor(() => hud.config.display.projection.corners.tl[0] === 0);
  });

  it('reports a live change that did not reach the HUD and retries it', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const projection = section(root, 'projection');
    hud.offline = true;
    await check(field(projection, 'Mirror top').querySelector<HTMLInputElement>('input')!, true);
    await waitFor(() => text(projection.querySelector('.section__aside')) === 'Not applied');
    expect(text(projection)).toContain('Not applied to the HUD');
    expect(hud.config.display.projection.mirrorY).toBe(false);
    hud.offline = false;
    await click(button(projection, 'Retry'));
    await waitFor(() => hud.config.display.projection.mirrorY);
    await waitFor(() => text(projection.querySelector('.section__aside')) === 'Live');
  });

  it('keeps edits made while a save is in flight', async () => {
    const hud = new MockHud();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === 'PATCH') await gate;
      return hud.fetch(input, init);
    };
    const root = start(hud, createHudApi({ fetch, tokens: memoryTokenStore() }));
    await ready(root);
    const alerts = section(root, 'alerts');
    await type(field(alerts, 'Warn at').querySelector('input')!, '105');
    await click(button(saveBar(root)!, 'Save'));
    // While the PATCH is pending, change another field.
    await type(field(alerts, 'Low fuel below').querySelector('input')!, '15');
    release();
    await waitFor(() => hud.config.alerts.coolantHighC === 105);
    await waitFor(() => text(saveBar(root)).includes('1 unsaved change'));
    expect(field(alerts, 'Low fuel below').querySelector('input')!.value).toBe('15');
    expect(hud.config.alerts.fuelLowPct).toBe(12);
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => hud.config.alerts.fuelLowPct === 15);
    expect(patches(hud)).toEqual([
      { alerts: { coolantHighC: 105 } },
      { alerts: { fuelLowPct: 15 } },
    ]);
  });

  it('refreshes the service list after the schedule is saved, not after other saves', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const maintenanceGets = () => hud.requests.filter((r) => r.path === '/api/maintenance').length;
    await waitFor(() => maintenanceGets() === 1);
    await type(field(section(root, 'alerts'), 'Warn at').querySelector('input')!, '104');
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => text(saveBar(root)) === 'Saved');
    expect(maintenanceGets()).toBe(1);
    const schedule = section(root, 'maintenance').querySelector('.schedule__item')!;
    await type(field(schedule, 'Every').querySelector('input')!, '9000');
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => maintenanceGets() === 2);
    expect(hud.config.maintenance.items[0]?.intervalKm).toBe(9000);
  });

  it('discards edits', async () => {
    const root = start(new MockHud());
    await ready(root);
    const input = field(section(root, 'vehicle'), 'Redline').querySelector('input')!;
    await type(input, '7000x');
    expect(saveBar(root)).toBeNull();
    await type(input, '7200');
    await click(button(saveBar(root)!, 'Discard'));
    expect(field(section(root, 'vehicle'), 'Redline').querySelector('input')!.value).toBe('6500');
    expect(saveBar(root)).toBeNull();
  });

  it('switches layout presets and starts a custom layout from the current one', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const layout = section(root, 'layout');
    const presetRadio = (name: string) =>
      [...layout.querySelectorAll<HTMLInputElement>('input[name=layout-preset]')].find((r) =>
        text(r.parentElement).startsWith(name),
      )!;
    await check(presetRadio('Sport'), true);
    expect(presetRadio('Sport').checked).toBe(true);
    expect(text(saveBar(root))).toContain('1 unsaved change');
    await click(button(layout, 'Customise sport'));
    expect(layout.querySelectorAll('.widget-row')).toHaveLength(17);
    const clock = layout.querySelector<HTMLElement>('.widget-row[data-widget="clock"]')!;
    const highway = byText<HTMLLabelElement>(clock, 'label.chip', 'Highway')!.querySelector(
      'input',
    )!;
    await check(highway, true);
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => patches(hud).length === 1);
    const sent = patches(hud)[0] as {
      display: { layout: { preset: string; widgets: Array<{ id: string; contexts: string[] }> } };
    };
    expect(sent.display.layout.preset).toBe('custom');
    // The sport preset shows the clock except on the highway; now it shows everywhere.
    expect(sent.display.layout.widgets.find((w) => w.id === 'clock')?.contexts).toEqual([
      'parked',
      'stopped',
      'city',
      'highway',
    ]);
    expect(sent.display.layout.widgets[0]?.id).toBe('speed');
  });

  it('asks before clearing trouble codes and shows the HUD’s refusal', async () => {
    const hud = new MockHud({ refuseClear: true });
    const root = start(hud);
    await ready(root);
    await waitFor(() => text(section(root, 'diagnostics')).includes('P0420'));
    await click(button(section(root, 'diagnostics'), 'Clear trouble codes…'));
    const dialog = root.querySelector<HTMLElement>('[role=dialog]')!;
    expect(text(dialog)).toContain('resets the emissions readiness monitors');
    expect(hud.writes()).toEqual([]);
    await click(button(dialog, 'Clear codes'));
    await waitFor(() =>
      text(section(root, 'diagnostics')).includes(
        'Park and switch the engine off before clearing codes.',
      ),
    );
    expect(hud.writes().map((r) => r.path)).toEqual(['/api/diagnostics/clear-dtcs']);
    expect(root.querySelector('[role=dialog]')).toBeNull();
  });

  it('keeps keyboard focus inside the clear-codes dialog', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    await waitFor(() => text(section(root, 'diagnostics')).includes('P0420'));
    const opener = button(section(root, 'diagnostics'), 'Clear trouble codes…');
    opener.focus();
    await click(opener);
    const dialog = root.querySelector<HTMLElement>('[role=dialog]')!;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    expect(document.activeElement).toBe(first);
    const tab = async (shift: boolean) =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey: shift,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    last.focus();
    await tab(false);
    expect(document.activeElement).toBe(first);
    await tab(true);
    expect(document.activeElement).toBe(last);
    // Focus pushed to the page behind comes straight back.
    opener.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await press(document.activeElement!, 'Escape');
    expect(root.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does not pretend to download the trips CSV inside the companion app', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36',
    );
    const copied: string[] = [];
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (value: string) => {
      copied.push(value);
    });
    const blobs = vi.spyOn(URL, 'createObjectURL');
    const root = start(new MockHud());
    await ready(root);
    const trips = () => section(root, 'trips');
    await waitFor(() => !button(trips(), 'Download CSV').disabled);
    await click(button(trips(), 'Download CSV'));
    await waitFor(() => text(trips()).includes('copied to the clipboard'));
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain('trip-5');
    expect(blobs).not.toHaveBeenCalled();
  });

  it('saves the trips CSV through the companion app when it offers to', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36',
    );
    const saveFile = vi.fn((_text: string, _name: string, _type: string) => 'saved');
    const host = globalThis as { CarheadsupAndroid?: unknown };
    host.CarheadsupAndroid = { saveFile };
    try {
      const root = start(new MockHud());
      await ready(root);
      const trips = () => section(root, 'trips');
      await waitFor(() => !button(trips(), 'Download CSV').disabled);
      await click(button(trips(), 'Download CSV'));
      await waitFor(() => text(trips()).includes('Downloads'));
      expect(saveFile).toHaveBeenCalledTimes(1);
      const [csv, name, type] = saveFile.mock.calls[0]!;
      expect(csv).toContain('trip-5');
      expect(name).toMatch(/\.csv$/);
      expect(type).toMatch(/^text\/csv/);
    } finally {
      delete host.CarheadsupAndroid;
    }
  });

  it('deletes a trip after confirmation', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const trips = section(root, 'trips');
    await waitFor(() => trips.querySelectorAll('.trip').length === 5);
    await click(button(trips.querySelector('.trip')!, 'Delete…'));
    await click(button(trips.querySelector('.trip')!, 'Delete'));
    await waitFor(() => trips.querySelectorAll('.trip').length === 4);
    expect(hud.writes().map((r) => `${r.method} ${r.path}`)).toEqual(['DELETE /api/trips/trip-5']);
  });

  it('marks a service done with the odometer pre-filled', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const maintenance = section(root, 'maintenance');
    await waitFor(() => maintenance.querySelector('.service'));
    await click(button(maintenance.querySelector('.service--due-soon')!, 'Mark done'));
    const input = await waitFor(() => {
      const el = root.querySelector<HTMLInputElement>('#done-odometer');
      return el && el.value !== '' ? el : null;
    });
    expect(input.value).toBe('58012');
    await click(button(root.querySelector('[role=dialog]')!, 'Save'));
    await waitFor(() => hud.writes().length === 1);
    expect(hud.writes()[0]).toMatchObject({
      path: '/api/maintenance/oil/done',
      body: { odometerKm: 58_012 },
    });
  });

  it('shows a clear offline state and recovers when the HUD answers', async () => {
    const hud = new MockHud();
    hud.offline = true;
    const root = start(hud);
    await waitFor(() => root.querySelector('.pill--offline'));
    expect(text(section(root, 'status'))).toContain('HUD not reachable');
    expect(text(section(root, 'display'))).toContain('Available once the HUD is reachable.');
    expect(text(section(root, 'trips'))).toContain('Available once the HUD is reachable.');
    hud.offline = false;
    await click(button(section(root, 'status'), 'Retry'));
    await ready(root);
    expect(text(section(root, 'status'))).not.toContain('HUD not reachable');
  });

  it('asks for the access token when the HUD requires one', async () => {
    const hud = new MockHud({ token: 'let-me-in' });
    const tokens = memoryTokenStore();
    const root = start(hud, createHudApi({ fetch: hud.fetch, tokens }));
    await waitFor(() => root.querySelector('.pill--locked'));
    expect(text(section(root, 'display'))).toContain('Enter the access token under Status');
    const input = section(root, 'status').querySelector<HTMLInputElement>('#api-token')!;
    await type(input, 'let-me-in');
    await click(button(section(root, 'status'), 'Use'));
    await ready(root);
    expect(tokens.get()).toBe('let-me-in');
  });

  it('never blocks saving because of a stored token the HUD accepts', async () => {
    const hud = new MockHud();
    hud.config.server.apiToken = 'old secret'; // inner spaces: accepted by the HUD
    hud.config.phone.pairingToken = 'schlüssel'; // travels inside JSON: any text works
    const root = start(hud);
    await ready(root);
    expect(field(section(root, 'server'), 'API token').querySelector('.field__error')).toBeNull();
    expect(field(section(root, 'phone'), 'Pairing code').querySelector('.field__error')).toBeNull();
    const name = field(section(root, 'vehicle'), 'Name').querySelector('input')!;
    await type(name, 'Golf');
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => hud.config.vehicle.name === 'Golf');
    expect(hud.config.server.apiToken).toBe('old secret');
    expect(hud.config.phone.pairingToken).toBe('schlüssel');
  });

  it('refuses an API token that no device could ever present', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const tokenField = () => field(section(root, 'server'), 'API token');
    const input = tokenField().querySelector('input')!;
    await type(input, 'correct horse battery');
    expect(text(tokenField().querySelector('.field__error'))).toBe(
      'No spaces: a token is one word of letters, digits and symbols',
    );
    expect(byText(saveBar(root)!, 'button', 'Save')).toBeNull();
    await type(input, 'geheim€');
    expect(text(tokenField().querySelector('.field__error'))).toContain('Only plain letters');
    // A pasted token with a stray space or line break is simply trimmed.
    await type(input, '  s3cret\n');
    expect(input.value).toBe('s3cret');
    expect(tokenField().querySelector('.field__error')).toBeNull();
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => hud.config.server.apiToken === 's3cret');
    // The same rules apply to the phone's pairing code.
    const pairing = field(section(root, 'phone'), 'Pairing code');
    await type(pairing.querySelector('input')!, 'my code');
    expect(text(pairing.querySelector('.field__error'))).toContain('No spaces');
  });

  it('shows whether phones must pair, and makes a pairing code with one tap', async () => {
    const hud = new MockHud();
    const root = start(hud);
    await ready(root);
    const phone = () => section(root, 'phone');
    const status = () => text(phone().querySelector('.section__aside'));
    expect(status()).toBe('Paired');
    expect(phone().querySelector('.notice')).toBeNull();

    // Without a code the HUD is open: said plainly, with the way out right there.
    const input = field(phone(), 'Pairing code').querySelector('input')!;
    await type(input, '');
    expect(status()).toBe('Not paired · open');
    const notice = phone().querySelector('.notice');
    expect(notice?.classList.contains('notice--warning')).toBe(true);
    expect(text(notice)).toContain('Any phone on the car’s Wi-Fi can connect');
    expect(text(notice)).toContain('cannot verify');

    await click(button(phone(), 'Generate pairing code'));
    expect(input.value).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(status()).toBe('Paired');
    expect(phone().querySelector('.notice')).toBeNull();
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => hud.config.phone.pairingToken === input.value);
  });

  it('keeps a live change reverted while its PATCH was in flight', async () => {
    const hud = new MockHud();
    let release: () => void = () => undefined;
    let held = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === 'PATCH' && held++ === 0) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return hud.fetch(input, init);
    };
    const root = start(hud, createHudApi({ fetch, tokens: memoryTokenStore() }));
    await ready(root);
    const grid = () =>
      field(section(root, 'projection'), 'calibration grid').querySelector<HTMLInputElement>(
        'input[type=checkbox]',
      )!;
    await check(grid(), true);
    await waitFor(() => held === 1);
    // Switched off again before the HUD answered the "on".
    await check(grid(), false);
    release();
    await waitFor(() => patches(hud).length === 2);
    expect(patches(hud)).toEqual([
      { display: { projection: { showGrid: true } } },
      { display: { projection: { showGrid: false } } },
    ]);
    await waitFor(() => !hud.config.display.projection.showGrid);
    expect(grid().checked).toBe(false);
  });

  it('keeps unsaved edits when a new access token is entered', async () => {
    const hud = new MockHud({ token: 'old-token' });
    const api = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore('old-token') });
    const root = start(hud, api);
    await ready(root);
    const vehicle = section(root, 'vehicle');
    await type(field(vehicle, 'Name').querySelector('input')!, 'Weekend car');
    await type(field(vehicle, 'Redline').querySelector('input')!, '7200');
    expect(text(saveBar(root))).toContain('2 unsaved changes');
    // The token was rotated from another device: the save is refused.
    hud.options.token = 'new-token';
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => text(saveBar(root)).includes('valid access token'));
    await type(section(root, 'status').querySelector<HTMLInputElement>('#api-token')!, 'new-token');
    await click(button(section(root, 'status'), 'Use'));
    await waitFor(() => hud.requests.filter((r) => r.path === '/api/config').length >= 2);
    await settle(50);
    expect(field(section(root, 'vehicle'), 'Name').querySelector('input')!.value).toBe(
      'Weekend car',
    );
    expect(field(section(root, 'vehicle'), 'Redline').querySelector('input')!.value).toBe('7200');
    expect(text(saveBar(root))).toContain('2 unsaved changes');
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => hud.config.vehicle.name === 'Weekend car');
    expect(hud.config.vehicle.redlineRpm).toBe(7200);
  });

  it('converts entered gear ratios when the unit system changes', async () => {
    const root = start(new MockHud());
    await ready(root);
    const vehicle = () => section(root, 'vehicle');
    await click(byText(vehicle(), '.segmented__item', 'Enter ratios')!.querySelector('input')!);
    const gears = () =>
      [...vehicle().querySelectorAll<HTMLInputElement>('.gear-grid input')].map((i) => i.value);
    const metric = gears();
    expect(metric[0]).toBe('120');
    const units = section(root, 'units');
    await click(byText(units, '.segmented__item', 'mph · miles')!.querySelector('input')!);
    expect(text(vehicle().querySelector('.gear-ratios'))).toContain('rpm per mph');
    // 120 rpm per km/h is 193.1 rpm per mph.
    expect(gears()[0]).toBe('193.1');
    expect(gears()).not.toEqual(metric);
  });

  it('does not pass an armed "Remove" on to the next custom PID', async () => {
    const root = start(new MockHud());
    await ready(root);
    const vehicle = () => section(root, 'vehicle');
    await click(button(vehicle(), 'Add PID'));
    await click(button(vehicle(), 'Add PID'));
    const rows = () => [...vehicle().querySelectorAll<HTMLElement>('.pid-list > .pid')];
    expect(rows()).toHaveLength(2);
    const second = rows()[1]!.querySelector<HTMLSelectElement>('select')!.value;
    await click(button(rows()[0]!, 'Remove…'));
    await click(byText(rows()[0]!, 'button', 'Remove')!);
    expect(rows()).toHaveLength(1);
    // The PID that moved up is the second one, and it is not armed for removal.
    expect(rows()[0]!.querySelector<HTMLSelectElement>('select')!.value).toBe(second);
    expect(byText(rows()[0]!, 'button', 'Keep')).toBeNull();
    expect(button(rows()[0]!, 'Remove…')).toBeTruthy();
  });

  it('shows the pill from the latest status poll, not the last good one', () => {
    const info = { data: { name: 'carheadsup' } };
    expect(connectionOf({ data: null, error: null })).toBe('connecting');
    expect(connectionOf({ ...info, error: null })).toBe('online');
    const offline = new HudApiError({ kind: 'network', message: 'x', method: 'GET', path: '/' });
    expect(connectionOf({ ...info, error: offline })).toBe('offline');
    expect(connectionOf({ data: null, error: offline })).toBe('offline');
    const locked = new HudApiError({
      kind: 'unauthorized',
      message: 'x',
      method: 'GET',
      path: '/',
    });
    expect(connectionOf({ ...info, error: locked })).toBe('locked');
  });

  it('keeps access after changing the API token', async () => {
    const hud = new MockHud();
    const tokens = memoryTokenStore();
    const root = start(hud, createHudApi({ fetch: hud.fetch, tokens }));
    await ready(root);
    const tokenField = field(section(root, 'server'), 'API token');
    await type(tokenField.querySelector('input')!, 'new-token-123');
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => tokens.get() === 'new-token-123');
    expect(hud.config.server.apiToken).toBe('new-token-123');
    expect(hud.writes()).toHaveLength(1);
  });
});

/** Press a key on an element (Shift for the coarse keystone step). */
async function keydown(el: HTMLElement, key: string, shift: boolean): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }),
    );
  });
}
