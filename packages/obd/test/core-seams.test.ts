/**
 * Cross-checks between this package and @carheadsup/core: what the poller emits must be exactly
 * what the reducer understands (signal ids, canonical units, DTC shapes), and the simulator's
 * drivetrain must be what the gear estimator infers.
 */
import {
  DEFAULT_CONFIG,
  EMPTY_PERSISTED_STATE,
  SIGNAL_IDS,
  composeFrame,
  createGearState,
  createInitialState,
  matchGearRatio,
  reduce,
  updateGear,
  type GearState,
  type HudConfig,
  type HudEvent,
  type SignalId,
  type TransmissionType,
  type VehicleConfig,
} from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { Elm327 } from '../src/elm327.ts';
import { ObdPoller } from '../src/poller.ts';
import { Elm327Emulator, SIM_TPMS_PIDS } from '../src/sim/elm327-emulator.ts';
import { GEAR_COUNT, rpmPerKph } from '../src/sim/model.ts';
import { DEMO_SCENARIO } from '../src/sim/scenario.ts';
import { VehicleSimulator } from '../src/sim/vehicle-sim.ts';

const DRIVER = { timeoutMs: 80, settleMs: 5, resetTimeoutMs: 300, searchTimeoutMs: 500 } as const;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const TYRES = { fl: 236.5, fr: 235, rl: 172, rr: 230 } as const;

/** Poll the emulated car for a couple of seconds of simulated driving; returns every event. */
async function pollDrive(): Promise<{ events: HudEvent[]; sim: VehicleSimulator }> {
  const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90, tirePressuresKpa: TYRES });
  const emulator = new Elm327Emulator(sim, { latencyMs: 0 });
  await emulator.open();
  const elm = new Elm327(emulator, DRIVER);
  const info = await elm.initialize({ protocol: '0' });
  // What the service reports once the adapter is initialised.
  const events: HudEvent[] = [
    {
      type: 'obd/link',
      state: 'connected',
      adapter: info.adapter,
      protocol: info.protocol,
      message: null,
      at: Date.now(),
    },
  ];
  const poller = new ObdPoller(
    elm,
    {
      maxPidsPerRequest: info.maxPidsPerRequest,
      voltageSupported: info.voltageSupported,
      customPids: SIM_TPMS_PIDS,
      link: { adapter: info.adapter, protocol: info.protocol },
      tuning: {
        cycleIntervalMs: 5,
        mediumIntervalMs: 20,
        slowIntervalMs: 50,
        verySlowIntervalMs: 100,
      },
    },
    (event) => events.push(event),
  );
  sim.setControls({ throttle: 0.3, dtcs: ['P0420'] });
  const running = poller.run();
  for (let i = 0; i < 30; i++) {
    sim.step(100);
    await sleep(10);
  }
  poller.stop();
  await running;
  await emulator.close();
  return { events, sim };
}

describe('ObdPoller events → reducer → composer', () => {
  it('feeds the reducer signals, units, trouble codes and the VIN it understands', async () => {
    const { events, sim } = await pollDrive();
    const truth = sim.snapshot();
    const config: HudConfig = {
      ...DEFAULT_CONFIG,
      vehicle: { ...DEFAULT_CONFIG.vehicle, hasTpms: true },
    };
    const first = events[0];
    if (first === undefined) throw new Error('no events');
    let state = createInitialState(config, EMPTY_PERSISTED_STATE, first.at);
    for (const event of events) state = reduce(state, event, config);

    // Every sample is a canonical signal with a finite value — the reducer silently drops
    // anything else, so a naming drift would otherwise go unnoticed.
    const known = new Set<string>(SIGNAL_IDS);
    const latest = new Map<SignalId, number>();
    for (const event of events) {
      if (event.type !== 'obd/samples') continue;
      for (const { signal, value } of event.samples) {
        expect(known, signal).toContain(signal);
        expect(Number.isFinite(value), signal).toBe(true);
        latest.set(signal, value);
      }
    }
    for (const [signal, value] of latest) {
      expect(state.vehicle.signals[signal]?.value, signal).toBe(value);
    }
    const supported = events.find((e) => e.type === 'obd/supported');
    expect(supported?.type === 'obd/supported' ? supported.signals : null).toEqual(
      state.vehicle.supported,
    );

    // Canonical units (km/h, °C, V, %, km, kPa gauge) agree with the simulation.
    const value = (signal: SignalId): number => latest.get(signal) ?? Number.NaN;
    expect(Math.abs(value('speed') - truth.speedKph)).toBeLessThan(5);
    expect(value('coolantTemp')).toBeCloseTo(truth.coolantTempC, -1);
    expect(value('batteryVoltage')).toBeGreaterThan(13);
    expect(value('batteryVoltage')).toBeLessThan(15);
    expect(value('fuelLevel')).toBeCloseTo(truth.fuelLevelPct, 0);
    expect(value('odometer')).toBeCloseTo(truth.odometerKm, 0);
    expect(value('tirePressureRL')).toBeCloseTo(TYRES.rl, 1);
    expect(value('tirePressureFL')).toBeCloseTo(TYRES.fl, 1);

    // Trouble codes in the reducer's shape, decoded into a check-engine alert.
    expect(state.vehicle.milOn).toBe(true);
    expect(state.vehicle.dtcs).toContainEqual({
      code: 'P0420',
      kind: 'stored',
      firstSeenAt: expect.any(Number),
    });
    expect(state.alerts).toContainEqual(
      expect.objectContaining({
        key: 'check-engine:P0420',
        title: 'CHECK ENGINE',
        detail: 'P0420 – Catalytic converter efficiency',
      }),
    );
    expect(state.vehicle.vin).toBe(sim.vin);

    // PID 0xA4 wins over inference.
    expect(state.gear.estimate).toMatchObject({ gear: value('transmissionGear'), inferred: false });

    const frame = composeFrame(state, config);
    expect(frame.status.obd).toBe('connected');
    expect(frame.context).toBe('city');
    expect(frame.widgets).toContainEqual(
      expect.objectContaining({ id: 'speed', value: Math.round(value('speed')) }),
    );
    expect(frame.alerts).toContainEqual(
      expect.objectContaining({ key: 'tpms', detail: 'Rear left 172 kPa' }),
    );
  });
});

