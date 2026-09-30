/**
 * `@carheadsup/obd/sim` — the vehicle simulation on its own: the deterministic car model, the
 * scripted demo drive and the real-time clock that steps it. Browser-safe (no Node.js built-ins,
 * no serial port): the in-browser demo runs it without a server. The ELM327 emulator that puts it
 * on a simulated adapter needs the transports and stays in the main entry.
 */
export {
  VehicleSimulator,
  type ScenarioStepListener,
  type TirePressures,
  type VehicleSimulatorOptions,
  type VehicleSnapshot,
} from './vehicle-sim.ts';
export { DEMO_PARKED_S, DEMO_SCENARIO, SpeedController, type ScenarioStep } from './scenario.ts';
export { VEHICLE_MODEL, rpmPerKph } from './model.ts';
export { SimulationClock, type SimulationClockOptions } from './clock.ts';
