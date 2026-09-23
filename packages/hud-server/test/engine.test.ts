import { EMPTY_PERSISTED_STATE } from '@carheadsup/core';
import type {
  DeepPartial,
  HudConfig,
  HudFrame,
  HudToPhone,
  PersistedState,
  TripRecord,
} from '@carheadsup/core';
import { SYSTEM_TIMERS } from '@carheadsup/obd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HudEngine, maintenanceDueMessage } from '../src/engine.ts';
import type { EngineOutputs } from '../src/engine.ts';
import { MemoryLogger, testConfig } from './helpers.ts';

const T0 = Date.UTC(2026, 8, 23, 8, 0, 0);
const DAY = 86_400_000;

class RecordingOutputs implements EngineOutputs {
  readonly phone: HudToPhone[] = [];
  readonly trips: TripRecord[] = [];
  readonly saved: PersistedState[] = [];
  failSaves = false;
  onPhone: ((message: HudToPhone) => void) | null = null;

  sendToPhone(message: HudToPhone): void {
    this.phone.push(message);
    this.onPhone?.(message);
  }

  async saveTrip(trip: TripRecord): Promise<void> {
    this.trips.push(trip);
  }

  async savePersisted(state: PersistedState): Promise<void> {
    if (this.failSaves) throw new Error('disk full');
    this.saved.push(state);
  }
}

interface Harness {
  engine: HudEngine;
  outputs: RecordingOutputs;
  logger: MemoryLogger;
}

function makeEngine(
  options: {
    config?: DeepPartial<HudConfig>;
    persisted?: Partial<PersistedState>;
    now?: () => number;
  } = {},
): Harness {
  const outputs = new RecordingOutputs();
  const logger = new MemoryLogger();
  const engine = new HudEngine({
    config: testConfig({ server: { frameRate: 10 }, ...options.config }),
    persisted: { ...EMPTY_PERSISTED_STATE, maintenanceRecords: [], ...options.persisted },
    outputs,
    logger,
    now: options.now ?? (() => Date.now()),
    timers: SYSTEM_TIMERS,
  });
  return { engine, outputs, logger };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HudEngine time', () => {
  it('re-stamps events with its own clock', () => {
    const { engine } = makeEngine();
    vi.advanceTimersByTime(1234);
    engine.dispatch({ type: 'obd/samples', samples: [{ signal: 'speed', value: 42 }], at: 1 });
    expect(engine.state.now).toBe(T0 + 1234);
    expect(engine.state.vehicle.signals.speed).toEqual({ value: 42, at: T0 + 1234 });
  });

  it('never moves time backwards when the clock steps back', () => {
    const { engine } = makeEngine();
    vi.setSystemTime(T0 + 10_000);
    engine.dispatch({ type: 'tick', at: 0 });
    vi.setSystemTime(T0 + 2_000);
    engine.dispatch({
      type: 'obd/samples',
      samples: [{ signal: 'rpm', value: 900 }],
      at: T0 + 50_000,
    });
    expect(engine.state.now).toBe(T0 + 10_000);
    expect(engine.state.vehicle.signals.rpm?.at).toBe(T0 + 10_000);
    vi.setSystemTime(T0 + 12_000);
    engine.dispatch({ type: 'tick', at: 0 });
    expect(engine.state.now).toBe(T0 + 12_000);
  });

  it('ignores a non-finite clock reading', () => {
    let clock = T0 + 500;
    const { engine } = makeEngine({ now: () => clock });
    clock = Number.NaN;
    engine.dispatch({ type: 'tick', at: 0 });
    expect(engine.state.now).toBe(T0 + 500);
  });

  it('ticks every 100 ms once started, and stops ticking on stop()', async () => {
    const { engine } = makeEngine();
    engine.start();
    vi.advanceTimersByTime(1000);
    expect(engine.state.now).toBe(T0 + 1000);
    await engine.stop();
    vi.advanceTimersByTime(1000);
    expect(engine.state.now).toBe(T0 + 1000);
  });
});

