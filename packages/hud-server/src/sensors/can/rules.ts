/**
 * The CAN steering-wheel button engine: turns frames into button presses by the configured
 * rules (`sensors.canButtons.rules`). Pure — time comes in with every call — so whole button
 * sequences are replayed in tests without timers; the source asks {@link CanButtonEngine.nextDeadline}
 * when to call {@link CanButtonEngine.tick} next.
 *
 * Per rule, a frame with the rule's id either matches (`(data[byte] & mask) == value`: held) or
 * not (released). The level must be stable for `debounceMs` before it counts. Only press edges
 * act, so a button repeated in every frame while held acts once. Release comes from a frame with
 * another value or, with `releaseTimeoutMs`, from the frames stopping. A rule with a long-press
 * action acts on release instead (short press) or once held for `longPressMs` (long press, which
 * swallows the release), like the GPIO accept button.
 */
import {
  formatCanId,
  parseCanId,
  parseHexByte,
  valueFitsMask,
  type CanButtonRule,
  type CanId,
  type InputAction,
} from '@carheadsup/core';
import type { CanFrame } from './candump.ts';

export interface CompiledCanRule {
  /** Position in the configured list, for logs. */
  index: number;
  id: number;
  extended: boolean;
  byte: number;
  mask: number;
  value: number;
  action: InputAction;
  longPressAction: InputAction | null;
  /** E.g. "5C1 byte 0 & 0F = 01", for logs. */
  label: string;
}

/**
 * Numeric form of the configured rules. The config is validated already; a rule that still
 * does not make sense (hand-built config in a test, say) is skipped and reported.
 */
export function compileCanRules(
  rules: readonly CanButtonRule[],
  onInvalid?: (index: number, reason: string) => void,
): CompiledCanRule[] {
  const compiled: CompiledCanRule[] = [];
  rules.forEach((rule, index) => {
    const canId = parseCanId(rule.id);
    const mask = parseHexByte(rule.mask);
    const value = parseHexByte(rule.value);
    if (canId === null) return onInvalid?.(index, `bad CAN id "${rule.id}"`);
    if (mask === null || mask === 0 || value === null || !valueFitsMask(value, mask)) {
      return onInvalid?.(index, `bad mask/value "${rule.mask}"/"${rule.value}"`);
    }
    if (!Number.isInteger(rule.byte) || rule.byte < 0 || rule.byte > 63) {
      return onInvalid?.(index, `bad byte index ${rule.byte}`);
    }
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
    compiled.push({
      index,
      ...canId,
      byte: rule.byte,
      mask,
      value,
      action: rule.action,
      longPressAction: rule.longPressAction,
      label: `${formatCanId(canId)} byte ${rule.byte} & ${hex(mask)} = ${hex(value)}`,
    });
  });
  return compiled;
}

