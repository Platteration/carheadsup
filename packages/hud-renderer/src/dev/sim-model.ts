import { isValidDtc, normalizeDtc } from '@carheadsup/core';
import type { InputAction, SimControl } from '@carheadsup/core';
import type { DtcLookup } from './dtc-lookup.ts';

/** Pure helpers for the dev console's simulator panel and preview. */

export interface PanelSize {
  width: number;
  height: number;
  label: string;
}

/** Common HUD panel resolutions. */
export const PANEL_SIZES: readonly PanelSize[] = [
  { width: 800, height: 480, label: '800 × 480' },
  { width: 1024, height: 600, label: '1024 × 600' },
  { width: 1280, height: 480, label: '1280 × 480' },
  { width: 1920, height: 720, label: '1920 × 720' },
];

export type Backdrop = 'none' | 'night' | 'dusk' | 'day';

export const BACKDROPS: ReadonlyArray<{ value: Backdrop; label: string }> = [
  { value: 'none', label: 'Black' },
  { value: 'night', label: 'Night road' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'day', label: 'Daylight' },
];

// ---------------------------------------------------------------------------------------------
// Ambient light: a logarithmic slider (1 … 100 000 lx spans five decades)

export const LUX_MIN = 1;
export const LUX_MAX = 100_000;

/** Slider position 0–1 → lux, logarithmic, rounded to 2 significant digits. */
export function luxFromSlider(position: number): number {
  const p = Number.isFinite(position) ? Math.min(1, Math.max(0, position)) : 0;
  const lux = LUX_MIN * (LUX_MAX / LUX_MIN) ** p;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(lux)) - 1);
  return Math.round(lux / magnitude) * magnitude;
}

/** Lux → slider position 0–1 (inverse of {@link luxFromSlider}, clamped to the range). */
export function sliderFromLux(lux: number): number {
  if (!Number.isFinite(lux) || lux <= LUX_MIN) return 0;
  if (lux >= LUX_MAX) return 1;
  return Math.log(lux / LUX_MIN) / Math.log(LUX_MAX / LUX_MIN);
}

/** "0.5 lx", "850 lx", "12 k lx" plus a familiar reference point. */
export function describeLux(lux: number): string {
  const value =
    lux >= 10_000
      ? `${Math.round(lux / 1000)} k lx`
      : lux >= 1000
        ? `${(lux / 1000).toFixed(1)} k lx`
        : `${Math.round(lux)} lx`;
  const scene =
    lux < 5
      ? 'dark road'
      : lux < 60
        ? 'street lights'
        : lux < 400
          ? 'dusk / tunnel'
          : lux < 5000
            ? 'overcast'
            : lux < 30_000
              ? 'daylight'
              : 'direct sun';
  return `${value} · ${scene}`;
}

// ---------------------------------------------------------------------------------------------
// Trouble codes

/** Quick-inject codes: catalyst, random misfire, overheating, system voltage, lost ECM comms. */
export const QUICK_DTCS: readonly string[] = ['P0420', 'P0300', 'P0217', 'P0562', 'U0100'];

/** The DTC list with `code` added or removed (normalised, no duplicates, order kept). */
export function toggleDtc(current: readonly string[], code: string, on: boolean): string[] {
  const normalized = normalizeDtc(code);
  const without = current.filter((c) => normalizeDtc(c) !== normalized);
  return on ? [...without, normalized] : without;
}

export type DtcEntryCheck =
  { ok: true; code: string; label: string } | { ok: false; error: string };

/**
 * Validate a typed code for injection and describe it (e.g. "P0420 – Catalytic converter
 * efficiency"); the label is the bare code while the description database is not loaded.
 */
export function checkDtcEntry(text: string, lookup: DtcLookup | null = null): DtcEntryCheck {
  const code = normalizeDtc(text);
  if (code === '') return { ok: false, error: 'Type a code such as P0301' };
  if (!isValidDtc(code))
    return { ok: false, error: 'Codes look like P0301, C1234, B0001 or U0100' };
  return { ok: true, code, label: lookup ? `${code} – ${lookup(code).short}` : code };
}

