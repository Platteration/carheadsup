/**
 * GPIO buttons through libgpiod's `gpiomon`: detects the tool's version and features and the
 * header's GPIO chip, then keeps one gpiomon process watching every configured line (BCM
 * numbering), with the internal pull-up requested. Edges go through {@link ButtonDebouncer}.
 */
import type { HudConfig } from '@carheadsup/core';
import type { EventSource, SourceContext } from '../../sources/types.ts';
import {
  CommandNotFoundError,
  ProcessSupervisor,
  runCommand,
  type ExitDecision,
  type ExitInfo,
  type SpawnFn,
} from '../process.ts';
import { OnceLogger, errorMessage } from '../util.ts';
import { BUTTON_ROLES, ButtonDebouncer, type ButtonRole } from './buttons.ts';
import { detectHeaderChip, type SysFs } from './chip.ts';
import {
  buildGpiomonArgs,
  classifyGpiomonError,
  detectGpiomonFeatures,
  parseGpiomonLine,
  type GpiomonFeatures,
} from './gpiomon.ts';

export interface GpioButtonSourceOptions {
  spawn: SpawnFn;
  fs: SysFs;
  debounceMs?: number;
  longPressMs?: number;
}

const INSTALL_HINT =
  'GPIO buttons: gpiomon not found — install libgpiod tools ("sudo apt install gpiod"); buttons disabled';

type ButtonLines = HudConfig['sensors']['buttons'];

/** Offset → role for the configured lines; a line assigned twice keeps its first role. */
export function buttonLineMap(
  buttons: ButtonLines,
  onDuplicate?: (offset: number, role: ButtonRole) => void,
): Map<number, ButtonRole> {
  const map = new Map<number, ButtonRole>();
  for (const role of BUTTON_ROLES) {
    const offset = buttons[role];
    if (offset === null || !Number.isInteger(offset) || offset < 0) continue;
    if (map.has(offset)) {
      onDuplicate?.(offset, role);
      continue;
    }
    map.set(offset, role);
  }
  return map;
}

function sameButtons(a: ButtonLines, b: ButtonLines): boolean {
  return a.primary === b.primary && a.secondary === b.secondary && a.next === b.next;
}

export class GpioButtonSource implements EventSource {
  readonly name = 'gpio-buttons';
  private readonly options: GpioButtonSourceOptions;
  private buttons: ButtonLines;
  private ctx: SourceContext | null = null;
  private log: OnceLogger | null = null;
  private generation = 0;
  private supervisor: ProcessSupervisor | null = null;
  private debouncer: ButtonDebouncer | null = null;
  private launching: Promise<void> = Promise.resolve();

  constructor(config: HudConfig, options: GpioButtonSourceOptions) {
    this.options = options;
    this.buttons = { ...config.sensors.buttons };
  }

  async start(ctx: SourceContext): Promise<void> {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.log = new OnceLogger(ctx.logger);
    // Probing the tools can take seconds on a slow SD card; do not hold up the HUD's start.
    this.launching = this.launch();
  }

  /** Resolves once the current (re)configuration has finished probing and started gpiomon. */
  whenReady(): Promise<void> {
    return this.launching;
  }

  async stop(): Promise<void> {
    this.ctx = null;
    await this.halt();
  }

  /** Only a change of the button lines restarts gpiomon. */
  async updateConfig(config: HudConfig): Promise<void> {
    const next = config.sensors.buttons;
    if (sameButtons(next, this.buttons)) return;
    this.buttons = { ...next };
    if (this.ctx === null) return;
    await this.halt();
    this.launching = this.launch();
  }

  private async halt(): Promise<void> {
    this.generation += 1;
    await this.launching;
    const supervisor = this.supervisor;
    this.supervisor = null;
    await supervisor?.stop();
    this.debouncer?.reset();
    this.debouncer = null;
  }

  private async launch(): Promise<void> {
    try {
      await this.configure();
    } catch (err) {
      this.ctx?.logger.error(`GPIO buttons: ${errorMessage(err)}`);
    }
  }

