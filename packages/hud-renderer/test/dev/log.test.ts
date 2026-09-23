import type { AlertFrame, HudFrame } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { LOG_LIMIT, appendLog, deriveLogEntries } from '../../src/dev/log.ts';
import type { LogEntry } from '../../src/dev/log.ts';
import { SAMPLE_FRAMES } from '../../src/hud/fixtures.ts';

const BASE: HudFrame = SAMPLE_FRAMES['city-nav']!;
const NOW = 1_800_000_000_000;

function next(parts: Partial<HudFrame>): HudFrame {
  return { ...BASE, at: BASE.at + 1000, ...parts };
}

const HOT: AlertFrame = {
  key: 'coolant',
  kind: 'coolant',
  severity: 'warning',
  title: 'Engine hot',
  detail: 'Coolant 112 °C',
  code: null,
  dismissible: true,
};

const texts = (entries: LogEntry[]) => entries.map((e) => e.text);

describe('deriveLogEntries', () => {
  it('logs nothing for identical frames or while there is no feed', () => {
    expect(deriveLogEntries(BASE, next({}), NOW)).toEqual([]);
    expect(deriveLogEntries(null, null, NOW)).toEqual([]);
  });

  it('logs the feed coming up with its current alerts, and going down', () => {
    const up = deriveLogEntries(null, next({ alerts: [HOT] }), NOW);
    expect(texts(up)).toEqual(['Feed live · City', 'Alert: Engine hot — Coolant 112 °C']);
    expect(up[0]).toMatchObject({ kind: 'feed', tone: 'ok', at: BASE.at + 1000 });
    expect(deriveLogEntries(BASE, null, NOW)).toEqual([
      { at: NOW, kind: 'feed', tone: 'muted', text: 'Feed lost — HUD blanked' },
    ]);
  });

  it('logs context changes', () => {
    expect(texts(deriveLogEntries(BASE, next({ context: 'highway' }), NOW))).toEqual([
      'Context City → Highway',
    ]);
  });

  it('logs alerts raised, escalated and gone', () => {
    const raised = deriveLogEntries(BASE, next({ alerts: [HOT] }), NOW);
    expect(raised).toEqual([
      {
        at: BASE.at + 1000,
        kind: 'alert',
        tone: 'warning',
        text: 'Alert: Engine hot — Coolant 112 °C',
      },
    ]);
    const withHot = next({ alerts: [HOT] });
    const critical = { ...HOT, severity: 'critical' as const, title: 'Engine overheating' };
    expect(texts(deriveLogEntries(withHot, next({ alerts: [critical] }), NOW))).toEqual([
      'Alert now critical: Engine overheating',
    ]);
    expect(deriveLogEntries(withHot, next({ alerts: [] }), NOW)).toMatchObject([
      { tone: 'muted', text: 'Alert gone: Engine hot' },
    ]);
    const info = {
      ...HOT,
      key: 'x',
      severity: 'info' as const,
      detail: null,
      title: 'Maintenance due',
    };
    expect(deriveLogEntries(BASE, next({ alerts: [info] }), NOW)).toMatchObject([
      { tone: 'info', text: 'Alert: Maintenance due' },
    ]);
  });

  it('logs new toasts but not their fading', () => {
    const toast = {
      kind: 'media' as const,
      title: 'Everlong',
      subtitle: 'Foo Fighters',
      opacity: 1,
    };
    const shown = next({ toast });
    expect(texts(deriveLogEntries(BASE, shown, NOW))).toEqual([
      'Toast (media): Everlong — Foo Fighters',
    ]);
    expect(deriveLogEntries(shown, next({ toast: { ...toast, opacity: 0.4 } }), NOW)).toEqual([]);
    expect(deriveLogEntries(shown, next({ toast: null }), NOW)).toEqual([]);
    const message = { kind: 'message' as const, title: 'Alex', subtitle: null, opacity: 1 };
    expect(texts(deriveLogEntries(shown, next({ toast: message }), NOW))).toEqual([
      'Toast (message): Alex',
    ]);
  });

  it('logs call state changes', () => {
    const ringing = next({ call: SAMPLE_FRAMES['incoming-call']!.call });
    expect(deriveLogEntries(BASE, ringing, NOW)).toMatchObject([
      { kind: 'call', tone: 'caution', text: 'Call ringing: Maria Lopez' },
    ]);
    const active = next({ call: { ...ringing.call!, state: 'active', durationS: 1 } });
    expect(texts(deriveLogEntries(ringing, active, NOW))).toEqual(['Call active: Maria Lopez']);
    expect(
      deriveLogEntries(active, next({ call: { ...active.call!, durationS: 2 } }), NOW),
    ).toEqual([]);
    expect(texts(deriveLogEntries(active, next({ call: null }), NOW))).toEqual([
      'Call card closed (Maria Lopez)',
    ]);
  });

  it('logs display, ADAS and link changes', () => {
    const changed = next({
      blanked: true,
      theme: { night: true, brightness: 0.3 },
      blindSpot: { left: true, right: true },
      collision: 'warning',
      shiftLight: { level: 1, flash: true },
      status: { obd: 'error', phone: false, simulated: false },
    });
    expect(texts(deriveLogEntries(BASE, changed, NOW))).toEqual([
      'Display blanked',
      'Night palette on',
      'Blind spot: vehicle on the left',
      'Blind spot: vehicle on the right',
      'Forward collision: warning',
      'Shift light flashing',
      'OBD link error',
      'Phone disconnected',
    ]);
    const back = texts(deriveLogEntries(changed, next({}), NOW));
    expect(back).toEqual([
      'Display restored',
      'Day palette on',
      'Blind spot left clear',
      'Blind spot right clear',
      'Collision warning cleared',
      'OBD link connected',
      'Phone connected',
    ]);
    expect(deriveLogEntries(BASE, next({ collision: 'caution' }), NOW)).toMatchObject([
      { tone: 'caution' },
    ]);
  });

  it('logs parked dashboard page changes', () => {
    const overview = SAMPLE_FRAMES['parked-overview']!;
    const codes = SAMPLE_FRAMES['parked-trouble-codes']!;
    expect(texts(deriveLogEntries(BASE, overview, NOW))).toContain('Dashboard: Overview');
    expect(texts(deriveLogEntries(overview, codes, NOW))).toContain('Dashboard: Trouble codes');
    expect(texts(deriveLogEntries(codes, { ...codes, at: codes.at + 1 }, NOW))).toEqual([]);
  });
});

describe('appendLog', () => {
  const entry = (text: string): LogEntry => ({ at: 0, kind: 'feed', tone: 'info', text });

  it('puts the newest frame first and keeps the order within one frame', () => {
    const log = appendLog([entry('old')], [entry('first'), entry('second')]);
    expect(texts(log)).toEqual(['first', 'second', 'old']);
  });

  it('caps the log and returns the same array when nothing is added', () => {
    const many = Array.from({ length: LOG_LIMIT + 10 }, (_, i) => entry(String(i)));
    expect(appendLog([], many)).toHaveLength(LOG_LIMIT);
    const log = [entry('a')];
    expect(appendLog(log, [])).toBe(log);
    expect(appendLog([entry('a'), entry('b')], [entry('c')], 2).map((e) => e.text)).toEqual([
      'c',
      'a',
    ]);
  });
});
