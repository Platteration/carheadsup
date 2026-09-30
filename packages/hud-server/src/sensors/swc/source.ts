/**
 * Steering-wheel buttons on a resistor ladder (`sensors.swcButtons`): an ADS1115 ADC on
 * `sensors.i2cBus` measures the ladder wire (pulled up to 3.3 V) at ~50 Hz, and
 * {@link LadderDetector} turns the voltages into `input` events. Runs on the shared
 * {@link I2cDeviceRunner}, so an unplugged ADC is retried quietly and a missing `i2c-bus`
 * package leaves the source idle.
 *
 * At debug log level the steady voltage is logged whenever it moves by more than 50 mV: press
 * and hold each button and read its voltage off the log to set up the windows.
 */
import type {
  HudConfig,
  InputAction,
  SwcButtonsConfig,
  SwcWindow,
  VoltageRange,
} from '@carheadsup/core';
import type { EventSource, SourceContext } from '../../sources/types.ts';
import { I2cDeviceRunner, type I2cBus, type I2cDevice, type I2cOpener } from '../i2c.ts';
import { OnceLogger } from '../util.ts';
import {
  ADS1115_REGISTERS as R,
  CONFIG_READBACK_MASK,
  ads1115Config,
  conversionToVolts,
  registerValue,
  registerWrite,
  toSigned16,
  type Ads1115Setup,
} from './ads1115.ts';
import { LadderDetector, classifyVoltage, type LadderSample } from './ladder.ts';

/** Poll period: 50 readings a second, so the 3-reading debounce takes 60 ms. */
export const SWC_POLL_MS = 20;

/** Conversions run continuously at 128 SPS (7.8 ms each): every poll finds a fresh one. */
const DATA_RATE = 128;

export interface Ads1115ReaderOptions {
  address: number;
  setup: Omit<Ads1115Setup, 'continuous' | 'dataRate'>;
  /** Every reading, in volts, with the runner's (monotonic) time. */
  onReading: (volts: number, now: number) => void;
  /** Called before (re)initialising the chip, e.g. to forget held buttons. */
  onInit?: () => void;
}

/** ADS1115 driver: continuous single-ended conversions, one reading per poll. */
export class Ads1115Reader implements I2cDevice {
  readonly label: string;
  private readonly options: Ads1115ReaderOptions;
  private readonly config: number;

  constructor(options: Ads1115ReaderOptions) {
    this.options = options;
    this.config = ads1115Config({ ...options.setup, continuous: true, dataRate: DATA_RATE });
    const address = `0x${options.address.toString(16)}`;
    this.label = `ADS1115 steering-wheel buttons (${address}, AIN${options.setup.channel})`;
  }

  async init(bus: I2cBus): Promise<void> {
    this.options.onInit?.();
    const { address } = this.options;
    await bus.i2cWrite(address, registerWrite(R.CONFIG, this.config));
    // Another chip at this address (or a floating bus) would not echo the configuration back.
    const readback = registerValue(await bus.readBlock(address, R.CONFIG, 2));
    if ((readback & CONFIG_READBACK_MASK) !== (this.config & CONFIG_READBACK_MASK)) {
      throw new Error(
        `configuration did not stick (wrote 0x${hex4(this.config)}, read 0x${hex4(readback)}); is this an ADS1115?`,
      );
    }
  }

  async poll(bus: I2cBus, now: number): Promise<number> {
    const word = registerValue(await bus.readBlock(this.options.address, R.CONVERSION, 2));
    this.options.onReading(conversionToVolts(toSigned16(word), this.options.setup.fullScaleV), now);
    return SWC_POLL_MS;
  }

  /** Back to single-shot mode, in which the chip powers down between conversions. */
  async shutdown(bus: I2cBus): Promise<void> {
    const idle = ads1115Config({ ...this.options.setup, continuous: false, dataRate: DATA_RATE });
    await bus.i2cWrite(this.options.address, registerWrite(R.CONFIG, idle));
  }
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, '0');
}

export interface SwcButtonSourceOptions {
  open: I2cOpener;
  retryMs?: number;
  /** Default 800 ms. */
  longPressMs?: number;
}

/** What the chip is set up with; a change re-initialises it. */
function hardwareKey(config: HudConfig): string {
  const { enabled, address, channel, fullScaleV } = config.sensors.swcButtons;
  return JSON.stringify([enabled, address, channel, fullScaleV, config.sensors.i2cBus]);
}

function volts(v: number): string {
  return `${v.toFixed(3)} V`;
}

function range(r: VoltageRange): string {
  return `${r.minV}–${r.maxV} V`;
}

export class SwcButtonSource implements EventSource {
  readonly name = 'swc-buttons';
  private readonly options: SwcButtonSourceOptions;
  private settings: SwcButtonsConfig;
  private busNumber: number;
  private hardware: string;
  private ctx: SourceContext | null = null;
  private log: OnceLogger | null = null;
  private runner: I2cDeviceRunner | null = null;
  private detector: LadderDetector | null = null;

