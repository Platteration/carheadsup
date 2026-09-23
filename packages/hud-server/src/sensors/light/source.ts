/**
 * Ambient light sensor source: polls the configured chip at ~5 Hz and emits `sensor/light`
 * (lux × `sensors.lightSensorGain`, which compensates for the sensor window / tint).
 */
import type { HudConfig, LightSensorKind } from '@carheadsup/core';
import type { EventSource, SourceContext } from '../../sources/types.ts';
import { I2cDeviceRunner, type I2cBus, type I2cDevice, type I2cOpener } from '../i2c.ts';
import { Bh1750Driver } from './bh1750.ts';
import type { LightSensorDriver } from './driver.ts';
import { Tsl2591Driver } from './tsl2591.ts';
import { Veml7700Driver } from './veml7700.ts';

/** Poll period (~5 Hz). The brightness filter in core smooths the steps. */
export const LIGHT_POLL_MS = 200;

export function createLightDriver(kind: Exclude<LightSensorKind, 'none'>): LightSensorDriver {
  switch (kind) {
    case 'bh1750':
      return new Bh1750Driver();
    case 'veml7700':
      return new Veml7700Driver();
    case 'tsl2591':
      return new Tsl2591Driver();
  }
}

export interface LightSensorSourceOptions {
  open: I2cOpener;
  /** Driver factory (tests substitute instrumented drivers). */
  createDriver?: (kind: Exclude<LightSensorKind, 'none'>) => LightSensorDriver;
  retryMs?: number;
}

function effectiveGain(config: HudConfig): number {
  const gain = config.sensors.lightSensorGain;
  return Number.isFinite(gain) && gain > 0 ? gain : 1;
}

export class LightSensorSource implements EventSource {
  readonly name = 'light-sensor';
  private readonly options: LightSensorSourceOptions;
  private kind: LightSensorKind;
  private busNumber: number;
  private gain: number;
  private ctx: SourceContext | null = null;
  private runner: I2cDeviceRunner | null = null;

  constructor(config: HudConfig, options: LightSensorSourceOptions) {
    this.options = options;
    this.kind = config.sensors.lightSensor;
    this.busNumber = config.sensors.i2cBus;
    this.gain = effectiveGain(config);
  }

  async start(ctx: SourceContext): Promise<void> {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.launch();
  }

  async stop(): Promise<void> {
    this.ctx = null;
    const runner = this.runner;
    this.runner = null;
    await runner?.stop();
  }

  /** A new gain applies immediately; a different chip or bus restarts the driver. */
  async updateConfig(config: HudConfig): Promise<void> {
    this.gain = effectiveGain(config);
    const { lightSensor, i2cBus } = config.sensors;
    if (lightSensor === this.kind && i2cBus === this.busNumber) return;
    this.kind = lightSensor;
    this.busNumber = i2cBus;
    const runner = this.runner;
    this.runner = null;
    await runner?.stop();
    this.launch();
  }

  private launch(): void {
    const ctx = this.ctx;
    const kind = this.kind;
    if (ctx === null || kind === 'none') return;
    const driver = (this.options.createDriver ?? createLightDriver)(kind);
    const device: I2cDevice = {
      label: `${driver.chip} light sensor`,
      init: (bus: I2cBus, now: number) => driver.init(bus, now),
      poll: async (bus: I2cBus, now: number) => {
        const lux = await driver.read(bus, now);
        if (lux !== null && Number.isFinite(lux) && lux >= 0 && this.ctx === ctx) {
          ctx.emit({ type: 'sensor/light', lux: lux * this.gain, at: ctx.now() });
        }
        return LIGHT_POLL_MS;
      },
      shutdown: (bus: I2cBus) => driver.shutdown(bus),
    };
    const runner = new I2cDeviceRunner({
      busNumber: this.busNumber,
      device,
      open: this.options.open,
      now: ctx.now,
      timers: ctx.timers,
      logger: ctx.logger,
      retryMs: this.options.retryMs,
    });
    this.runner = runner;
    runner.start();
  }
}
