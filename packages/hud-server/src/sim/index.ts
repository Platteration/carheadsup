import type { HudConfig, SimStatus } from '@carheadsup/core';
import { SimulationClock, VehicleSimulator } from '@carheadsup/obd';
import { phoneMessageToEvents } from '../phone/translate.ts';
import type { PhoneMessageTranslator, RuntimeDeps, Simulation } from '../sources/types.ts';
import { SimAdas, SimEnvironment } from './peripherals.ts';
import { SimPhone } from './phone.ts';

export { SimAdas, SimEnvironment } from './peripherals.ts';
export { SimPhone } from './phone.ts';

export interface SimulationOptions {
  /** Phone-message translator; defaults to the one real phone sessions use. */
  translate?: PhoneMessageTranslator;
  /** Supply the vehicle (tests); defaults to a VehicleSimulator running the demo scenario. */
  vehicle?: VehicleSimulator;
  /** SimulationClock tick period (default 50 ms). */
  stepMs?: number;
  /** Simulated ms per real ms (default 1). */
  timeScale?: number;
}

/**
 * Build the simulated vehicle + peripherals used by `--sim` and the dev console: the
 * VehicleSimulator (scenario mode), a simulated phone synced to the scenario, a light sensor and
 * an ADAS module. `start()` steps the vehicle in real time from `deps.timers`/`deps.now`;
 * the peripheral sources are started by the engine like any other source.
 */
export function createSimulation(
  config: HudConfig,
  deps: RuntimeDeps,
  options: SimulationOptions = {},
): Simulation {
  const vehicle = options.vehicle ?? new VehicleSimulator({ mode: 'scenario' });
  const environment = new SimEnvironment(vehicle.status().lux);
  const adas = new SimAdas();
  const phone = new SimPhone({
    vehicle,
    translate: options.translate ?? phoneMessageToEvents,
    readMessagesAloud: config.phone.readMessagesAloud,
    logger: deps.logger,
  });
  const clock = new SimulationClock(vehicle, {
    now: deps.now,
    timers: deps.timers,
    ...(options.stepMs !== undefined ? { stepMs: options.stepMs } : {}),
    ...(options.timeScale !== undefined ? { timeScale: options.timeScale } : {}),
  });

  const status = (): SimStatus => ({ ...vehicle.status(), lux: environment.lux });

  return {
    vehicle,
    sources: [phone, environment, adas],
    control(control) {
      // Vehicle fields (mode, pedals, engine, gear, DTCs, overrides, ambient temperature, tyre
      // pressures); the vehicle keeps its own copy of the lux for its snapshot.
      vehicle.setControls(control);
      if (control.lux !== undefined) environment.setLux(control.lux);
      if (control.adas !== undefined) adas.apply(control.adas);
      if (control.phone !== undefined) phone.trigger(control.phone);
      return status();
    },
    status,
    deliverToPhone(message) {
      phone.deliver(message);
    },
    start() {
      clock.start();
    },
    async stop() {
      clock.stop();
    },
  };
}
