import type { HudConfig } from '@carheadsup/core';
import type { Clock } from '@carheadsup/obd/runtime';
import type { EventSource } from '../sources/types.ts';
import { AdasUdpSource, defaultUdpSocketFactory, type UdpSocketFactory } from './adas-udp.ts';
import { CanButtonSource } from './can/source.ts';
import { GestureSensorSource } from './gesture/source.ts';
import { nodeSysFs, type SysFs } from './gpio/chip.ts';
import { GpioButtonSource } from './gpio/source.ts';
import { openI2cBus, type I2cOpener } from './i2c.ts';
import { LightSensorSource } from './light/source.ts';
import { defaultSpawn, type SpawnFn } from './process.ts';
import { SwcButtonSource } from './swc/source.ts';
import { TimeZoneSource, type TimeZoneProbe } from './time-zone.ts';

export { AdasUdpSource } from './adas-udp.ts';
export { CanButtonSource } from './can/source.ts';
export { GestureSensorSource } from './gesture/source.ts';
export { GpioButtonSource } from './gpio/source.ts';
export { LightSensorSource } from './light/source.ts';
export { SwcButtonSource } from './swc/source.ts';
export { TimeZoneSource } from './time-zone.ts';

/**
 * Hardware seams, all optional (defaults: the `i2c-bus` package loaded lazily,
 * `child_process.spawn`, `dgram` and the real sysfs). Tests substitute fakes.
 */
export interface SensorIo {
  openI2c?: I2cOpener;
  spawn?: SpawnFn;
  createUdpSocket?: UdpSocketFactory;
  sysfs?: SysFs;
  /** Address the ADAS UDP socket binds to (default 0.0.0.0). */
  adasBindAddress?: string;
  /** Delay before a failed I2C device is re-initialised (default 10 s). */
  i2cRetryMs?: number;
  /** The system time zone (default: the one Node runs in). */
  timeZone?: TimeZoneProbe;
  /**
   * The HUD's wall clock, at which the time zone's UTC offset is read (default: the sources'
   * clock, the system clock).
   */
  wallNow?: Clock;
}

/**
 * Hardware input sources enabled by `config.sensors`: ambient light sensor, gesture sensor,
 * GPIO buttons, steering-wheel buttons (CAN bus and resistor ladder), ADAS UDP feed — and the
 * system time zone (local time and a rough location for night mode), always on. Sources
 * whose hardware is absent log once and stay idle rather than failing the HUD.
 *
 * One source per kind is always returned — a kind that is disabled ('none', no button lines,
 * no CAN interface, ladder off, no ADAS port) stays idle — so that enabling a sensor in the
 * settings takes effect through `updateConfig` without restarting the HUD. `updateConfig`
 * restarts only the sources whose part of the config changed (a new light-sensor gain, new CAN
 * button actions or new ladder windows apply without a restart at all).
 */
export function createSensorSources(config: HudConfig, io: SensorIo = {}): EventSource[] {
  const open = io.openI2c ?? openI2cBus;
  const spawn = io.spawn ?? defaultSpawn;
  return [
    new LightSensorSource(config, { open, retryMs: io.i2cRetryMs }),
    new GestureSensorSource(config, { open, retryMs: io.i2cRetryMs }),
    new GpioButtonSource(config, { spawn, fs: io.sysfs ?? nodeSysFs }),
    new CanButtonSource(config, { spawn }),
    new SwcButtonSource(config, { open, retryMs: io.i2cRetryMs }),
    new AdasUdpSource(config, {
      createSocket: io.createUdpSocket ?? defaultUdpSocketFactory,
      bindAddress: io.adasBindAddress,
    }),
    new TimeZoneSource(config, io.timeZone, io.wallNow ?? null),
  ];
}
