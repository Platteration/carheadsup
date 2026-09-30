/**
 * Steering-wheel buttons from the car's CAN bus (`sensors.canButtons`): keeps one `candump`
 * process listening on the configured SocketCAN interface, with kernel filters for the rules'
 * ids, and turns its frames into `input` events through {@link CanButtonEngine}.
 *
 * The HUD never transmits on the car's bus: candump only receives. The interface must also be up
 * in listen-only mode, or its controller acknowledges and error-flags other nodes' frames; the
 * source checks that with `ip -details link show` and warns when it is not.
 */
import { formatCanId, type CanButtonsConfig, type HudConfig } from '@carheadsup/core';
import type { Clock } from '@carheadsup/obd';
import { monotonicView } from '../../clock.ts';
import type { EventSource, SourceContext } from '../../sources/types.ts';
import {
  CommandNotFoundError,
  ProcessSupervisor,
  runCommand,
  type ExitDecision,
  type ExitInfo,
  type SpawnFn,
} from '../process.ts';
import { OnceLogger, TimerSlots, errorMessage } from '../util.ts';
import {
  bringUpHint,
  buildCandumpArgs,
  classifyCandumpError,
  parseCandumpLine,
  parseIpLinkDetails,
} from './candump.ts';
import { CanButtonEngine, canRuleIds, compileCanRules, type TimedAction } from './rules.ts';

export interface CanButtonSourceOptions {
  spawn: SpawnFn;
  /** Default 30 ms. */
  debounceMs?: number;
  /** Default 800 ms. */
  longPressMs?: number;
}

const INSTALL_HINT =
  'CAN buttons: candump not found — install can-utils ("sudo apt install can-utils"); CAN buttons disabled';