// ---------------------------------------------------------------------------------------------

const MODEL_RATIOS = Array.from({ length: GEAR_COUNT }, (_, i) => rpmPerKph(i + 1));
/**
 * One loop of the demo drive. Its parked step follows the HUD's engine-off parking delay, so
 * the loop length depends on the core config; scoring over whole loops keeps the amount of
 * driving scored independent of it.
 */
const DEMO_LOOP_S = DEMO_SCENARIO.reduce((sum, step) => sum + step.durationS, 0);

interface Agreement {
  /** Samples scored: engine running, ≥ 20 km/h, and ≥ 2 s since the simulator last shifted. */
  scored: number;
  agreed: number;
  mismatches: string[];
}

/**
 * Drive the demo scenario at 10 Hz, feeding the estimator what the OBD link would deliver
 * (speed PID: whole km/h, rpm PID: quarter rpm, no PID 0xA4), and score it against the
 * simulator's true gear once the last shift has settled.
 */
function driveScenario(
  vehicle: VehicleConfig,
  seconds: number,
  scoreFromS: number,
): { gear: GearState; agreement: Agreement } {
  const sim = new VehicleSimulator({ mode: 'scenario', engineTempC: 90 });
  let gear = createGearState(null);
  const agreement: Agreement = { scored: 0, agreed: 0, mismatches: [] };
  let simGear = -1;
  let shiftedAt = 0;
  for (let i = 0; i < seconds * 10; i++) {
    sim.step(100);
    const s = sim.snapshot();
    const at = 1_700_000_000_000 + i * 100;
    if (s.gear !== simGear) {
      simGear = s.gear;
      shiftedAt = at;
    }
    gear = updateGear(
      gear,
      {
        at,
        speedKph: Math.round(s.speedKph),
        rpm: Math.round(s.rpm * 4) / 4,
        throttlePct: s.throttlePct,
        reportedGear: null,
      },
      vehicle,
    );
    if (i < scoreFromS * 10 || !s.engineRunning || s.speedKph < 20 || at - shiftedAt < 2000) {
      continue;
    }
    agreement.scored++;
    if (gear.estimate.gear === s.gear) agreement.agreed++;
    else if (agreement.mismatches.length < 5) {
      agreement.mismatches.push(
        `t=${(i / 10).toFixed(1)}s sim=${s.gear} estimate=${String(gear.estimate.gear)}`,
      );
    }
  }
  return { gear, agreement };
}

const vehicleWith = (
  transmission: TransmissionType,
  gearRatiosRpmPerKph: number[] | null,
): VehicleConfig => ({
  ...DEFAULT_CONFIG.vehicle,
  transmission,
  idleRpm: 750,
  redlineRpm: 6500,
  gearRatiosRpmPerKph,
});

describe('simulator drivetrain → gear estimator', () => {
  it('matches every simulated gear ratio to its own gear, within PID speed resolution', () => {
    for (let gear = 1; gear <= GEAR_COUNT; gear++) {
      for (const kph of [15, 30, 50, 80, 110, 140]) {
        const rpm = rpmPerKph(gear) * kph;
        if (rpm < 1000 || rpm > 6500) continue;
        for (const reportedKph of [kph - 0.5, kph, kph + 0.5]) {
          for (const transmission of ['manual', 'automatic'] as const) {
            const match = matchGearRatio(
              rpm / reportedKph,
              reportedKph,
              MODEL_RATIOS,
              transmission,
            );
            expect(match?.index, `${transmission} gear ${gear} at ${reportedKph} km/h`).toBe(
              gear - 1,
            );
          }
        }
      }
    }
  });

  it('tracks the simulated automatic through the demo drive with configured ratios', () => {
    const { agreement } = driveScenario(vehicleWith('automatic', MODEL_RATIOS), 300, 0);
    expect(agreement.scored).toBeGreaterThan(1000);
    expect(agreement.mismatches).toEqual([]);
  });

  it('learns the simulated ratios and then tracks the gear with them', () => {
    const { gear, agreement } = driveScenario(
      vehicleWith('automatic', null),
      600 + DEMO_LOOP_S,
      600,
    );
    const learned = gear.learnedRatios;
    expect(learned).toHaveLength(GEAR_COUNT);
    learned?.forEach((ratio, i) => {
      expect(Math.abs(ratio / (MODEL_RATIOS[i] ?? Number.NaN) - 1), `gear ${i + 1}`).toBeLessThan(
        0.02,
      );
    });
    expect(agreement.scored).toBeGreaterThan(1000);
    expect(agreement.mismatches).toEqual([]);
  });
});