describe('HudEngine frames', () => {
  it('publishes frames at server.frameRate on a timer, not per event', () => {
    const { engine } = makeEngine();
    const frames: HudFrame[] = [];
    engine.onFrame((frame) => frames.push(frame));
    engine.start();
    expect(frames).toHaveLength(1); // published immediately on start
    for (let i = 0; i < 200; i += 1) {
      engine.dispatch({ type: 'obd/samples', samples: [{ signal: 'speed', value: i }], at: 0 });
    }
    expect(frames).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(frames).toHaveLength(11); // 10 fps
    expect(frames.at(-1)?.at).toBe(T0 + 1000);
    expect(engine.frame).toBe(frames.at(-1));
  });

  it('follows a frame-rate change from setConfig', () => {
    const { engine } = makeEngine();
    const frames: HudFrame[] = [];
    engine.onFrame((frame) => frames.push(frame));
    engine.start();
    vi.advanceTimersByTime(1000);
    expect(frames).toHaveLength(11);
    engine.setConfig(testConfig({ server: { frameRate: 20 } }));
    expect(engine.config.server.frameRate).toBe(20);
    vi.advanceTimersByTime(100); // the pending 10 fps frame
    const before = frames.length;
    vi.advanceTimersByTime(1000);
    expect(frames.length - before).toBe(20);
  });

  it('composes a frame on demand before the first publication', () => {
    const { engine } = makeEngine();
    expect(engine.frame.status.simulated).toBe(false);
    expect(engine.frame.context).toBe('parked');
  });

  it('keeps publishing when a frame listener throws, and unsubscribes cleanly', () => {
    const { engine, logger } = makeEngine();
    const frames: HudFrame[] = [];
    engine.onFrame(() => {
      throw new Error('boom');
    });
    const unsubscribe = engine.onFrame((frame) => frames.push(frame));
    engine.start();
    vi.advanceTimersByTime(200);
    expect(frames).toHaveLength(3);
    expect(logger.text('error')).toContain('frame listener failed: boom');
    unsubscribe();
    vi.advanceTimersByTime(200);
    expect(frames).toHaveLength(3);
  });
});