  private async configure(): Promise<void> {
    const ctx = this.ctx;
    const log = this.log;
    if (ctx === null || log === null) return;
    const generation = this.generation;
    const lines = buttonLineMap(this.buttons, (offset, role) =>
      log.warn(
        `duplicate-${offset}`,
        `GPIO buttons: GPIO${offset} is already used by another button; ignoring it for "${role}"`,
      ),
    );
    if (lines.size === 0) return;

    const { spawn } = this.options;
    let features: GpiomonFeatures;
    try {
      const version = await runCommand(spawn, ctx.timers, 'gpiomon', ['--version'], 3000);
      const help = await runCommand(spawn, ctx.timers, 'gpiomon', ['--help'], 3000).then(
        (r) => `${r.stdout}\n${r.stderr}`,
        () => null,
      );
      features = detectGpiomonFeatures(`${version.stdout}\n${version.stderr}`, help);
    } catch (err) {
      if (err instanceof CommandNotFoundError) log.warn('missing', INSTALL_HINT);
      else
        log.warn(
          'probe',
          `GPIO buttons: cannot run gpiomon: ${errorMessage(err)}; buttons disabled`,
        );
      return;
    }
    const detection = await detectHeaderChip({ spawn, timers: ctx.timers, fs: this.options.fs });
    if (generation !== this.generation || this.ctx !== ctx) return;
    if (detection.source === 'default') {
      log.warn(
        'chip',
        'GPIO buttons: could not identify the 40-pin header GPIO chip (pinctrl-rp1/bcm2711/bcm2835); using gpiochip0',
      );
    }
    if (!features.bias) {
      log.warn(
        'no-bias',
        `GPIO buttons: gpiomon ${features.version} cannot enable pull-ups; fit external pull-up resistors or set them in /boot/firmware/config.txt (gpio=<n>=ip,pu)`,
      );
    }
    // libgpiod < 1.5 block-buffers its output on a pipe; stdbuf makes it line-buffered.
    const viaStdbuf = features.major === 1 && !features.lineBuffered;
    const offsets = [...lines.keys()];

    const debouncer = new ButtonDebouncer({
      timers: ctx.timers,
      debounceMs: this.options.debounceMs,
      longPressMs: this.options.longPressMs,
      onAction: (action) => {
        if (this.ctx === ctx) ctx.emit({ type: 'input', action, at: ctx.now() });
      },
    });
    this.debouncer = debouncer;

    const args = (): readonly string[] => {
      const gpiomonArgs = buildGpiomonArgs({
        features,
        chip: detection.chip,
        offsets,
        pullUp: true,
      });
      return viaStdbuf ? ['-oL', 'gpiomon', ...gpiomonArgs] : gpiomonArgs;
    };
    const onExit = (info: ExitInfo): ExitDecision => {
      // Edges may have been lost while gpiomon was down: start from "all released".
      debouncer.reset();
      const problem = classifyGpiomonError(info.stderr);
      if (problem.kind === 'no-bias' && features.bias) {
        features = { ...features, bias: false };
        log.warn(
          'no-bias',
          'GPIO buttons: this system cannot enable GPIO pull-ups; fit external pull-up resistors or set them in /boot/firmware/config.txt (gpio=<n>=ip,pu)',
        );
      } else if (problem.hint !== null) {
        log.warn(`exit-${problem.kind}`, `GPIO buttons: gpiomon failed — ${problem.hint}`);
      }
      return 'restart';
    };
    const supervisor = new ProcessSupervisor({
      label: 'GPIO buttons',
      command: viaStdbuf ? 'stdbuf' : 'gpiomon',
      args,
      spawn,
      timers: ctx.timers,
      now: ctx.now,
      logger: ctx.logger,
      onStdoutLine: (line) => {
        const event = parseGpiomonLine(line);
        if (event === null) return;
        const role = lines.get(event.offset);
        // Active-low: the line falls when the button closes to ground. Output that trails a
        // stop or restart must not reach a debouncer that has been reset.
        if (role !== undefined && this.debouncer === debouncer) {
          debouncer.edge(role, event.edge === 'falling');
        }
      },
      onMissing: () => log.warn('missing', INSTALL_HINT),
      onExit,
    });
    this.supervisor = supervisor;
    ctx.logger.info(
      `GPIO buttons: watching ${offsets.map((o) => `GPIO${o}`).join(', ')} on ${detection.chip}` +
        `${detection.label !== null ? ` (${detection.label})` : ''} with gpiomon ${features.version}`,
    );
    supervisor.start();
  }
}
