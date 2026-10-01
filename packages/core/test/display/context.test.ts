import { describe, expect, it } from 'vitest';
import {
  DATA_GAP_GRACE_MS,
  ENGINE_STOP_CONFIRM_MS,
  STATIONARY_HYSTERESIS_KPH,
  UNPARK_CREEP_MS,
  createContextState,
  updateContext,
} from '../../src/display/context.ts';
import type { ContextInput, ContextState } from '../../src/display/context.ts';
import type { ContextConfig, DrivingContext } from '../../src/types/config.ts';

const CONFIG: ContextConfig = {
  highwayEnterKph: 80,
  highwayExitKph: 65,
  highwayDwellMs: 10_000,
  stationaryKph: 2,
  parkedAfterMs: 120_000,
  engineOffParkedAfterMs: 30_000,
};

type Sample = Partial<Omit<ContextInput, 'at'>> & { at: number };

const input = (s: Sample): ContextInput => ({
  speedKph: null,
  engineRunning: true,
  linkUp: true,
  routeActive: false,
  reportedGear: null,
  ...s,
});

/** Feed samples in order and return every intermediate state. */
function run(state: ContextState, samples: Sample[], config = CONFIG): ContextState[] {
  const out: ContextState[] = [];
  let s = state;
  for (const sample of samples) {
    s = updateContext(s, input(sample), config);
    out.push(s);
  }
  return out;
}

const last = (states: ContextState[]): ContextState => {
  const s = states.at(-1);
  if (s === undefined) throw new Error('no states');
  return s;
};

const contexts = (states: ContextState[]): DrivingContext[] => states.map((s) => s.context);

/** A state that has been driving in town at 40 km/h. */
function cityState(at = 0): ContextState {
  return last(run(createContextState(at), [{ at, speedKph: 40 }]));
}

function stoppedState(at = 0): ContextState {
  return last(run(cityState(at), [{ at: at + 1000, speedKph: 0 }]));
}

function highwayState(at = 0): ContextState {
  return last(
    run(cityState(at), [
      { at: at + 1000, speedKph: 100 },
      { at: at + 11_000, speedKph: 100 },
    ]),
  );
}

describe('createContextState', () => {
  it('starts parked with no history', () => {
    expect(createContextState(5)).toEqual({
      context: 'parked',
      since: 5,
      stationarySince: null,
      highwayCandidateSince: null,
      stillSince: null,
      lastSpeedAt: null,
      engineOffSince: null,
      idleSince: null,
      creepSince: null,
    });
  });
});