describe('HudEngine effects', () => {
  it('sends call actions to the phone when the driver answers a ringing call', () => {
    const { engine, outputs } = makeEngine();
    engine.dispatch({
      type: 'call/update',
      call: {
        id: 'c1',
        state: 'ringing',
        callerName: 'Maria',
        number: null,
        startedAt: 0,
        updatedAt: 0,
      },
      at: 0,
    });
    engine.dispatch({ type: 'input', action: 'primary', at: 0 });
    expect(outputs.phone).toEqual([{ t: 'call-action', callId: 'c1', action: 'accept' }]);
    engine.dispatch({ type: 'input', action: 'secondary', at: 0 });
    expect(outputs.phone.at(-1)).toEqual({ t: 'call-action', callId: 'c1', action: 'decline' });
  });

  it('saves completed trips and pushes them to the phone', async () => {
    const { engine, outputs } = makeEngine({
      config: { trip: { endAfterEngineOffMs: 10_000, minDistanceKm: 0.2 } },
    });
    engine.start();
    engine.dispatch({ type: 'obd/link', state: 'connected', at: 0 });
    // One minute at 60 km/h ≈ 1 km.
    for (let i = 0; i < 300; i += 1) {
      vi.advanceTimersByTime(200);
      engine.dispatch({
        type: 'obd/samples',
        samples: [
          { signal: 'speed', value: 60 },
          { signal: 'rpm', value: 2000 },
        ],
        at: 0,
      });
    }
    for (let i = 0; i < 100; i += 1) {
      vi.advanceTimersByTime(200);
      engine.dispatch({
        type: 'obd/samples',
        samples: [
          { signal: 'speed', value: 0 },
          { signal: 'rpm', value: 0 },
        ],
        at: 0,
      });
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(outputs.trips).toHaveLength(1);
    const trip = outputs.trips[0];
    expect(trip?.distanceKm).toBeGreaterThan(0.9);
    expect(outputs.phone).toContainEqual({ t: 'trip-completed', trip });
    await engine.stop();
  });

  it('pushes maintenance items that became due to the phone', () => {
    const { engine, outputs } = makeEngine({
      config: {
        maintenance: {
          items: [
            {
              id: 'oil',
              label: 'Oil',
              intervalKm: 8000,
              intervalDays: null,
              warnBeforeKm: 500,
              warnBeforeDays: 14,
            },
          ],
        },
      },
      persisted: {
        odometerKm: 1000,
        maintenanceRecords: [{ itemId: 'oil', odometerKm: 1000, at: T0 - DAY }],
      },
    });
    expect(engine.state.maintenance.status[0]?.status).toBe('ok');
    engine.dispatch({ type: 'odometer/set', odometerKm: 8600, at: 0 });
    expect(outputs.phone).toEqual([
      {
        t: 'maintenance-due',
        items: [
          {
            itemId: 'oil',
            label: 'Oil',
            status: 'due-soon',
            remainingKm: 400,
            remainingDays: null,
          },
        ],
      },
    ]);
  });

  it('queues events dispatched from inside an effect handler', () => {
    const { engine, outputs } = makeEngine();
    const seen: string[] = [];
    outputs.onPhone = (message) => {
      seen.push(`phone:${message.t}`);
      // The simulated phone reacts synchronously, e.g. by ending the call.
      engine.dispatch({ type: 'call/update', call: null, at: 0 });
      seen.push(`call-after-dispatch:${engine.state.call === null ? 'cleared' : 'still-ringing'}`);
    };
    engine.dispatch({
      type: 'call/update',
      call: {
        id: 'c9',
        state: 'ringing',
        callerName: null,
        number: null,
        startedAt: 0,
        updatedAt: 0,
      },
      at: 0,
    });
    engine.dispatch({ type: 'input', action: 'primary', at: 0 });
    // The nested event ran after the current one finished, not in the middle of it.
    expect(seen).toEqual(['phone:call-action', 'call-after-dispatch:still-ringing']);
    expect(engine.state.call).toBeNull();
  });

  it('logs a failing phone link instead of throwing', () => {
    const { engine, outputs, logger } = makeEngine();
    outputs.onPhone = () => {
      throw new Error('socket gone');
    };
    engine.dispatch({
      type: 'call/update',
      call: {
        id: 'c1',
        state: 'ringing',
        callerName: null,
        number: null,
        startedAt: 0,
        updatedAt: 0,
      },
      at: 0,
    });
    expect(() => engine.dispatch({ type: 'input', action: 'primary', at: 0 })).not.toThrow();
    expect(logger.text('warn')).toContain('socket gone');
  });

  it('ignores events after stop', async () => {
    const { engine } = makeEngine();
    await engine.stop();
    engine.dispatch({ type: 'obd/samples', samples: [{ signal: 'speed', value: 99 }], at: 0 });
    expect(engine.state.vehicle.signals.speed).toBeUndefined();
  });
});

describe('HudEngine persistence', () => {
  it('coalesces persist requests into one write 2 s after the first', async () => {
    const { engine, outputs } = makeEngine();
    engine.dispatch({ type: 'odometer/set', odometerKm: 1234.5, at: 0 });
    vi.advanceTimersByTime(1000);
    engine.dispatch({ type: 'odometer/set', odometerKm: 1240, at: 0 });
    await vi.advanceTimersByTimeAsync(999);
    expect(outputs.saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(outputs.saved).toHaveLength(1);
    expect(outputs.saved[0]?.odometerKm).toBe(1240);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(outputs.saved).toHaveLength(1);
  });

  it('writes service records when maintenance is marked done', async () => {
    const { engine, outputs } = makeEngine({ persisted: { odometerKm: 5000 } });
    engine.dispatch({ type: 'maintenance/done', itemId: 'oil', odometerKm: null, at: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(outputs.saved.at(-1)?.maintenanceRecords).toEqual([
      { itemId: 'oil', odometerKm: 5000, at: T0 },
    ]);
  });

  it('writes a changing odometer at most once a minute between whole kilometres', async () => {
    const { engine, outputs } = makeEngine();
    // PID odometer creeping up by 1 m per second, staying within one kilometre.
    for (let s = 0; s <= 130; s += 1) {
      engine.dispatch({
        type: 'obd/samples',
        samples: [{ signal: 'odometer', value: 5000 + s * 0.001 }],
        at: 0,
      });
      await vi.advanceTimersByTimeAsync(1000);
    }
    // Became known at 0 s → written 2 s later; then the 60 s rule twice (each write 2 s after
    // its request, capturing the latest reading).
    expect(outputs.saved.map((s) => s.odometerKm)).toEqual([5000.001, 5000.062, 5000.123]);
  });

  it('writes promptly when the odometer passes a whole kilometre', async () => {
    const { engine, outputs } = makeEngine({ persisted: { odometerKm: 4999.9 } });
    engine.dispatch({
      type: 'obd/samples',
      samples: [{ signal: 'odometer', value: 4999.95 }],
      at: 0,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(outputs.saved).toHaveLength(0);
    engine.dispatch({
      type: 'obd/samples',
      samples: [{ signal: 'odometer', value: 5000.01 }],
      at: 0,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(outputs.saved.map((s) => s.odometerKm)).toEqual([5000.01]);
  });

  it('flushes on stop and skips writing unchanged state', async () => {
    const quiet = makeEngine({ persisted: { odometerKm: 100 } });
    await quiet.engine.stop();
    expect(quiet.outputs.saved).toHaveLength(0);

    const { engine, outputs } = makeEngine();
    engine.dispatch({ type: 'odometer/set', odometerKm: 777, at: 0 });
    await engine.stop();
    expect(outputs.saved).toHaveLength(1);
    expect(outputs.saved[0]?.odometerKm).toBe(777);
    // A second stop is a no-op.
    await engine.stop();
    expect(outputs.saved).toHaveLength(1);
  });

  it('logs a failed write and retries on the next request', async () => {
    const { engine, outputs, logger } = makeEngine();
    outputs.failSaves = true;
    engine.dispatch({ type: 'odometer/set', odometerKm: 10, at: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(logger.text('error')).toContain('disk full');
    outputs.failSaves = false;
    await engine.flushPersistence();
    expect(outputs.saved.map((s) => s.odometerKm)).toEqual([10]);
  });
});

describe('maintenanceDueMessage', () => {
  it('lists only due-soon and overdue items', () => {
    const base = {
      lastDoneAt: null,
      lastDoneKm: null,
      dueAtKm: null,
      dueAtEpochMs: null,
      remainingKm: null,
      remainingDays: null,
    };
    expect(
      maintenanceDueMessage([
        { ...base, itemId: 'a', label: 'A', status: 'ok' },
        { ...base, itemId: 'b', label: 'B', status: 'overdue', remainingDays: -3 },
        { ...base, itemId: 'c', label: 'C', status: 'unknown' },
        { ...base, itemId: 'd', label: 'D', status: 'due-soon', remainingKm: 100 },
      ]),
    ).toEqual({
      t: 'maintenance-due',
      items: [
        { itemId: 'b', label: 'B', status: 'overdue', remainingKm: null, remainingDays: -3 },
        { itemId: 'd', label: 'D', status: 'due-soon', remainingKm: 100, remainingDays: null },
      ],
    });
    expect(maintenanceDueMessage([{ ...base, itemId: 'a', label: 'A', status: 'ok' }])).toBeNull();
  });
});
