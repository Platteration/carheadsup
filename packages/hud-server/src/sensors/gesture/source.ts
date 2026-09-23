/**
 * Gesture sensor source: drives an APDS-9960 gesture engine over I2C and emits `input` events
 * for swipes (right → primary, left → secondary, up/down → brightness).
 */
import type { GestureSensorKind, HudConfig, InputAction } from '@carheadsup/core';
import type { EventSource, SourceContext } from '../../sources/types.ts';
import {
  I2C_BLOCK_MAX,
  I2cDeviceRunner,
  type I2cBus,
  type I2cDevice,
  type I2cOpener,
} from '../i2c.ts';
import {
  APDS9960_ADDRESS,
  APDS9960_GCONF4,
  APDS9960_GSTATUS,
  APDS9960_INIT_SEQUENCE,
  APDS9960_KNOWN_IDS,
  APDS9960_REGISTERS as R,
  GESTURE_ACTIONS,
  GestureAccumulator,
  parseGestureFifo,
  type GestureSample,
} from './apds9960.ts';

/** Poll period. At 2.8 ms per dataset the 32-deep FIFO lasts ~100 ms, so 40 ms keeps up. */
export const GESTURE_POLL_MS = 40;
/** The FIFO never holds more than 32 datasets; anything larger is a bus glitch. */
const FIFO_DEPTH = 32;

/** APDS-9960 driver: init, one poll cycle (drain FIFO, finish gestures), shutdown. */
export class Apds9960Device implements I2cDevice {
  readonly label = 'APDS-9960 gesture sensor';
  private readonly onSwipe: (action: InputAction) => void;
  private readonly onUnknownId: (id: number) => void;
  private readonly gesture = new GestureAccumulator();

  constructor(options: {
    onSwipe: (action: InputAction) => void;
    onUnknownId?: (id: number) => void;
  }) {
    this.onSwipe = options.onSwipe;
    this.onUnknownId = options.onUnknownId ?? (() => {});
  }

  async init(bus: I2cBus): Promise<void> {
    this.gesture.reset();
    const id = await bus.readByte(APDS9960_ADDRESS, R.ID);
    // Clones report other IDs but behave the same; keep going and let the caller log it.
    if (!APDS9960_KNOWN_IDS.includes(id)) this.onUnknownId(id);
    for (const [register, value] of APDS9960_INIT_SEQUENCE) {
      await bus.writeByte(APDS9960_ADDRESS, register, value);
    }
  }

  async poll(bus: I2cBus, now: number): Promise<number> {
    const status = await bus.readByte(APDS9960_ADDRESS, R.GSTATUS);
    const valid = (status & APDS9960_GSTATUS.GVALID) !== 0;
    let level = 0;
    // GVALID only reports "at least GFIFOTH datasets"; the tail of a gesture sits below it.
    if (valid || this.gesture.active) {
      level = Math.min(FIFO_DEPTH, await bus.readByte(APDS9960_ADDRESS, R.GFLVL));
    }
    if (level > 0) {
      this.gesture.add(await this.readFifo(bus, level), now);
      return GESTURE_POLL_MS;
    }
    if (this.gesture.active) {
      const gconf4 = await bus.readByte(APDS9960_ADDRESS, R.GCONF4);
      const engineIdle = (gconf4 & APDS9960_GCONF4.GMODE) === 0;
      const direction = this.gesture.finish(now, engineIdle);
      if (direction !== undefined && direction !== null) this.onSwipe(GESTURE_ACTIONS[direction]);
    }
    return GESTURE_POLL_MS;
  }

  async shutdown(bus: I2cBus): Promise<void> {
    await bus.writeByte(APDS9960_ADDRESS, R.ENABLE, 0x00);
  }

  /** Read `level` datasets in ≤ 32-byte block reads; each 4-byte read pops one dataset. */
  private async readFifo(bus: I2cBus, level: number): Promise<GestureSample[]> {
    const samples: GestureSample[] = [];
    let remaining = level * 4;
    while (remaining > 0) {
      const chunk = Math.min(I2C_BLOCK_MAX, remaining);
      samples.push(...parseGestureFifo(await bus.readBlock(APDS9960_ADDRESS, R.GFIFO_U, chunk)));
      remaining -= chunk;
    }
    return samples;
  }
}

export interface GestureSensorSourceOptions {
  open: I2cOpener;
  retryMs?: number;
}

export class GestureSensorSource implements EventSource {
  readonly name = 'gesture-sensor';
  private readonly options: GestureSensorSourceOptions;
  private kind: GestureSensorKind;
  private busNumber: number;
  private ctx: SourceContext | null = null;
  private runner: I2cDeviceRunner | null = null;

  constructor(config: HudConfig, options: GestureSensorSourceOptions) {
    this.options = options;
    this.kind = config.sensors.gestureSensor;
    this.busNumber = config.sensors.i2cBus;
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

  async updateConfig(config: HudConfig): Promise<void> {
    const { gestureSensor, i2cBus } = config.sensors;
    if (gestureSensor === this.kind && i2cBus === this.busNumber) return;
    this.kind = gestureSensor;
    this.busNumber = i2cBus;
    const runner = this.runner;
    this.runner = null;
    await runner?.stop();
    this.launch();
  }

  private launch(): void {
    const ctx = this.ctx;
    if (ctx === null || this.kind !== 'apds9960') return;
    const device = new Apds9960Device({
      onSwipe: (action) => {
        if (this.ctx === ctx) ctx.emit({ type: 'input', action, at: ctx.now() });
      },
      onUnknownId: (id) =>
        ctx.logger.warn(
          `APDS-9960 gesture sensor: unexpected chip id 0x${id.toString(16)}; continuing (clone?)`,
        ),
    });
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
