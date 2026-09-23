import { describe, expect, it } from 'vitest';
import { deriveEffects } from '../../src/state/effects.ts';
import { reduce } from '../../src/state/reducer.ts';
import type { HudEvent } from '../../src/types/events.ts';
import { Harness, T0, callInfo, makeConfig, persisted } from './fixtures.ts';

const DAY = 86_400_000;

describe('deriveEffects — calls', () => {
  function withCall(state: 'ringing' | 'dialing' | 'active' | 'held' | 'ended'): Harness {
    const h = new Harness();
    h.phoneConnected(T0);
    h.send({ type: 'call/update', call: callInfo({ id: 'c-7', state }), at: T0 + 100 });
    return h;
  }

  it('accepts a ringing call on primary', () => {
    const h = withCall('ringing');
    h.input('primary', T0 + 200);
    expect(h.lastEffects).toEqual([{ type: 'phone/call-action', callId: 'c-7', action: 'accept' }]);
  });

  it('declines a ringing call on secondary', () => {
    const h = withCall('ringing');
    h.input('secondary', T0 + 200);
    expect(h.lastEffects).toEqual([
      { type: 'phone/call-action', callId: 'c-7', action: 'decline' },
    ]);
  });

  it('hangs up a dialing or active call on secondary', () => {
    for (const state of ['dialing', 'active'] as const) {
      const h = withCall(state);
      h.input('secondary', T0 + 200);
      expect(h.lastEffects).toEqual([
        { type: 'phone/call-action', callId: 'c-7', action: 'decline' },
      ]);
    }
  });

  it('does not accept a call that is not ringing', () => {
    for (const state of ['dialing', 'active', 'held', 'ended'] as const) {
      const h = withCall(state);
      h.input('primary', T0 + 200);
      expect(h.lastEffects).toEqual([]);
    }
  });

  it('does nothing for a held or ended call on secondary, or without a call', () => {
    for (const state of ['held', 'ended'] as const) {
      const h = withCall(state);
      h.input('secondary', T0 + 200);
      expect(h.lastEffects).toEqual([]);
    }
    const h = new Harness();
    h.input('primary', T0 + 1);
    h.input('secondary', T0 + 2);
    expect(h.effects).toEqual([]);
  });

  it('ignores other inputs during a ringing call', () => {
    const h = withCall('ringing');
    h.input('next-page', T0 + 200);
    h.input('toggle-blank', T0 + 300);
    expect(h.lastEffects).toEqual([]);
  });
});

describe('deriveEffects — trips', () => {
  it('emits the completed trip once', () => {
    const h = new Harness();
    h.obdConnected(T0);
    h.run(T0 + 60_000, { speed: 60, rpm: 2200 }, 500);
    h.run(h.now + 1000, { speed: 0, rpm: 0 });
    expect(h.effects.filter((e) => e.type === 'trip/completed')).toEqual([]);
    h.idle(h.now + h.config.trip.endAfterEngineOffMs + 5000);
    const completed = h.effects.filter((e) => e.type === 'trip/completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toEqual({ type: 'trip/completed', trip: h.state.trip.lastCompleted });
  });
});

describe('deriveEffects — maintenance', () => {
  it('reports items that become due, once', () => {
    const h = new Harness(
      makeConfig(),
      persisted({
        maintenanceRecords: [{ itemId: 'brake-fluid', odometerKm: null, at: T0 - 701 * DAY }],
      }),
    );
    // 730-day interval, 30-day warning: due soon already, overdue in 29 days.
    expect(h.state.maintenance.status.find((s) => s.itemId === 'brake-fluid')?.status).toBe(
      'due-soon',
    );
    h.tick(T0 + 29 * DAY + 60_000);
    const due = h.lastEffects.filter((e) => e.type === 'maintenance/due');
    expect(due).toEqual([
      {
        type: 'maintenance/due',
        items: [expect.objectContaining({ itemId: 'brake-fluid', status: 'overdue' })],
      },
    ]);
    h.tick(T0 + 29 * DAY + 180_000);
    expect(h.lastEffects).toEqual([]);
  });

  it('reports items that become due when the odometer is set', () => {
    const h = new Harness(
      makeConfig(),
      persisted({ maintenanceRecords: [{ itemId: 'oil', odometerKm: 10_000, at: T0 - DAY }] }),
    );
    h.send({ type: 'odometer/set', odometerKm: 17_600, at: T0 + 1 });
    expect(h.lastEffects).toEqual([
      {
        type: 'maintenance/due',
        items: [expect.objectContaining({ itemId: 'oil', status: 'due-soon', remainingKm: 400 })],
      },
      { type: 'persist' },
    ]);
  });
});

describe('deriveEffects — persist', () => {
  it('persists when the odometer passes a whole kilometre, not in between', () => {
    const h = new Harness(makeConfig(), persisted({ odometerKm: 999.5 }));
    h.obdConnected(T0);
    const persists: number[] = [];
    for (let at = T0 + 1000; at <= T0 + 60_000; at += 1000) {
      h.samples(at, { speed: 72, rpm: 2000 }); // 20 m per second
      if (h.lastEffects.some((e) => e.type === 'persist')) persists.push(h.state.odometer.km ?? 0);
    }
    // 999.5 → 1000.68: exactly one crossing (at 1000.0).
    expect(persists).toHaveLength(1);
    expect(persists[0]).toBeGreaterThanOrEqual(1000);
    expect(persists[0]).toBeLessThan(1000.03);
  });

  it('persists when the odometer first becomes known', () => {
    const h = new Harness();
    h.samples(T0 + 1, { odometer: 12_345.6 });
    expect(h.lastEffects).toEqual([{ type: 'persist' }]);
    h.samples(T0 + 2, { odometer: 12_345.7 });
    expect(h.lastEffects).toEqual([]);
  });

  it('persists a manual odometer setting and a recorded service', () => {
    const h = new Harness(makeConfig(), persisted({ odometerKm: 500.2 }));
    h.send({ type: 'odometer/set', odometerKm: 500.7, at: T0 + 1 });
    expect(h.lastEffects).toEqual([{ type: 'persist' }]);
    h.send({ type: 'maintenance/done', itemId: 'tyre-rotation', odometerKm: null, at: T0 + 2 });
    expect(h.lastEffects).toContainEqual({ type: 'persist' });
  });

  it('persists when learned gear ratios change', () => {
    const config = makeConfig();
    const h = new Harness(config);
    const prev = h.state;
    const next = { ...prev, gear: { ...prev.gear, learnedRatios: [100, 60, 40] } };
    const event: HudEvent = { type: 'tick', at: T0 };
    expect(deriveEffects(prev, next, event, config)).toEqual([{ type: 'persist' }]);
    const same = { ...next, gear: { ...next.gear, learnedRatios: [100, 60, 40] } };
    expect(deriveEffects(next, same, event, config)).toEqual([]);
  });

  it('emits nothing for an uneventful tick', () => {
    const h = new Harness(makeConfig(), persisted({ odometerKm: 10 }));
    const next = reduce(h.state, { type: 'tick', at: T0 + 1000 }, h.config);
    expect(deriveEffects(h.state, next, { type: 'tick', at: T0 + 1000 }, h.config)).toEqual([]);
  });
});