/** The distinct ids the rules listen to (for candump's kernel filters), in rule order. */
export function canRuleIds(rules: readonly CompiledCanRule[]): CanId[] {
  const seen = new Set<string>();
  const ids: CanId[] = [];
  for (const rule of rules) {
    const key = `${rule.extended ? 'x' : 's'}${rule.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push({ id: rule.id, extended: rule.extended });
  }
  return ids;
}

/**
 * Whether `frame` shows the rule's button held (true) or released (false); null when the frame
 * says nothing about it: another id or format, a remote request, or too short for the byte.
 */
export function ruleMatches(
  rule: CompiledCanRule,
  frame: Pick<CanFrame, 'id' | 'extended' | 'remote' | 'data'>,
): boolean | null {
  if (frame.id !== rule.id || frame.extended !== rule.extended || frame.remote) return null;
  const byte = frame.data[rule.byte];
  if (byte === undefined) return null;
  return (byte & rule.mask) === rule.value;
}

export interface CanButtonEngineOptions {
  /** Released after no frame with the rule's id for this long; null = only by value. */
  releaseTimeoutMs: number | null;
  /** How long a level must hold before it counts (default 30 ms). */
  debounceMs?: number;
  /** Hold time for the long-press action (default 800 ms). */
  longPressMs?: number;
}

/** A button action and when it happened. */
export interface TimedAction {
  action: InputAction;
  at: number;
  rule: CompiledCanRule;
  kind: 'press' | 'release' | 'long-press';
}

interface RuleState {
  /** Level of the latest frame (or timeout). */
  raw: boolean;
  /** When `raw` last changed. */
  rawSince: number;
  /** When the last frame for this rule arrived; null before the first. */
  lastSeen: number | null;
  /** Debounced level. */
  pressed: boolean;
  pressedAt: number;
  longFired: boolean;
}

type Due = { at: number; kind: 'commit' | 'timeout' | 'long' };

export class CanButtonEngine {
  readonly rules: readonly CompiledCanRule[];
  private readonly releaseTimeoutMs: number | null;
  private readonly debounceMs: number;
  private readonly longPressMs: number;
  private states: RuleState[];
  private lastNow = Number.NEGATIVE_INFINITY;

  constructor(rules: readonly CompiledCanRule[], options: CanButtonEngineOptions) {
    this.rules = rules;
    const timeout = options.releaseTimeoutMs;
    this.releaseTimeoutMs =
      timeout !== null && Number.isFinite(timeout) && timeout > 0 ? timeout : null;
    this.debounceMs = Math.max(0, options.debounceMs ?? 30);
    this.longPressMs = Math.max(1, options.longPressMs ?? 800);
    this.states = rules.map(() => freshState());
  }

  /** Feed one received frame; returns what it (and anything due before it) caused, oldest first. */
  frame(frame: Pick<CanFrame, 'id' | 'extended' | 'remote' | 'data'>, now: number): TimedAction[] {
    const at = this.clamp(now);
    const out: TimedAction[] = [];
    this.rules.forEach((rule, index) => {
      const state = this.states[index];
      if (state === undefined) return;
      const held = ruleMatches(rule, frame);
      if (held === null) return;
      // Whatever fell due before this frame happens first (e.g. a timeout release).
      this.advance(rule, state, at, out);
      state.lastSeen = at;
      if (held !== state.raw) {
        state.raw = held;
        state.rawSince = at;
      }
      this.advance(rule, state, at, out);
    });
    return sortByTime(out);
  }

  /** Let time pass without a frame: debounce, release timeouts, long presses. */
  tick(now: number): TimedAction[] {
    const at = this.clamp(now);
    const out: TimedAction[] = [];
    this.rules.forEach((rule, index) => {
      const state = this.states[index];
      if (state !== undefined) this.advance(rule, state, at, out);
    });
    return sortByTime(out);
  }

  /** When {@link tick} next has something to do; null while nothing is pending. */
  nextDeadline(): number | null {
    let next: number | null = null;
    this.rules.forEach((rule, index) => {
      const state = this.states[index];
      const due = state === undefined ? null : this.due(rule, state);
      if (due !== null && (next === null || due.at < next)) next = due.at;
    });
    return next;
  }

  /** Whether the rule at `index` (of the compiled list) is held, after debouncing. */
  isPressed(index: number): boolean {
    return this.states[index]?.pressed ?? false;
  }

  /** Forget every button without acting (e.g. frames may have been missed). */
  reset(): void {
    this.states = this.rules.map(() => freshState());
  }

  private clamp(now: number): number {
    if (Number.isFinite(now) && now > this.lastNow) this.lastNow = now;
    return Number.isFinite(this.lastNow) ? this.lastNow : 0;
  }

  /** The earliest pending transition of one rule. */
  private due(rule: CompiledCanRule, state: RuleState): Due | null {
    let next: Due | null = null;
    const consider = (at: number, kind: Due['kind']) => {
      if (next === null || at < next.at) next = { at, kind };
    };
    if (state.raw !== state.pressed) consider(state.rawSince + this.debounceMs, 'commit');
    if (state.raw && this.releaseTimeoutMs !== null && state.lastSeen !== null) {
      consider(state.lastSeen + this.releaseTimeoutMs, 'timeout');
    }
    if (state.pressed && rule.longPressAction !== null && !state.longFired) {
      consider(state.pressedAt + this.longPressMs, 'long');
    }
    return next;
  }

  /** Apply everything due up to `now`, in time order. */
  private advance(rule: CompiledCanRule, state: RuleState, now: number, out: TimedAction[]): void {
    // Each step settles one transition; a handful per call at most.
    for (let guard = 0; guard < 16; guard++) {
      const due = this.due(rule, state);
      if (due === null || due.at > now) return;
      if (due.kind === 'timeout') {
        state.raw = false;
        state.rawSince = due.at;
      } else if (due.kind === 'long') {
        state.longFired = true;
        if (rule.longPressAction !== null) {
          out.push({ action: rule.longPressAction, at: due.at, rule, kind: 'long-press' });
        }
      } else if (state.raw) {
        state.pressed = true;
        state.pressedAt = due.at;
        state.longFired = false;
        if (rule.longPressAction === null) {
          out.push({ action: rule.action, at: due.at, rule, kind: 'press' });
        }
      } else {
        state.pressed = false;
        if (rule.longPressAction !== null && !state.longFired) {
          out.push({ action: rule.action, at: due.at, rule, kind: 'release' });
        }
        state.longFired = false;
      }
    }
  }
}

function freshState(): RuleState {
  return {
    raw: false,
    rawSince: 0,
    lastSeen: null,
    pressed: false,
    pressedAt: 0,
    longFired: false,
  };
}

function sortByTime(actions: TimedAction[]): TimedAction[] {
  // Stable: rules acting at the same moment keep their configured order.
  return actions.sort((a, b) => a.at - b.at);
}
