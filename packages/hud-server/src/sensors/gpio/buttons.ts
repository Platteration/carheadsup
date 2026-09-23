/**
 * Debouncing and press classification for the GPIO buttons. Buttons are active-low (switch to
 * ground, internal pull-up), so a falling edge is a press and a rising edge a release.
 *
 * Debounce: every edge restarts a settle timer; the level is accepted only after it has been
 * stable for `debounceMs`. Press handling: `secondary` and `next` act on press; `primary` acts
 * on release so that holding it longer than `longPressMs` can blank the HUD instead — the long
 * press fires while the button is still held (immediate feedback) and swallows the release.
 */
import type { InputAction } from '@carheadsup/core';
import type { Timers } from '@carheadsup/obd';

export type ButtonRole = 'primary' | 'secondary' | 'next';

export const BUTTON_ROLES: readonly ButtonRole[] = ['primary', 'secondary', 'next'];

export interface ButtonDebouncerOptions {
  timers: Timers;
  onAction: (action: InputAction) => void;
  /** Default 30 ms. */
  debounceMs?: number;
  /** Default 800 ms. */
  longPressMs?: number;
}

interface ButtonState {
  /** Latest raw level from the edge stream. */
  raw: boolean;
  /** Debounced level. */
  pressed: boolean;
  settleTimer: unknown;
  longTimer: unknown;
  longFired: boolean;
}

export class ButtonDebouncer {
  private readonly timers: Timers;
  private readonly onAction: (action: InputAction) => void;
  private readonly debounceMs: number;
  private readonly longPressMs: number;
  private readonly states = new Map<ButtonRole, ButtonState>();

  constructor(options: ButtonDebouncerOptions) {
    this.timers = options.timers;
    this.onAction = options.onAction;
    this.debounceMs = Math.max(0, options.debounceMs ?? 30);
    this.longPressMs = Math.max(1, options.longPressMs ?? 800);
  }

  /** A raw level change on a button's line (`pressed` = line pulled low). */
  edge(role: ButtonRole, pressed: boolean): void {
    const state = this.state(role);
    state.raw = pressed;
    if (state.settleTimer !== null) this.timers.clearTimeout(state.settleTimer);
    state.settleTimer = this.timers.setTimeout(() => {
      state.settleTimer = null;
      this.commit(role, state);
    }, this.debounceMs);
  }

  /** Whether the debounced button is currently held. */
  isPressed(role: ButtonRole): boolean {
    return this.states.get(role)?.pressed ?? false;
  }

  /** Cancel pending timers and forget all state (e.g. when gpiomon restarts). */
  reset(): void {
    for (const state of this.states.values()) {
      if (state.settleTimer !== null) this.timers.clearTimeout(state.settleTimer);
      if (state.longTimer !== null) this.timers.clearTimeout(state.longTimer);
    }
    this.states.clear();
  }

  private state(role: ButtonRole): ButtonState {
    let state = this.states.get(role);
    if (state === undefined) {
      state = { raw: false, pressed: false, settleTimer: null, longTimer: null, longFired: false };
      this.states.set(role, state);
    }
    return state;
  }

  private commit(role: ButtonRole, state: ButtonState): void {
    if (state.raw === state.pressed) return;
    state.pressed = state.raw;
    if (state.pressed) this.onPress(role, state);
    else this.onRelease(role, state);
  }

  private onPress(role: ButtonRole, state: ButtonState): void {
    if (role === 'secondary') {
      this.onAction('secondary');
      return;
    }
    if (role === 'next') {
      this.onAction('next-page');
      return;
    }
    state.longFired = false;
    state.longTimer = this.timers.setTimeout(() => {
      state.longTimer = null;
      if (!state.pressed) return;
      state.longFired = true;
      this.onAction('toggle-blank');
    }, this.longPressMs);
  }

  private onRelease(role: ButtonRole, state: ButtonState): void {
    if (role !== 'primary') return;
    if (state.longTimer !== null) this.timers.clearTimeout(state.longTimer);
    state.longTimer = null;
    if (!state.longFired) this.onAction('primary');
    state.longFired = false;
  }
}
