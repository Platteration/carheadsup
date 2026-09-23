// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHudApi, memoryTokenStore } from '../../src/common/api.ts';
import type { HudApi } from '../../src/common/api.ts';
import { SettingsApp } from '../../src/settings/App.tsx';
import {
  byText,
  button,
  check,
  click,
  field,
  mount,
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
