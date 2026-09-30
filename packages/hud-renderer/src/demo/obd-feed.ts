import { SIGNAL_IDS } from '@carheadsup/core';
import type { HudEvent, SignalId } from '@carheadsup/core';
import type { Clock, Timers } from '@carheadsup/obd/runtime';
import type { VehicleSimulator, VehicleSnapshot } from '@carheadsup/obd/sim';

/** Vehicle data is sampled this often (the adapter's fast polling tier manages about 10 Hz). */
export const SAMPLE_INTERVAL_MS = 100;
/** Trouble codes are re-read this often, like the poller's default `obd.dtcIntervalMs`. */
export const DTC_INTERVAL_MS = 30_000;
/** The simulator stands in for this adapter and bus. */
export const SIM_ADAPTER = 'ELM327 v1.5 (simulated)';
export const SIM_PROTOCOL = 'ISO 15765-4 (CAN 11/500)';

type Sample = { signal: SignalId; value: number };

/**
 * The values an OBD-II poller reads from the simulated car, in canonical units: the engine ECU's
 * service 01 PIDs, the transmission's actual gear (PID A4), the adapter's supply voltage and, when
 * the car has TPMS, the four tyre pressures. Speed is whole km/h, as PID 0D reports it.
 */
export function snapshotSamples(s: VehicleSnapshot): Sample[] {
  const samples: Sample[] = [
    { signal: 'speed', value: Math.round(s.speedKph) },
    { signal: 'rpm', value: s.rpm },
    { signal: 'engineLoad', value: s.engineLoadPct },
    { signal: 'absoluteLoad', value: s.absoluteLoadPct },
    { signal: 'throttle', value: s.throttlePct },
    { signal: 'relativeThrottle', value: s.relativeThrottlePct },
    { signal: 'acceleratorPedal', value: s.pedalPct },
    { signal: 'timingAdvance', value: s.timingAdvanceDeg },
    // Like the emulated transmission ECU: neutral while the car stands with the engine off.
    { signal: 'transmissionGear', value: s.engineRunning || s.speedKph > 0 ? s.gear : 0 },
    { signal: 'coolantTemp', value: s.coolantTempC },
    { signal: 'intakeAirTemp', value: s.intakeAirTempC },
    { signal: 'oilTemp', value: s.oilTempC },
    { signal: 'ambientTemp', value: s.ambientTempC },
    { signal: 'catalystTempB1S1', value: s.catalystTempC },
    { signal: 'maf', value: s.mafGps },
    { signal: 'map', value: s.mapKpa },
    { signal: 'baroPressure', value: s.baroKpa },
    { signal: 'fuelLevel', value: s.fuelLevelPct },
    { signal: 'fuelRate', value: s.fuelRateLph },
    { signal: 'commandedLambda', value: s.commandedLambda },
    { signal: 'ethanolPercent', value: s.ethanolPct },
    { signal: 'shortFuelTrimB1', value: s.shortFuelTrimPct },
    { signal: 'longFuelTrimB1', value: s.longFuelTrimPct },
    { signal: 'controlModuleVoltage', value: s.controlModuleVoltage },
    { signal: 'batteryVoltage', value: s.batteryVoltage },
    { signal: 'odometer', value: s.odometerKm },
    { signal: 'runTime', value: s.runTimeS },
    { signal: 'distanceSinceClear', value: s.distanceSinceClearKm },
    { signal: 'distanceWithMil', value: s.distanceWithMilKm },
  ];
  const tyres = s.tirePressuresKpa;
  if (tyres !== null) {
    samples.push(
      { signal: 'tirePressureFL', value: tyres.fl },
      { signal: 'tirePressureFR', value: tyres.fr },
      { signal: 'tirePressureRL', value: tyres.rl },
      { signal: 'tirePressureRR', value: tyres.rr },
    );
  }
  return samples.filter((sample) => Number.isFinite(sample.value));
}

export interface SimulatedObdOptions {
  vehicle: VehicleSimulator;
  emit: (event: HudEvent) => void;
  now: Clock;
  timers: Timers;
}

/**
 * The simulated car's OBD-II link for the in-browser demo. On the server the VehicleSimulator
 * sits behind an emulated ELM327 that the real ObdService polls; that stack needs Node's
 * sockets, so here the adapter and poller are bypassed: the simulator's snapshot is read
 * directly and turned into the events the ObdService would emit — `obd/link` (connecting, then
 * connected), `obd/supported`, `obd/vin`, `obd/samples` every {@link SAMPLE_INTERVAL_MS}, and
 * `obd/dtcs` every {@link DTC_INTERVAL_MS} and as soon as the codes change (as the server asks
 * the poller to after the simulator's codes changed).
 */
export class SimulatedObd {
  private readonly vehicle: VehicleSimulator;
  private readonly emit: (event: HudEvent) => void;
  private readonly now: Clock;
  private readonly timers: Timers;
  private timer: unknown = null;
  private supportedKey: string | null = null;
  private dtcKey: string | null = null;
  private dtcsReadAt = Number.NEGATIVE_INFINITY;

  constructor(options: SimulatedObdOptions) {
    this.vehicle = options.vehicle;
    this.emit = options.emit;
    this.now = options.now;
    this.timers = options.timers;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.emit({ type: 'obd/link', state: 'connecting', message: null, at: this.now() });
    this.emit({
      type: 'obd/link',
      state: 'connected',
      adapter: SIM_ADAPTER,
      protocol: SIM_PROTOCOL,
      message: null,
      at: this.now(),
    });
    this.emit({ type: 'obd/vin', vin: this.vehicle.vin, at: this.now() });
    this.poll();
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.emit({ type: 'obd/link', state: 'disconnected', message: null, at: this.now() });
  }

  private poll(): void {
    const snapshot = this.vehicle.snapshot();
    const samples = snapshotSamples(snapshot);
    const at = this.now();
    // The supported list changes only when TPMS is switched on or off.
    const provided = new Set(samples.map((sample) => sample.signal));
    const signals = SIGNAL_IDS.filter((id) => provided.has(id));
    const key = signals.join(',');
    if (key !== this.supportedKey) {
      this.supportedKey = key;
      this.emit({ type: 'obd/supported', signals, at });
    }
    this.emit({ type: 'obd/samples', samples, at });
    const { stored, pending, permanent } = snapshot.dtcs;
    const dtcKey = [stored, pending, permanent].map((codes) => codes.join(',')).join('|');
    if (dtcKey !== this.dtcKey || at - this.dtcsReadAt >= DTC_INTERVAL_MS) {
      this.dtcKey = dtcKey;
      this.dtcsReadAt = at;
      this.emit({ type: 'obd/dtcs', milOn: snapshot.milOn, stored, pending, permanent, at });
    }
    this.timer = this.timers.setTimeout(() => this.poll(), SAMPLE_INTERVAL_MS);
  }
}