  constructor(config: HudConfig, options: SwcButtonSourceOptions) {
    this.options = options;
    this.settings = structuredClone(config.sensors.swcButtons);
    this.busNumber = config.sensors.i2cBus;
    this.hardware = hardwareKey(config);
  }

  async start(ctx: SourceContext): Promise<void> {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.log = new OnceLogger(ctx.logger);
    this.launch();
  }

  async stop(): Promise<void> {
    this.ctx = null;
    await this.halt();
  }

  /**
   * A different chip setup (address, input, range, bus, on/off) re-initialises the ADC; new
   * windows apply at once without touching it (a button held at that moment is forgotten).
   */
  async updateConfig(config: HudConfig): Promise<void> {
    const next = config.sensors.swcButtons;
    const hardware = hardwareKey(config);
    const windowsChanged =
      JSON.stringify([next.idle, next.windows]) !==
      JSON.stringify([this.settings.idle, this.settings.windows]);
    if (hardware === this.hardware && !windowsChanged) return;
    this.settings = structuredClone(next);
    this.busNumber = config.sensors.i2cBus;
    this.log?.reset();
    if (hardware === this.hardware) {
      this.detector?.configure(this.ladder());
      if (this.ctx !== null && this.detector !== null) {
        this.ctx.logger.info(`SWC buttons: ${this.describeWindows()}`);
      }
      return;
    }
    this.hardware = hardware;
    await this.halt();
    this.launch();
  }

  private async halt(): Promise<void> {
    const runner = this.runner;
    this.runner = null;
    this.detector = null;
    await runner?.stop();
  }

  private ladder(): { idle: VoltageRange; windows: readonly SwcWindow[] } {
    return { idle: this.settings.idle, windows: this.settings.windows };
  }

  private describeWindows(): string {
    const { windows, idle } = this.settings;
    if (windows.length === 0) {
      return `no button windows configured; with debug logging (--log-level debug or CARHEADSUP_LOG_LEVEL=debug) the log shows each button's voltage while you hold it (idle ${range(idle)})`;
    }
    const list = windows.map((w, i) => `${i + 1}: ${range(w)} → ${describeActions(w)}`);
    return `idle ${range(idle)}; buttons ${list.join(', ')}`;
  }

  private launch(): void {
    const ctx = this.ctx;
    if (ctx === null || !this.settings.enabled) return;
    const detector = new LadderDetector(this.ladder(), { longPressMs: this.options.longPressMs });
    this.detector = detector;
    const { address, channel, fullScaleV } = this.settings;
    const device = new Ads1115Reader({
      address,
      setup: { channel, fullScaleV },
      onInit: () => detector.reset(),
      onReading: (v, now) => {
        if (this.ctx === ctx && this.detector === detector) this.onSample(detector.sample(v, now));
      },
    });
    ctx.logger.info(`SWC buttons: ${this.describeWindows()}`);
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

  private onSample(sample: LadderSample): void {
    const ctx = this.ctx;
    const log = this.log;
    if (ctx === null || log === null) return;
    if (sample.steadyV !== null) {
      // The calibration aid: press and hold each button and read its voltage here.
      ctx.logger.debug(
        `SWC buttons: steady at ${volts(sample.steadyV)} (${this.describeZone(sample.steadyV)})`,
      );
    }
    if (sample.zone !== null) {
      const { zone, volts: v } = sample.zone;
      if (zone.kind === 'none') {
        log.warn(
          'no-window',
          `SWC buttons: ${volts(v)} matches no button window and is outside the idle range (${range(this.settings.idle)}); set up the windows from the debug log`,
        );
      }
      if (sample.heldAtStart) {
        log.warn(
          'held-at-start',
          `SWC buttons: the ladder reads ${volts(v)} (${this.describeZone(v)}) at start; ignoring it until the button is released`,
        );
      }
    }
    for (const { action, window, kind } of sample.actions) {
      ctx.logger.debug(`SWC buttons: window ${window + 1} ${kind} → ${action}`);
      ctx.emit({ type: 'input', action, at: ctx.now() });
    }
  }

  /** Which window a voltage falls into, for the log. */
  private describeZone(v: number): string {
    const { idle, windows } = this.settings;
    const zone = classifyVoltage(v, idle, windows);
    const window = zone.kind === 'button' ? windows[zone.index] : undefined;
    if (zone.kind === 'button' && window !== undefined) {
      return `window ${zone.index + 1}: ${describeActions(window)}`;
    }
    return zone.kind === 'idle' ? 'idle' : 'no window';
  }
}

function describeActions(window: {
  action: InputAction;
  longPressAction: InputAction | null;
}): string {
  return window.longPressAction === null
    ? window.action
    : `${window.action}, hold: ${window.longPressAction}`;
}