// ---------------------------------------------------------------------------------------------
// Gears and phone scenarios

export const GEAR_CHOICES: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'Auto' },
  { value: 0, label: 'N' },
  ...[1, 2, 3, 4, 5, 6].map((g) => ({ value: g, label: String(g) })),
];

export type PhoneEvent = NonNullable<SimControl['phone']>;

export const PHONE_ACTIONS: ReadonlyArray<{ label: string; event: PhoneEvent }> = [
  { label: 'Start navigation', event: { kind: 'nav-start' } },
  { label: 'Stop navigation', event: { kind: 'nav-stop' } },
  { label: 'Incoming call', event: { kind: 'incoming-call', name: 'Maria Lopez' } },
  { label: 'End call', event: { kind: 'end-call' } },
  { label: 'Next track', event: { kind: 'next-track' } },
  { label: 'Message', event: { kind: 'message', sender: 'Alex Chen' } },
  { label: 'Speed camera', event: { kind: 'speed-camera' } },
  { label: 'Phone connects', event: { kind: 'connect' } },
  { label: 'Phone disconnects', event: { kind: 'disconnect' } },
];

// ---------------------------------------------------------------------------------------------
// Driver inputs

export const INPUT_BUTTONS: ReadonlyArray<{
  action: InputAction;
  label: string;
  title: string;
  keys: string;
}> = [
  {
    action: 'primary',
    label: 'Accept',
    title: 'Accept the call / acknowledge the top alert',
    keys: 'Enter',
  },
  {
    action: 'secondary',
    label: 'Dismiss',
    title: 'Decline the call / dismiss the top alert or toast',
    keys: 'Esc',
  },
  { action: 'prev-page', label: '◀ Page', title: 'Previous parked-dashboard page', keys: '←' },
  { action: 'next-page', label: 'Page ▶', title: 'Next parked-dashboard page', keys: '→' },
  { action: 'toggle-blank', label: 'Blank', title: 'Blank / unblank the HUD', keys: 'B' },
  { action: 'brightness-down', label: 'Dimmer', title: 'Trim brightness down', keys: '−' },
  { action: 'brightness-up', label: 'Brighter', title: 'Trim brightness up', keys: '+' },
];

/** Keys that press a focused button, link, checkbox or tab. */
const ACTIVATION_KEYS: ReadonlySet<string> = new Set(['Enter', ' ', 'Spacebar']);
/** Keys a slider or radio group moves with. */
const MOVE_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
/** Inputs that are pressed rather than typed into. */
const PRESSED_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'color',
  'file',
  'image',
]);

/**
 * Whether the focused element uses `key` itself, so the HUD shortcut must not fire: text fields
 * take every key, sliders and radio groups their arrow keys, and buttons, links, checkboxes and
 * tabs only Enter and Space. Everything else is a shortcut even while a button has focus — a
 * clicked button keeps focus, and the shortcuts must keep working after it.
 */
export function ownsKey(target: EventTarget | null, key: string): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.closest('textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    return true;
  }
  const input = target.closest('input');
  if (input) {
    const type = input.type.toLowerCase();
    if (type === 'range') return MOVE_KEYS.has(key);
    if (type === 'radio') return MOVE_KEYS.has(key) || ACTIVATION_KEYS.has(key);
    if (PRESSED_INPUTS.has(type)) return ACTIVATION_KEYS.has(key);
    return true;
  }
  if (target.closest('button, a[href], summary, [role="button"], [role="tab"], [role="switch"]')) {
    return ACTIVATION_KEYS.has(key);
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Tyre pressures

export const DEFAULT_TYRES_KPA = { fl: 230, fr: 230, rl: 230, rr: 230 } as const;

/** Keep only plausible pressures (0–600 kPa); anything else falls back to `fallback`. */
export function sanitizeTyre(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 600 ? Math.round(value) : fallback;
}
