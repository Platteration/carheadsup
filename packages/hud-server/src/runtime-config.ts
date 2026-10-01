import type { CustomPidConfig, HudConfig } from '@carheadsup/core';
import { SIM_TPMS_PIDS } from '@carheadsup/obd';

/**
 * Overrides applied on top of the stored config at runtime. They never reach `config.json`:
 * the settings app sees (and edits) the stored config, while the engine, the OBD service and
 * the sources run with the effective one.
 */
export interface RuntimeOverrides {
  /** `--sim`: OBD goes to the simulator, whose tyre-pressure PIDs are polled. */
  sim: boolean;
  /** `--port` / `--host` from the command line. */
  port?: number;
  host?: string;
  /** `--tls-port` from the command line (null: TLS off). */
  tlsPort?: number | null;
  /** `--record`: record the OBD adapter's traffic (`obd.recordTranscript`). */
  record?: boolean;
}

/** Custom PIDs with the simulator's TPMS PIDs merged in (they replace user PIDs for the same signal). */
export function withSimTpmsPids(pids: readonly CustomPidConfig[]): CustomPidConfig[] {
  const simSignals = new Set(SIM_TPMS_PIDS.map((pid) => pid.signal));
  return [
    ...pids.filter((pid) => !simSignals.has(pid.signal)).map((pid) => ({ ...pid })),
    ...SIM_TPMS_PIDS.map((pid) => ({ ...pid })),
  ];
}

/** The effective config for `stored` under `overrides`. Returns a new object; `stored` is untouched. */
export function effectiveConfig(stored: HudConfig, overrides: RuntimeOverrides): HudConfig {
  let config: HudConfig = {
    ...stored,
    server: {
      ...stored.server,
      ...(overrides.port !== undefined ? { port: overrides.port } : {}),
      ...(overrides.host !== undefined ? { host: overrides.host } : {}),
      ...(overrides.tlsPort !== undefined ? { tlsPort: overrides.tlsPort } : {}),
    },
  };
  if (overrides.record === true) {
    config = { ...config, obd: { ...config.obd, recordTranscript: true } };
  }
  if (overrides.sim) {
    config = {
      ...config,
      obd: {
        ...config.obd,
        transport: 'simulator',
        customPids: withSimTpmsPids(config.obd.customPids),
      },
      vehicle: { ...config.vehicle, hasTpms: true },
    };
  }
  return config;
}
