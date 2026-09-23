import type { AlertFrame, DrivingContext, HudFrame } from '@carheadsup/core';

/**
 * The dev console's event log, derived purely from successive frames: what changed between the
 * previous frame and this one (alerts raised and cleared, toasts, context changes, calls, ADAS,
 * link status). Continuous values (speed, fades) are deliberately not logged.
 */

export type LogKind =
  'alert' | 'toast' | 'context' | 'call' | 'adas' | 'status' | 'display' | 'feed';
export type LogTone = 'info' | 'caution' | 'warning' | 'critical' | 'ok' | 'muted';

export interface LogEntry {
  /** Epoch ms on the HUD's clock (the frame's `at`; see `useFrameLog` for feed changes). */
  at: number;
  kind: LogKind;
  tone: LogTone;
  text: string;
}

/** Most entries kept in the rolling log. */
export const LOG_LIMIT = 200;

const CONTEXT_WORD: Readonly<Record<DrivingContext, string>> = {
  parked: 'Parked',
  stopped: 'Stopped',
  city: 'City',
  highway: 'Highway',
};

function alertText(a: AlertFrame): string {
  return a.detail ? `${a.title} — ${a.detail}` : a.title;
}

function alertTone(a: AlertFrame): LogTone {
  return a.severity === 'info' ? 'info' : a.severity;
}

/**
 * Entries describing the change from `prev` to `next`. `now` stamps feed transitions (a null
 * frame means "no live feed") and must be on the HUD's clock like the frames' `at`. The first
 * frame after no feed logs the feed coming up and its initial alerts, not every widget.
 */
export function deriveLogEntries(
  prev: HudFrame | null,
  next: HudFrame | null,
  now: number,
): LogEntry[] {
  if (next === null) {
    return prev === null
      ? []
      : [{ at: now, kind: 'feed', tone: 'muted', text: 'Feed lost — HUD blanked' }];
  }
  const at = next.at;
  const out: LogEntry[] = [];
  const add = (kind: LogKind, tone: LogTone, text: string) => out.push({ at, kind, tone, text });

  if (prev === null) {
    add('feed', 'ok', `Feed live · ${CONTEXT_WORD[next.context] ?? next.context}`);
    for (const a of next.alerts) add('alert', alertTone(a), `Alert: ${alertText(a)}`);
    return out;
  }

  if (prev.context !== next.context) {
    add(
      'context',
      'info',
      `Context ${CONTEXT_WORD[prev.context] ?? prev.context} → ${CONTEXT_WORD[next.context] ?? next.context}`,
    );
  }

  // Alerts by key: raised, escalated / downgraded, cleared.
  const before = new Map(prev.alerts.map((a) => [a.key, a]));
  const after = new Map(next.alerts.map((a) => [a.key, a]));
  for (const [key, a] of after) {
    const old = before.get(key);
    if (!old) add('alert', alertTone(a), `Alert: ${alertText(a)}`);
    else if (old.severity !== a.severity)
      add('alert', alertTone(a), `Alert now ${a.severity}: ${a.title}`);
  }
  for (const [key, a] of before) {
    // "Gone" rather than "cleared": it may only be hidden behind higher-priority alerts.
    if (!after.has(key)) add('alert', 'muted', `Alert gone: ${a.title}`);
  }

  // Toasts: a new one appears (fading opacity alone is not an event).
  const t0 = prev.toast;
  const t1 = next.toast;
  if (t1 && (!t0 || t0.kind !== t1.kind || t0.title !== t1.title || t0.subtitle !== t1.subtitle)) {
    add(
      'toast',
      'info',
      `Toast (${t1.kind}): ${t1.subtitle ? `${t1.title} — ${t1.subtitle}` : t1.title}`,
    );
  }

  // Calls: state or caller changes.
  const c0 = prev.call;
  const c1 = next.call;
  if (c1 && (!c0 || c0.state !== c1.state || c0.name !== c1.name)) {
    add('call', c1.state === 'ringing' ? 'caution' : 'info', `Call ${c1.state}: ${c1.name}`);
  } else if (!c1 && c0) {
    add('call', 'muted', `Call card closed (${c0.name})`);
  }

  if (prev.blanked !== next.blanked)
    add('display', 'muted', next.blanked ? 'Display blanked' : 'Display restored');
  if (prev.theme.night !== next.theme.night)
    add('display', 'muted', next.theme.night ? 'Night palette on' : 'Day palette on');

  if (prev.blindSpot.left !== next.blindSpot.left) {
    add(
      'adas',
      next.blindSpot.left ? 'warning' : 'muted',
      next.blindSpot.left ? 'Blind spot: vehicle on the left' : 'Blind spot left clear',
    );
  }
  if (prev.blindSpot.right !== next.blindSpot.right) {
    add(
      'adas',
      next.blindSpot.right ? 'warning' : 'muted',
      next.blindSpot.right ? 'Blind spot: vehicle on the right' : 'Blind spot right clear',
    );
  }
  if (prev.collision !== next.collision) {
    const tone: LogTone =
      next.collision === 'warning'
        ? 'critical'
        : next.collision === 'caution'
          ? 'caution'
          : 'muted';
    add(
      'adas',
      tone,
      next.collision === 'none'
        ? 'Collision warning cleared'
        : `Forward collision: ${next.collision}`,
    );
  }

  const shiftFlash = (f: HudFrame) => f.shiftLight?.flash === true;
  if (!shiftFlash(prev) && shiftFlash(next)) add('display', 'caution', 'Shift light flashing');

  const page0 = prev.diagnostics?.page ?? null;
  const page1 = next.diagnostics?.page ?? null;
  if (page1 !== null && page0 !== page1)
    add('display', 'info', `Dashboard: ${next.diagnostics?.title ?? page1}`);

  if (prev.status.obd !== next.status.obd) {
    add(
      'status',
      next.status.obd === 'connected' ? 'ok' : next.status.obd === 'error' ? 'critical' : 'caution',
      `OBD link ${next.status.obd}`,
    );
  }
  if (prev.status.phone !== next.status.phone) {
    add(
      'status',
      next.status.phone ? 'ok' : 'caution',
      next.status.phone ? 'Phone connected' : 'Phone disconnected',
    );
  }
  return out;
}

/**
 * Prepend one frame's entries and cap the log: frames newest first, while the entries of one
 * frame keep their logical order (context change, then alerts, …).
 */
export function appendLog(
  log: readonly LogEntry[],
  entries: readonly LogEntry[],
  limit = LOG_LIMIT,
): LogEntry[] {
  if (entries.length === 0) return log as LogEntry[];
  return [...entries, ...log].slice(0, limit);
}
