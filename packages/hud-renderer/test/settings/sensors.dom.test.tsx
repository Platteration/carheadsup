// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { createHudApi, memoryTokenStore } from '../../src/common/api.ts';
import { SettingsApp } from '../../src/settings/App.tsx';
import { button, click, field, mount, press, section, text, type, waitFor } from './dom.ts';
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

async function start(hud: MockHud): Promise<HTMLElement> {
  const api = createHudApi({ fetch: hud.fetch, tokens: memoryTokenStore() });
  mounted = mount(<SettingsApp api={api} editorOptions={{ liveDelayMs: 20 }} />);
  const root = mounted.container;
  await waitFor(
    () => root.querySelector('.pill--online') && root.querySelector('section#sensors .field'),
  );
  return root;
}

const saveBar = (root: HTMLElement) => root.querySelector<HTMLElement>('.save-bar');
const patches = (hud: MockHud) =>
  hud.requests.filter((r) => r.method === 'PATCH').map((r) => r.body);

const SENDERS = 'Accept data only from';
/** The whole editor: warning, field and the list of addresses. */
const editor = (root: HTMLElement) => {
  const found = section(root, 'sensors').querySelector<HTMLElement>('.allowed-senders');
  if (!found) throw new Error('no allowed-senders editor');
  return found;
};
/** The field itself: label, input, Add, hint or error. */
const senders = (root: HTMLElement) => field(editor(root), SENDERS);
const addInput = (root: HTMLElement) => senders(root).querySelector<HTMLInputElement>('input')!;
const listed = (root: HTMLElement) =>
  [...editor(root).querySelectorAll('.address-list code')].map((c) => text(c));
const errorOf = (root: HTMLElement) => text(senders(root).querySelector('.field__error'));
const warning = (root: HTMLElement) =>
  section(root, 'sensors').querySelector<HTMLElement>('.notice--warning');

async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new FocusEvent('blur'));
  });
}

function withAdas(hud: MockHud, port: number | null, allowed: string[]): MockHud {
  hud.config.sensors = { ...hud.config.sensors, adasUdpPort: port, adasAllowedSenders: allowed };
  return hud;
}

describe('ADAS sender allow-list', () => {
  it('appears once the feed has a port, warning while any device may send', async () => {
    const root = await start(new MockHud());
    const sensors = section(root, 'sensors');
    expect(() => senders(root)).toThrow();
    expect(warning(root)).toBeNull();
    const port = field(sensors, 'collision feed').querySelector('input')!;
    await type(port, '5005');
    expect(listed(root)).toEqual([]);
    expect(text(warning(root))).toContain('Any device on the car’s network can send warnings');
  });

  it('adds addresses in canonical form and saves them with the port', async () => {
    const hud = new MockHud();
    const root = await start(hud);
    await type(field(section(root, 'sensors'), 'collision feed').querySelector('input')!, '5005');
    await type(addInput(root), ' ::FFFF:10.42.0.50 ');
    await click(button(senders(root), 'Add'));
    expect(listed(root)).toEqual(['10.42.0.50']);
    expect(addInput(root).value).toBe('');
    expect(warning(root)).toBeNull();
    // Enter adds too; IPv6 is shortened and lower-cased.
    await type(addInput(root), '2001:0DB8:0:0:0:0:0:7');
    await press(addInput(root), 'Enter');
    expect(listed(root)).toEqual(['10.42.0.50', '2001:db8::7']);
    expect(senders(root).classList.contains('field--dirty')).toBe(true);

    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => text(saveBar(root)) === 'Saved');
    expect(patches(hud)).toEqual([
      { sensors: { adasUdpPort: 5005, adasAllowedSenders: ['10.42.0.50', '2001:db8::7'] } },
    ]);
    expect(hud.config.sensors.adasAllowedSenders).toEqual(['10.42.0.50', '2001:db8::7']);
  });

  it('refuses what is not an address, and duplicates', async () => {
    const root = await start(withAdas(new MockHud(), 5005, ['10.42.0.50']));
    const input = addInput(root);
    await type(input, '10.42.0');
    // No complaint while typing…
    expect(errorOf(root)).toBe('');
    // …but on Add (or leaving the box).
    await click(button(senders(root), 'Add'));
    expect(errorOf(root)).toBe('Enter an IPv4 or IPv6 address, e.g. 10.42.0.50');
    expect(listed(root)).toEqual(['10.42.0.50']);
    await type(input, 'adas.local');
    await blur(input);
    expect(errorOf(root)).toBe('Enter an IPv4 or IPv6 address, e.g. 10.42.0.50');
    await type(input, '::ffff:10.42.0.50');
    await press(input, 'Enter');
    expect(errorOf(root)).toBe('10.42.0.50 is already in the list');
    expect(listed(root)).toEqual(['10.42.0.50']);
    await type(input, '');
    expect(errorOf(root)).toBe('');
    expect(saveBar(root)).toBeNull();
  });

  it('does not let an address typed but not added be lost on Save', async () => {
    const hud = withAdas(new MockHud(), 5005, ['10.42.0.50']);
    const root = await start(hud);
    await type(field(section(root, 'sensors'), 'collision feed').querySelector('input')!, '5006');
    await type(addInput(root), '10.42.0.51');
    await blur(addInput(root));
    expect(errorOf(root)).toBe('Press Add to include 10.42.0.51, or clear the box');
    expect(text(saveBar(root))).toContain('1 field needs fixing');
    await click(button(senders(root), 'Add'));
    expect(errorOf(root)).toBe('');
    expect(button(saveBar(root)!, 'Save').disabled).toBe(false);
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => patches(hud).length === 1);
    expect(patches(hud)[0]).toEqual({
      sensors: { adasUdpPort: 5006, adasAllowedSenders: ['10.42.0.50', '10.42.0.51'] },
    });
  });

  it('removes addresses, warning again when the list is empty', async () => {
    const hud = withAdas(new MockHud(), 5005, ['10.42.0.50', '10.42.0.51']);
    const root = await start(hud);
    expect(warning(root)).toBeNull();
    await click(button(editor(root), 'Remove 10.42.0.50'));
    expect(listed(root)).toEqual(['10.42.0.51']);
    await click(button(editor(root), 'Remove 10.42.0.51'));
    expect(listed(root)).toEqual([]);
    expect(warning(root)).not.toBeNull();
    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => patches(hud).length === 1);
    expect(patches(hud)[0]).toEqual({ sensors: { adasAllowedSenders: [] } });
  });

  it('stops adding at the limit', async () => {
    const full = Array.from({ length: 32 }, (_, i) => `10.42.0.${i + 1}`);
    const root = await start(withAdas(new MockHud(), 5005, full));
    expect(listed(root)).toHaveLength(32);
    expect(button(senders(root), 'Add').disabled).toBe(true);
    expect(addInput(root).disabled).toBe(true);
    expect(text(senders(root))).toContain('At most 32 addresses');
  });

  it('clears a half-typed address on Discard', async () => {
    const root = await start(withAdas(new MockHud(), 5005, []));
    await type(addInput(root), '10.42.0.60');
    await click(button(senders(root), 'Add'));
    await type(addInput(root), '10.4');
    await blur(addInput(root));
    await click(button(saveBar(root)!, 'Discard'));
    expect(listed(root)).toEqual([]);
    expect(addInput(root).value).toBe('');
    expect(errorOf(root)).toBe('');
    expect(saveBar(root)).toBeNull();
  });
});
