/**
 * Steering-wheel resistor ladders: each button pulls the wire to its own voltage. This module
 * matches readings to the configured voltage windows and turns a stream of readings into button
 * presses. Pure — every reading comes with its time — so it is tested without an ADC or timers.
 *
 *  - Debounce: a zone (a button's window, the idle range, or neither) counts once
 *    `stableReadings` consecutive readings (3 by default, 60 ms at 50 Hz) fall into it, so the
 *    windows a voltage sweeps through on its way to a button never act.
 *  - Press edges only: holding a button acts once. A button with a long-press action acts on
 *    release (short press) or once held for `longPressMs` (long press, which swallows the
 *    release). Leaving a button's window for any other zone releases it.
 *  - A button already held when readings start (or a wire stuck at a button's voltage) is
 *    ignored until a released reading has been seen.
 *  - Calibration: the steady voltage (readings agreeing within `steadyToleranceV`) is reported
 *    whenever it moves by more than `calibrationStepV`, so the log shows each button's voltage.
 */
import type { InputAction, SwcWindow, VoltageRange } from '@carheadsup/core';

export type LadderZone = { kind: 'button'; index: number } | { kind: 'idle' } | { kind: 'none' };

/** The window a reading falls into (ends included), else the idle range, else none. */
export function classifyVoltage(
  volts: number,
  idle: VoltageRange,
  windows: readonly VoltageRange[],
): LadderZone {
  const index = windows.findIndex((w) => volts >= w.minV && volts <= w.maxV);
  if (index >= 0) return { kind: 'button', index };
  if (volts >= idle.minV && volts <= idle.maxV) return { kind: 'idle' };
  return { kind: 'none' };
}

export function sameZone(a: LadderZone | null, b: LadderZone | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind !== 'button' || (b.kind === 'button' && a.index === b.index);
}

export interface LadderAction {
  action: InputAction;
  /** Index of the window (button) that acted. */
  window: number;
  kind: 'press' | 'release' | 'long-press';
}

export interface LadderSample {
  /** Button actions caused by this reading, in order. */
  actions: LadderAction[];
  /** The debounced zone changed to this (with the mean voltage of the readings that settled it). */
  zone: { zone: LadderZone; volts: number } | null;
  /** The steady voltage moved by more than the calibration step: report it. */
  steadyV: number | null;
  /** A button zone settled before any released reading: it is being ignored. */
  heldAtStart: boolean;
}

export interface LadderSettings {
  idle: VoltageRange;
  windows: readonly SwcWindow[];
}

export interface LadderOptions {
  /** Consecutive readings in one zone before it counts (default 3). */
  stableReadings?: number;
  /** Hold time for the long-press action (default 800 ms). */
  longPressMs?: number;
  /** Readings agreeing within this count as steady (default 25 mV). */
  steadyToleranceV?: number;
  /** Report the steady voltage when it moves by more than this (default 50 mV). */
  calibrationStepV?: number;
}

interface Reading {
  volts: number;
  zone: LadderZone;
}

export class LadderDetector {
  private settings: LadderSettings;
  private readonly stableReadings: number;
  private readonly longPressMs: number;
  private readonly steadyToleranceV: number;
  private readonly calibrationStepV: number;
  private recent: Reading[] = [];
  private stable: LadderZone | null = null;
  /** A released zone has been seen, so button zones may act. */
  private armed = false;
  private pressed: { window: number; at: number; longFired: boolean } | null = null;
  private lastSteadyV: number | null = null;

  constructor(settings: LadderSettings, options: LadderOptions = {}) {
    this.settings = settings;
    this.stableReadings = Math.max(1, Math.round(options.stableReadings ?? 3));
    this.longPressMs = Math.max(1, options.longPressMs ?? 800);
    this.steadyToleranceV = Math.max(0, options.steadyToleranceV ?? 0.025);
    this.calibrationStepV = Math.max(0, options.calibrationStepV ?? 0.05);
  }

  /** The debounced zone (null until readings have settled). */
  get zone(): LadderZone | null {
    return this.stable;
  }

  /** Index of the window whose button is held, or null. */
  get pressedWindow(): number | null {
    return this.pressed?.window ?? null;
  }

  /** New windows (e.g. after a settings change): starts over, without acting. */
  configure(settings: LadderSettings): void {
    this.settings = settings;
    this.reset();
  }

  /** Forget the readings and any held button without acting (e.g. after a bus error). */
  reset(): void {
    this.recent = [];
    this.stable = null;
    this.armed = false;
    this.pressed = null;
  }

  sample(volts: number, now: number): LadderSample {
    const result: LadderSample = { actions: [], zone: null, steadyV: null, heldAtStart: false };
    if (!Number.isFinite(volts)) return result;
    const zone = classifyVoltage(volts, this.settings.idle, this.settings.windows);
    this.recent.push({ volts, zone });
    if (this.recent.length > this.stableReadings) this.recent.shift();

    if (this.recent.length === this.stableReadings) {
      const values = this.recent.map((r) => r.volts);
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      if (Math.max(...values) - Math.min(...values) <= this.steadyToleranceV) {
        if (
          this.lastSteadyV === null ||
          Math.abs(mean - this.lastSteadyV) > this.calibrationStepV
        ) {
          this.lastSteadyV = mean;
          result.steadyV = mean;
        }
      }
      const settled = this.recent.every((r) => sameZone(r.zone, zone));
      if (settled && !sameZone(zone, this.stable)) this.enter(zone, mean, now, result);
    }

    const held = this.pressed;
    const window = held === null ? undefined : this.settings.windows[held.window];
    if (held !== null && window?.longPressAction && !held.longFired) {
      if (now - held.at >= this.longPressMs) {
        held.longFired = true;
        result.actions.push({
          action: window.longPressAction,
          window: held.window,
          kind: 'long-press',
        });
      }
    }
    return result;
  }

  private enter(zone: LadderZone, volts: number, now: number, result: LadderSample): void {
    const held = this.pressed;
    if (held !== null) {
      const window = this.settings.windows[held.window];
      if (window !== undefined && window.longPressAction !== null && !held.longFired) {
        result.actions.push({ action: window.action, window: held.window, kind: 'release' });
      }
      this.pressed = null;
    }
    this.stable = zone;
    result.zone = { zone, volts };
    if (zone.kind !== 'button') {
      this.armed = true;
      return;
    }
    if (!this.armed) {
      result.heldAtStart = true;
      return;
    }
    const window = this.settings.windows[zone.index];
    if (window === undefined) return;
    this.pressed = { window: zone.index, at: now, longFired: false };
    if (window.longPressAction === null) {
      result.actions.push({ action: window.action, window: zone.index, kind: 'press' });
    }
  }
}
