// @vitest-environment happy-dom
import type { CanButtonRule, SwcWindow } from '@carheadsup/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHudApi, memoryTokenStore } from '../../src/common/api.ts';
import { SettingsApp } from '../../src/settings/App.tsx';
import { button, check, choose, click, field, mount, text, type, waitFor } from './dom.ts';
import type { Mounted } from './dom.ts';
import { MockHud } from './mock-hud.ts';

let mounted: Mounted | null = null;
let savedIO: unknown;

beforeEach(() => {
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
  await waitFor(() => root.querySelector('.pill--online') && root.querySelector('.steering-wheel'));
  return root;
}

const card = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('section#sensors .steering-wheel')!;
const saveBar = (root: HTMLElement) => root.querySelector<HTMLElement>('.save-bar');
const patches = (hud: MockHud) =>
  hud.requests.filter((r) => r.method === 'PATCH').map((r) => r.body);
const input = (container: HTMLElement, label: string) =>
  field(container, label).querySelector<HTMLInputElement>('input')!;
const select = (container: HTMLElement, label: string) =>
  field(container, label).querySelector<HTMLSelectElement>('select')!;
/** Choose an option of a settings select by its visible label. */
async function pick(container: HTMLElement, label: string, option: string): Promise<void> {
  const el = select(container, label);
  const index = [...el.options].findIndex((o) => text(o) === option);
  if (index < 0) throw new Error(`no option "${option}" in "${label}"`);
  await choose(el, el.options[index]!.value);
}
const rows = (root: HTMLElement, list: string) => [
  ...card(root).querySelectorAll<HTMLElement>(`ol[aria-label="${list}"] > li`),
];
const errorOf = (el: HTMLElement) => text(el.querySelector('.field__error'));

describe('steering-wheel buttons', () => {
  it('points to phone pairing first and keeps both methods off by default', async () => {
    const root = await start(new MockHud());
    expect(text(card(root))).toContain('Easiest: pair the phone with the car');
    expect(input(card(root), 'Read buttons from the CAN bus').checked).toBe(false);
    expect(input(card(root), 'Read a resistor ladder').checked).toBe(false);
    expect(() => field(card(root), 'Interface')).toThrow();
    expect(() => field(card(root), 'ADS1115 address')).toThrow();
  });

  it('sets up CAN rules with hex fields and saves them', async () => {
    const hud = new MockHud();
    const root = await start(hud);
    await check(input(card(root), 'Read buttons from the CAN bus'), true);
    expect(input(card(root), 'Interface').value).toBe('can0');
    expect(text(card(root))).toContain(
      'ip link set can0 up type can bitrate 500000 listen-only on',
    );

    await click(button(card(root), 'Add CAN button'));
    let [row] = rows(root, 'CAN button rules');
    // A fresh rule needs its id.
    expect(errorOf(field(row!, 'CAN id'))).toBe('3 hex digits (up to 7FF), or 8 for a 29-bit id');
    await type(input(row!, 'CAN id'), '5c1');
    expect(input(row!, 'CAN id').value).toBe('5C1');
    await type(input(row!, 'Mask'), '0fx');
    expect(input(row!, 'Mask').value).toBe('0F');
    expect(text(row)).toContain('Held while bits 0F of byte 0 read 01 in 11-bit frame 5C1.');
    expect(select(row!, 'Press').selectedOptions[0]?.textContent).toBe('Next page');

    // The next rule continues on the same frame with the next free value and action.
    await click(button(card(root), 'Add CAN button'));
    [, row] = rows(root, 'CAN button rules');
    expect(input(row!, 'CAN id').value).toBe('5C1');
    expect(input(row!, 'Value').value).toBe('02');
    expect(select(row!, 'Press').selectedOptions[0]?.textContent).toBe('Previous page');
    await pick(row!, 'Hold (0.8 s)', 'Blank / unblank HUD');
    expect(text(field(row!, 'Hold (0.8 s)'))).toContain('A short press then acts on release.');

    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => text(saveBar(root)) === 'Saved');
    const rules: CanButtonRule[] = [
      { id: '5C1', byte: 0, mask: '0F', value: '01', action: 'next-page', longPressAction: null },
      {
        id: '5C1',
        byte: 0,
        mask: '0F',
        value: '02',
        action: 'prev-page',
        longPressAction: 'toggle-blank',
      },
    ];
    expect(patches(hud)).toEqual([{ sensors: { canButtons: { interface: 'can0', rules } } }]);
    expect(hud.config.sensors.canButtons.rules).toEqual(rules);
  });

  it('explains invalid rules and blocks saving them', async () => {
    const hud = new MockHud();
    hud.config.sensors.canButtons = {
      interface: 'can0',
      releaseTimeoutMs: 500,
      rules: [
        { id: '5C1', byte: 0, mask: 'FF', value: '01', action: 'next-page', longPressAction: null },
      ],
    };
    const root = await start(hud);
    const [row] = rows(root, 'CAN button rules');
    await type(input(row!, 'Mask'), '0F');
    await type(input(row!, 'Value'), '11');
    expect(errorOf(field(row!, 'Value'))).toBe(
      'Has bits outside the mask, so it could never match',
    );
    await type(input(row!, 'Value'), '1');
    expect(errorOf(field(row!, 'Value'))).toBe('2 hex digits');
    await type(input(row!, 'Value'), '01');
    await type(input(row!, 'Mask'), '00');
    expect(errorOf(field(row!, 'Mask'))).toBe('A mask of 00 would match every frame');
    await type(input(row!, 'CAN id'), '800');
    expect(errorOf(field(row!, 'CAN id'))).toBe('3 hex digits (up to 7FF), or 8 for a 29-bit id');
    await type(input(row!, 'CAN id'), '18FF1234');
    expect(errorOf(field(row!, 'CAN id'))).toBe('');
    await type(input(row!, 'Byte'), '64');
    expect(errorOf(field(row!, 'Byte'))).toBe('Must be at most 63');
    expect(text(saveBar(root))).toContain('need fixing');
    await type(input(row!, 'Byte'), '9');
    await type(input(row!, 'Mask'), 'FF');
    expect(text(row)).toContain('Held while byte 9 reads 01 in 29-bit frame 18FF1234.');

    // A second rule with the same condition.
    await click(button(card(root), 'Add CAN button'));
    const [, second] = rows(root, 'CAN button rules');
    await type(input(second!, 'Value'), '01');
    expect(errorOf(second!)).toBe('Same frame, byte, mask and value as another rule');
    await click(button(second!, 'Remove rule 2…'));
    await click(button(second!, 'Remove rule 2'));
    expect(rows(root, 'CAN button rules')).toHaveLength(1);

    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => text(saveBar(root)) === 'Saved');
    expect(hud.config.sensors.canButtons.rules[0]).toMatchObject({
      id: '18FF1234',
      byte: 9,
      mask: 'FF',
      value: '01',
    });
  });

  it('sets up ladder windows, flagging overlaps and windows over the idle range', async () => {
    const hud = new MockHud();
    const root = await start(hud);
    await check(input(card(root), 'Read a resistor ladder'), true);
    expect(select(card(root), 'ADS1115 address').selectedOptions[0]?.textContent).toBe(
      '0x48 (ADDR to GND)',
    );
    await pick(card(root), 'Input', 'A1');
    expect(text(card(root))).toContain('CARHEADSUP_LOG_LEVEL=debug');

    await click(button(card(root), 'Add ladder button'));
    await click(button(card(root), 'Add ladder button'));
    let [first, second] = rows(root, 'Ladder windows');
    expect(input(first!, 'From').value).toBe('0');
    expect(input(first!, 'To').value).toBe('0.3');
    expect(input(second!, 'From').value).toBe('0.4');
    expect(select(second!, 'Press').selectedOptions[0]?.textContent).toBe('Previous page');

    await type(input(second!, 'From'), '0.2');
    expect(errorOf(second!)).toBe('Overlaps window 1 (0–0.3 V)');
    await type(input(second!, 'From'), '0.8');
    expect(errorOf(second!)).toBe('Must be below the upper end');
    await type(input(second!, 'To'), '3.1');
    expect(text(card(root).querySelector('.button-rules > .field__error'))).toBe(
      'Window 2 (0.8–3.1 V) overlaps the idle range (3–3.6 V)',
    );
    await type(input(second!, 'To'), '1.1');
    [first, second] = rows(root, 'Ladder windows');
    expect(errorOf(second!)).toBe('');

    // A narrower range that would cut off the idle range.
    await pick(card(root), 'Range', '±2.048 V (gain 2)');
    expect(
      errorOf(card(root).querySelector<HTMLElement>('[data-path="sensors.swcButtons.idle"]')!),
    ).toBe('The idle range (3–3.6 V) must lie within the ±2.048 V input range');
    await pick(card(root), 'Range', '±4.096 V (gain 1)');

    await click(button(saveBar(root)!, 'Save'));
    await waitFor(() => text(saveBar(root)) === 'Saved');
    const windows: SwcWindow[] = [
      { minV: 0, maxV: 0.3, action: 'next-page', longPressAction: null },
      { minV: 0.8, maxV: 1.1, action: 'prev-page', longPressAction: null },
    ];
    expect(patches(hud)).toEqual([
      { sensors: { swcButtons: { enabled: true, channel: 1, windows } } },
    ]);
    expect(hud.config.sensors.swcButtons.windows).toEqual(windows);
  });
});