function sameSettings(a: CanButtonsConfig, b: CanButtonsConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The interface and the kernel filters: what the running candump was started with. */
function listenKey(settings: CanButtonsConfig): string {
  const ids = canRuleIds(compileCanRules(settings.rules));
  return JSON.stringify([settings.interface, buildCandumpArgs(settings.interface ?? '', ids)]);
}

export class CanButtonSource implements EventSource {
  readonly name = 'can-buttons';
  private readonly options: CanButtonSourceOptions;
  private settings: CanButtonsConfig;
  private ctx: SourceContext | null = null;
  private now: Clock = () => 0;
  private log: OnceLogger | null = null;
  private slots: TimerSlots | null = null;
  private generation = 0;
  private supervisor: ProcessSupervisor | null = null;
  private engine: CanButtonEngine | null = null;
  private launching: Promise<void> = Promise.resolve();
  /** Check the interface's mode again once frames flow (it was missing or down at start). */
  private recheck = false;

  constructor(config: HudConfig, options: CanButtonSourceOptions) {
    this.options = options;
    this.settings = structuredClone(config.sensors.canButtons);
  }

  async start(ctx: SourceContext): Promise<void> {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    // Button timing must not stall or jump when the wall clock is stepped.
    this.now = monotonicView(ctx.now);
    this.log = new OnceLogger(ctx.logger);
    this.slots = new TimerSlots(ctx.timers);
    this.launching = this.launch();
  }

  /** Resolves once the current (re)configuration has probed the interface and started candump. */
  whenReady(): Promise<void> {
    return this.launching;
  }

  async stop(): Promise<void> {
    this.ctx = null;
    await this.halt();
  }

  /**
   * A new interface or a new set of ids restarts candump; changed actions, masks or timing only
   * replace the rule engine (buttons held at that moment are forgotten).
   */
  async updateConfig(config: HudConfig): Promise<void> {
    const next = config.sensors.canButtons;
    if (sameSettings(next, this.settings)) return;
    const restart = listenKey(next) !== listenKey(this.settings);
    this.settings = structuredClone(next);
    if (this.ctx === null) return;
    if (!restart && this.supervisor !== null) {
      await this.launching;
      if (this.supervisor !== null) {
        this.engine = this.createEngine();
        this.slots?.clear('tick');
        this.ctx.logger.info(`CAN buttons: rules updated (${this.engine.rules.length})`);
        return;
      }
    }
    await this.halt();
    this.log?.reset();
    this.launching = this.launch();
  }

  private async halt(): Promise<void> {
    this.generation += 1;
    await this.launching;
    const supervisor = this.supervisor;
    this.supervisor = null;
    this.engine = null;
    this.slots?.clearAll();
    await supervisor?.stop();
  }

  private async launch(): Promise<void> {
    try {
      await this.configure();
    } catch (err) {
      this.ctx?.logger.error(`CAN buttons: ${errorMessage(err)}`);
    }
  }

  private createEngine(): CanButtonEngine {
    const rules = compileCanRules(this.settings.rules, (index, reason) =>
      this.log?.warn(`rule-${index}`, `CAN buttons: ignoring rule ${index + 1}: ${reason}`),
    );
    return new CanButtonEngine(rules, {
      releaseTimeoutMs: this.settings.releaseTimeoutMs,
      debounceMs: this.options.debounceMs,
      longPressMs: this.options.longPressMs,
    });
  }

  private async configure(): Promise<void> {
    const ctx = this.ctx;
    const log = this.log;
    const iface = this.settings.interface;
    if (ctx === null || log === null || iface === null) return;
    const generation = this.generation;
    const engine = this.createEngine();
    if (engine.rules.length === 0) {
      log.info(
        'no-rules',
        `CAN buttons: no button rules configured; not listening on ${iface} (find the frames with candump, see docs/hardware.md)`,
      );
      return;
    }
    const ids = canRuleIds(engine.rules);
    const bitrate = await this.checkInterface(iface);
    if (generation !== this.generation || this.ctx !== ctx) return;

    this.engine = engine;
    const onExit = (info: ExitInfo): ExitDecision => {
      // Frames may have been lost while candump was down: start again from "all released".
      this.engine?.reset();
      this.slots?.clear('tick');
      const problem = classifyCandumpError(info.stderr, iface);
      if (problem.kind === 'no-device' || problem.kind === 'down') this.recheck = true;
      if (problem.hint !== null) {
        log.warn(`exit-${problem.kind}`, `CAN buttons: candump failed — ${problem.hint}`);
      }
      return 'restart';
    };
    const supervisor = new ProcessSupervisor({
      label: 'CAN buttons',
      command: 'candump',
      args: () => buildCandumpArgs(iface, ids),
      spawn: this.options.spawn,
      timers: ctx.timers,
      now: ctx.now,
      logger: ctx.logger,
      onStdoutLine: (line) => this.onLine(line, supervisor),
      onMissing: () => log.warn('missing', INSTALL_HINT),
      onExit,
    });
    this.supervisor = supervisor;
    const idList = ids.map(formatCanId).join(', ');
    ctx.logger.info(
      `CAN buttons: listening on ${iface}${bitrate !== null ? ` (${bitrate / 1000} kbit/s)` : ''} for ${idList} with candump (${engine.rules.length} rule${engine.rules.length === 1 ? '' : 's'}; receive only)`,
    );
    supervisor.start();
  }

  private onLine(line: string, supervisor: ProcessSupervisor): void {
    // Output that trails a stop or restart must not reach a newer engine.
    const ctx = this.ctx;
    const engine = this.engine;
    if (ctx === null || engine === null || this.supervisor !== supervisor) return;
    const frame = parseCandumpLine(line);
    if (frame === null) return;
    if (this.recheck) {
      this.recheck = false;
      const iface = this.settings.interface;
      if (iface !== null) void this.checkInterface(iface);
    }
    this.act(engine.frame(frame, this.now()));
  }

  private act(actions: readonly TimedAction[]): void {
    const ctx = this.ctx;
    const engine = this.engine;
    if (ctx === null || engine === null) return;
    for (const { action, rule, kind } of actions) {
      ctx.logger.debug(`CAN buttons: ${rule.label} ${kind} → ${action}`);
      ctx.emit({ type: 'input', action, at: ctx.now() });
    }
    this.schedule(engine);
  }

  /** Wake up for the engine's next deadline (debounce, release timeout, long press). */
  private schedule(engine: CanButtonEngine): void {
    const slots = this.slots;
    if (slots === null) return;
    const deadline = engine.nextDeadline();
    if (deadline === null) {
      slots.clear('tick');
      return;
    }
    slots.set('tick', deadline - this.now(), () => {
      if (this.engine !== engine) return;
      this.act(engine.tick(this.now()));
    });
  }

  /**
   * Look at the interface with `ip -details link show` and warn when it is missing, down or not
   * in listen-only mode. Returns its bitrate when known. Never throws.
   */
  private async checkInterface(iface: string): Promise<number | null> {
    const ctx = this.ctx;
    const log = this.log;
    if (ctx === null || log === null) return null;
    let output: { code: number | null; stdout: string; stderr: string };
    try {
      output = await runCommand(
        this.options.spawn,
        ctx.timers,
        'ip',
        ['-details', 'link', 'show', iface],
        3000,
      );
    } catch (err) {
      const why =
        err instanceof CommandNotFoundError ? 'ip (iproute2) is not installed' : errorMessage(err);
      ctx.logger.debug(`CAN buttons: cannot check whether ${iface} is in listen-only mode: ${why}`);
      return null;
    }
    if (this.ctx !== ctx) return null;
    const info = output.code === 0 ? parseIpLinkDetails(output.stdout) : null;
    if (info === null) {
      if (/does not exist|cannot find device/i.test(output.stderr)) {
        this.recheck = true;
        log.warn(
          'no-device',
          `CAN buttons: interface ${iface} does not exist (yet) — check the CAN HAT's overlay in /boot/firmware/config.txt and "ip link"; retrying`,
        );
      } else {
        ctx.logger.debug(`CAN buttons: cannot tell ${iface}'s mode from "ip -details link show"`);
      }
      return null;
    }
    if (info.kind === 'other') {
      log.warn('not-can', `CAN buttons: ${iface} is not a CAN interface`);
      return null;
    }
    if (!info.up) {
      // Its mode is chosen when it is brought up: look again once frames arrive.
      this.recheck = true;
      log.warn('down', `CAN buttons: ${iface} is down; ${bringUpHint(iface, info.bitrate)}`);
      return info.bitrate;
    }
    if (info.kind === 'virtual') {
      ctx.logger.debug(`CAN buttons: ${iface} is a virtual CAN interface; no listen-only check`);
    } else if (info.kind === 'can-unknown') {
      ctx.logger.debug(`CAN buttons: cannot tell whether ${iface} is in listen-only mode`);
    } else if (info.listenOnly === false) {
      log.warn(
        'not-listen-only',
        `CAN buttons: ${iface} is NOT in listen-only mode, so its controller acknowledges and error-flags frames on the car's bus; ${bringUpHint(iface, info.bitrate)}`,
      );
    }
    if (info.state === 'BUS-OFF') {
      log.warn(
        'bus-off',
        `CAN buttons: ${iface} is bus-off — wrong bitrate or wiring (CAN-H/CAN-L swapped?)`,
      );
    }
    return info.bitrate;
  }
}