describe('updateContext', () => {
  it('leaves parked as soon as the vehicle moves', () => {
    const s = last(run(createContextState(0), [{ at: 1000, speedKph: 30 }]));
    expect(s.context).toBe('city');
    expect(s.since).toBe(1000);
    expect(s.stationarySince).toBeNull();
  });

  it('comes to a stop in town', () => {
    const s = last(run(cityState(), [{ at: 5000, speedKph: 1 }]));
    expect(s.context).toBe('stopped');
    expect(s.since).toBe(5000);
    expect(s.stationarySince).toBe(5000);
  });

  it('keeps `since` unchanged while the context does not change', () => {
    const s = last(
      run(cityState(0), [
        { at: 1000, speedKph: 50 },
        { at: 2000, speedKph: 30 },
      ]),
    );
    expect(s.context).toBe('city');
    expect(s.since).toBe(0);
  });

  describe('parked', () => {
    it('parks once the engine has been off at a standstill for engineOffParkedAfterMs', () => {
      const states = run(stoppedState(0), [
        { at: 2000, speedKph: 0, engineRunning: false },
        { at: 31_999, speedKph: 0, engineRunning: false },
        { at: 32_000, speedKph: 0, engineRunning: false },
      ]);
      expect(contexts(states)).toEqual(['stopped', 'stopped', 'parked']);
      expect(last(states).since).toBe(32_000);
    });

    it('does not park during an automatic start-stop at a red light', () => {
      const states = run(cityState(0), [
        { at: 1000, speedKph: 20 },
        { at: 3000, speedKph: 0, engineRunning: false },
        { at: 25_000, speedKph: 0, engineRunning: false },
        { at: 26_000, speedKph: 0, engineRunning: true },
        { at: 27_000, speedKph: 8 },
        // A second stop restarts the engine-off timer from scratch.
        { at: 40_000, speedKph: 0, engineRunning: false },
        { at: 65_000, speedKph: 0, engineRunning: false },
      ]);
      expect(contexts(states)).toEqual([
        'city',
        'stopped',
        'stopped',
        'stopped',
        'city',
        'stopped',
        'stopped',
      ]);
    });

    it('parks on engine off with unknown speed once the ECU has been silent for the grace', () => {
      // stoppedState's last speed reading is at 1000 ms; the link stays up at ignition off.
      const states = run(stoppedState(0), [
        { at: 3000, speedKph: null, engineRunning: false },
        { at: 1000 + DATA_GAP_GRACE_MS - 1, speedKph: null, engineRunning: false },
        { at: 1000 + DATA_GAP_GRACE_MS, speedKph: null, engineRunning: false },
      ]);
      expect(contexts(states)).toEqual(['stopped', 'stopped', 'parked']);
    });

    it('parks immediately on unknown speed when the link is down', () => {
      const s = updateContext(
        stoppedState(0),
        input({ at: 2000, speedKph: null, engineRunning: false, linkUp: false }),
        CONFIG,
      );
      expect(s.context).toBe('parked');
    });

    it('rides out a short OBD data gap at a red light (regression: core-11)', () => {
      // Stopped with the engine running; 2.5 s without samples (ELM327 timeouts) makes speed
      // and rpm stale while the link stays up. Data then resumes: still at the light.
      const states = run(stoppedState(0), [
        { at: 2000, speedKph: 0 },
        { at: 4500, speedKph: null, engineRunning: false },
        { at: 5000, speedKph: 0 },
        { at: 25_000, speedKph: 0 },
      ]);
      expect(contexts(states)).toEqual(['stopped', 'stopped', 'stopped', 'stopped']);
    });

    it('never parks a hybrid creeping in a jam with the engine off (regression: core-2)', () => {
      // Stop for 3 s with the engine off, then creep continuously at 1–3 km/h on electric power
      // for well over engineOffParkedAfterMs: it is still driving.
      const samples: Sample[] = [{ at: 1000, speedKph: 0, engineRunning: false }];
      for (let t = 4000; t <= 4000 + 3 * CONFIG.engineOffParkedAfterMs; t += 500) {
        samples.push({ at: t, speedKph: 1 + (Math.floor(t / 500) % 3), engineRunning: false });
      }
      const states = run(cityState(0), samples);
      expect(new Set(contexts(states))).toEqual(new Set(['stopped']));
      // A complete standstill restarts the engine-off timer from scratch.
      const stopAt = 4000 + 3 * CONFIG.engineOffParkedAfterMs + 500;
      const stopped = run(last(states), [
        { at: stopAt, speedKph: 0, engineRunning: false },
        { at: stopAt + CONFIG.engineOffParkedAfterMs - 1, speedKph: 0, engineRunning: false },
        { at: stopAt + CONFIG.engineOffParkedAfterMs, speedKph: 0, engineRunning: false },
      ]);
      expect(contexts(stopped)).toEqual(['stopped', 'stopped', 'parked']);
    });

    it('never parks a vehicle that is moving with the engine off (hybrid EV mode)', () => {
      const s = last(
        run(cityState(0), [
          { at: 1000, speedKph: 30, engineRunning: false },
          { at: 2000, speedKph: 25, engineRunning: false },
        ]),
      );
      expect(s.context).toBe('city');
    });

    it('parks after parkedAfterMs of complete standstill with the engine running', () => {
      const states = run(stoppedState(0), [
        { at: 1000, speedKph: 0 },
        { at: 60_000, speedKph: 0 },
        { at: 120_999, speedKph: 0 },
        { at: 121_000, speedKph: 0 },
      ]);
      expect(contexts(states)).toEqual(['stopped', 'stopped', 'stopped', 'parked']);
      expect(last(states).since).toBe(121_000);
    });

    it('does not park while creeping in a traffic jam', () => {
      const samples: Sample[] = [];
      // 10 minutes of stop-and-creep: standing for 100 s, then creeping at 1–3 km/h briefly.
      for (let t = 0; t < 600_000; t += 5000) {
        samples.push({ at: 1000 + t, speedKph: t % 105_000 < 100_000 ? 0 : 1 + (t % 3) });
      }
      const states = run(stoppedState(0), samples);
      expect(new Set(contexts(states))).toEqual(new Set(['stopped']));
    });

    it('stays parked when the engine starts until the vehicle actually moves', () => {
      const parked = last(
        run(
          stoppedState(0),
          [
            { at: 1000, speedKph: 0, engineRunning: false },
            { at: 2000, speedKph: 0, engineRunning: false },
          ],
          { ...CONFIG, engineOffParkedAfterMs: 1000 },
        ),
      );
      expect(parked.context).toBe('parked');
      const states = run(parked, [
        { at: 3000, speedKph: 0 },
        { at: 4000, speedKph: 3 },
        { at: 5000, speedKph: 5 },
      ]);
      expect(contexts(states)).toEqual(['parked', 'parked', 'city']);
    });

    it('parks with the link down and no speed when not driving', () => {
      const s = updateContext(stoppedState(0), input({ at: 2000, linkUp: false }), CONFIG);
      expect(s.context).toBe('parked');
      const fresh = updateContext(createContextState(0), input({ at: 1, linkUp: false }), CONFIG);
      expect(fresh.context).toBe('parked');
    });

    it('never leaves a moving context on missing data alone (regression: core-4)', () => {
      // A Bluetooth adapter dies at speed and stays dead: no evidence the car ever stopped.
      const city = cityState(0);
      const states = run(city, [
        { at: 5000, linkUp: false, engineRunning: false },
        { at: 60_000, linkUp: false, engineRunning: false },
        { at: 3_600_000, linkUp: false, engineRunning: false },
        { at: 3_700_000, linkUp: true, engineRunning: false },
      ]);
      expect(contexts(states)).toEqual(['city', 'city', 'city', 'city']);
      // Once the adapter is back, a speed reading ends it as usual.
      const back = run(last(states), [
        { at: 3_800_000, speedKph: 0, engineRunning: false },
        { at: 3_800_000 + CONFIG.engineOffParkedAfterMs, speedKph: 0, engineRunning: false },
      ]);
      expect(contexts(back)).toEqual(['stopped', 'parked']);
    });

    it('also holds the highway context', () => {
      const hw = highwayState(0);
      expect(hw.context).toBe('highway');
      const s = updateContext(hw, input({ at: 600_000, linkUp: false }), CONFIG);
      expect(s).toBe(hw);
    });
  });

  describe('leaving parked by creeping', () => {
    /** Idled at a standstill with the engine running until parked (a jam, a level crossing). */
    function idledParked(): ContextState {
      const states = run(stoppedState(0), [
        { at: 1000, speedKph: 0 },
        { at: 131_000, speedKph: 0 },
      ]);
      expect(last(states).context).toBe('parked');
      return last(states);
    }

    it('returns to stopped once creeping has lasted UNPARK_CREEP_MS (regression: jam creep)', () => {
      const states = run(idledParked(), [
        { at: 140_000, speedKph: 3 },
        { at: 140_000 + UNPARK_CREEP_MS - 1, speedKph: 2 },
        { at: 140_000 + UNPARK_CREEP_MS, speedKph: 3 },
      ]);
      expect(contexts(states)).toEqual(['parked', 'parked', 'stopped']);
      expect(last(states).since).toBe(140_000 + UNPARK_CREEP_MS);
      expect(last(states).creepSince).toBeNull();
      // A minute of creeping at 1–3 km/h never parks again (it never counts as standing still).
      const creeping: Sample[] = [];
      for (let t = 142_000; t <= 202_000; t += 500) {
        creeping.push({ at: t, speedKph: 1 + (Math.floor(t / 500) % 3) });
      }
      expect(new Set(contexts(run(last(states), creeping)))).toEqual(new Set(['stopped']));
    });

    it('stays parked when a creep reading is not held', () => {
      const states = run(idledParked(), [
        { at: 140_000, speedKph: 2 },
        { at: 140_500, speedKph: 0 },
        { at: 141_500, speedKph: 3 },
        { at: 142_000, speedKph: 0 },
      ]);
      expect(contexts(states)).toEqual(['parked', 'parked', 'parked', 'parked']);
      expect(last(states).creepSince).toBeNull();
    });

    it('holds the creep timer through a momentarily unknown speed', () => {
      const states = run(idledParked(), [
        { at: 140_000, speedKph: 3 },
        { at: 140_500, speedKph: null },
        { at: 141_000, speedKph: 3 },
      ]);
      expect(contexts(states)).toEqual(['parked', 'parked', 'stopped']);
    });

    it('also leaves an engine-off park (a hybrid pulling away on electric power)', () => {
      const parked = last(
        run(stoppedState(0), [
          { at: 2000, speedKph: 0, engineRunning: false },
          { at: 40_000, speedKph: 0, engineRunning: false },
        ]),
      );
      expect(parked.context).toBe('parked');
      const states = run(parked, [
        { at: 50_000, speedKph: 2, engineRunning: false },
        { at: 51_000, speedKph: 2, engineRunning: false },
      ]);
      expect(contexts(states)).toEqual(['parked', 'stopped']);
    });
  });

  describe('parking with the engine running', () => {
    const START_STOP: ContextConfig = {
      ...CONFIG,
      parkedAfterMs: 120_000,
      engineOffParkedAfterMs: 180_000,
    };

    it('does not park at a long start-stop red light, nor when the engine restarts', () => {
      // The engine stops at the light; 170 s later it restarts as the light turns green.
      const states = run(
        stoppedState(0),
        [
          { at: 2000, speedKph: 0, engineRunning: false },
          { at: 121_000, speedKph: 0, engineRunning: false },
          { at: 170_000, speedKph: 0, engineRunning: false },
          { at: 171_000, speedKph: 0, engineRunning: true },
          { at: 173_000, speedKph: 0, engineRunning: true },
          { at: 175_000, speedKph: 8, engineRunning: true },
        ],
        START_STOP,
      );
      expect(contexts(states)).toEqual([
        'stopped',
        'stopped',
        'stopped',
        'stopped',
        'stopped',
        'city',
      ]);
    });

    it('restarts the idle timer after an engine stop, then parks after parkedAfterMs', () => {
      const states = run(
        stoppedState(0),
        [
          { at: 2000, speedKph: 0, engineRunning: false },
          { at: 2000 + ENGINE_STOP_CONFIRM_MS, speedKph: 0, engineRunning: false },
          { at: 10_000, speedKph: 0 },
          { at: 129_999, speedKph: 0 },
          { at: 130_000, speedKph: 0 },
        ],
        START_STOP,
      );
      expect(contexts(states)).toEqual(['stopped', 'stopped', 'stopped', 'stopped', 'parked']);
    });

    it('keeps the idle timer through a momentarily stale rpm reading', () => {
      const states = run(stoppedState(0), [
        { at: 1000, speedKph: 0 },
        { at: 60_000, speedKph: 0, engineRunning: false },
        { at: 60_000 + ENGINE_STOP_CONFIRM_MS - 1, speedKph: 0, engineRunning: false },
        { at: 63_500, speedKph: 0 },
        { at: 121_000, speedKph: 0 },
      ]);
      expect(contexts(states)).toEqual(['stopped', 'stopped', 'stopped', 'stopped', 'parked']);
    });

    it('does not park while the phone guides along a route; parks once it ends', () => {
      const samples: Sample[] = [];
      for (let t = 1000; t <= 600_000; t += 5000) {
        samples.push({ at: t, speedKph: 0, routeActive: true });
      }
      const states = run(stoppedState(0), samples);
      expect(new Set(contexts(states))).toEqual(new Set(['stopped']));
      const ended = updateContext(
        last(states),
        input({ at: 601_000, speedKph: 0, routeActive: false }),
        CONFIG,
      );
      expect(ended.context).toBe('parked');
    });

    it('does not park while the transmission reports a gear engaged', () => {
      const states = run(stoppedState(0), [
        { at: 1000, speedKph: 0, reportedGear: 1 },
        { at: 300_000, speedKph: 0, reportedGear: 1 },
        { at: 301_000, speedKph: 0, reportedGear: 0 },
      ]);
      expect(contexts(states)).toEqual(['stopped', 'stopped', 'parked']);
    });

    it('still parks with the engine off whatever the route or gear says', () => {
      const states = run(stoppedState(0), [
        { at: 2000, speedKph: 0, engineRunning: false, routeActive: true, reportedGear: 1 },
        { at: 32_000, speedKph: 0, engineRunning: false, routeActive: true, reportedGear: 1 },
      ]);
      expect(contexts(states)).toEqual(['stopped', 'parked']);
    });
  });

  it('holds the context while speed is briefly unknown with the link up', () => {
    const city = cityState(0);
    const held = updateContext(city, input({ at: 60_000, speedKph: null }), CONFIG);
    expect(held).toBe(city);
    const stopped = stoppedState(0);
    expect(updateContext(stopped, input({ at: 500_000, speedKph: null }), CONFIG)).toBe(stopped);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -5])('treats speed %s as unknown', (speed) => {
    const city = cityState(0);
    expect(updateContext(city, input({ at: 1000, speedKph: speed }), CONFIG)).toBe(city);
  });

  describe('stopped ⇄ city hysteresis', () => {
    it('never flickers while creeping at 1–3 km/h', () => {
      const speeds = [1, 2, 3, 2, 1, 3, 3, 2, 1, 0, 2, 3];
      const states = run(
        stoppedState(0),
        speeds.map((speedKph, i) => ({ at: 2000 + i * 500, speedKph })),
      );
      expect(new Set(contexts(states))).toEqual(new Set(['stopped']));
    });

    it('stays in city while slowing through the hysteresis band', () => {
      const states = run(cityState(0), [
        { at: 1000, speedKph: 3 },
        { at: 1500, speedKph: 2.5 },
        { at: 2000, speedKph: 2 },
        { at: 2500, speedKph: 1.9 },
      ]);
      expect(contexts(states)).toEqual(['city', 'city', 'city', 'stopped']);
    });

    it('moves again only at stationaryKph + hysteresis', () => {
      const exit = CONFIG.stationaryKph + STATIONARY_HYSTERESIS_KPH;
      const states = run(stoppedState(0), [
        { at: 2000, speedKph: exit - 0.1 },
        { at: 2500, speedKph: exit },
      ]);
      expect(contexts(states)).toEqual(['stopped', 'city']);
      expect(last(states).stationarySince).toBeNull();
    });

    it('scales with a custom stationaryKph', () => {
      const config = { ...CONFIG, stationaryKph: 5 };
      const states = run(
        createContextState(0),
        [
          { at: 1000, speedKph: 20 },
          { at: 2000, speedKph: 4 },
          { at: 3000, speedKph: 6 },
          { at: 4000, speedKph: 7 },
        ],
        config,
      );
      expect(contexts(states)).toEqual(['city', 'stopped', 'stopped', 'city']);
    });
  });

  describe('highway', () => {
    it('enters only after highwayDwellMs of sustained speed', () => {
      const states = run(cityState(0), [
        { at: 1000, speedKph: 90 },
        { at: 6000, speedKph: 95 },
        { at: 10_999, speedKph: 95 },
        { at: 11_000, speedKph: 95 },
      ]);
      expect(contexts(states)).toEqual(['city', 'city', 'city', 'highway']);
      expect(last(states).since).toBe(11_000);
    });

    it('restarts the dwell timer when speed dips below the entry threshold', () => {
      const states = run(cityState(0), [
        { at: 1000, speedKph: 90 },
        { at: 8000, speedKph: 79 },
        { at: 9000, speedKph: 90 },
        { at: 12_000, speedKph: 90 },
        { at: 18_999, speedKph: 90 },
        { at: 19_000, speedKph: 90 },
      ]);
      expect(contexts(states)).toEqual(['city', 'city', 'city', 'city', 'city', 'highway']);
    });

    it('keeps the dwell timer through a momentarily unknown speed', () => {
      const states = run(cityState(0), [
        { at: 1000, speedKph: 90 },
        { at: 5000, speedKph: null },
        { at: 11_000, speedKph: 90 },
      ]);
      expect(contexts(states)).toEqual(['city', 'city', 'highway']);
    });

    it('leaves only below highwayExitKph and does not re-enter without a new dwell', () => {
      const states = run(highwayState(0), [
        { at: 20_000, speedKph: 70 },
        { at: 21_000, speedKph: 65 },
        { at: 22_000, speedKph: 64.9 },
        { at: 23_000, speedKph: 75 },
        { at: 24_000, speedKph: 85 },
      ]);
      expect(contexts(states)).toEqual(['highway', 'highway', 'city', 'city', 'city']);
      expect(last(states).highwayCandidateSince).toBe(24_000);
    });

    it('enters immediately with a zero dwell', () => {
      const s = updateContext(cityState(0), input({ at: 1000, speedKph: 80 }), {
        ...CONFIG,
        highwayDwellMs: 0,
      });
      expect(s.context).toBe('highway');
    });

    it('drops straight to stopped when samples are sparse', () => {
      const s = updateContext(highwayState(0), input({ at: 60_000, speedKph: 0 }), CONFIG);
      expect(s.context).toBe('stopped');
      expect(s.highwayCandidateSince).toBeNull();
    });

    it('does not count time going backwards towards the dwell', () => {
      const states = run(cityState(0), [
        { at: 20_000, speedKph: 90 },
        { at: 5000, speedKph: 90 },
      ]);
      expect(contexts(states)).toEqual(['city', 'city']);
    });
  });

  it('is JSON-serialisable and resumes identically after a round trip', () => {
    const samples: Sample[] = [
      { at: 1000, speedKph: 90 },
      { at: 6000, speedKph: 90 },
      { at: 12_000, speedKph: 90 },
      { at: 20_000, speedKph: 0 },
      { at: 30_000, speedKph: 0 },
    ];
    const direct = run(createContextState(0), samples);
    let s = createContextState(0);
    for (const sample of samples) {
      s = JSON.parse(JSON.stringify(updateContext(s, input(sample), CONFIG))) as ContextState;
    }
    expect(s).toEqual(last(direct));
  });
});
