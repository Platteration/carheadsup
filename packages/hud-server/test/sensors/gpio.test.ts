import { DEFAULT_CONFIG, type HudConfig, type InputAction } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import { ButtonDebouncer } from '../../src/sensors/gpio/buttons.ts';
import { detectHeaderChip, listChipsFromSysfs, type SysFs } from '../../src/sensors/gpio/chip.ts';
import {
  buildGpiomonArgs,
  classifyGpiomonError,
  detectGpiomonFeatures,
  labelForCompatible,
  parseGpiodetect,
  parseGpiomonLine,
  parseGpiomonVersion,
  pickHeaderChip,
  type GpiomonFeatures,
} from '../../src/sensors/gpio/gpiomon.ts';
import { GpioButtonSource, buttonLineMap } from '../../src/sensors/gpio/source.ts';
import { FakeClock, fakeSpawn, recordingContext, respond, type FakeChild } from './fakes.ts';

const V1_HELP = `Usage: gpiomon [OPTIONS] <chip name/number> <offset 1> <offset 2> ...
Wait for events on GPIO lines and print them to standard output

Options:
  -h, --help:		display this message and exit
  -v, --version:	display the version and exit
  -l, --active-low:	set the line active state to low
  -B, --bias=[as-is|disable|pull-down|pull-up] (defaults to 'as-is'):
		set the line bias
  -n, --num-events=NUM:	exit after processing NUM events
  -s, --silent:		don't print event info
  -r, --rising-edge:	only process rising edge events
  -f, --falling-edge:	only process falling edge events
  -b, --line-buffered:	set standard output as line buffered
  -F, --format=FMT	specify custom output format
`;
const V1_OLD_HELP = `Usage: gpiomon [OPTIONS] <chip name/number> <offset 1> <offset 2> ...
Options:
  -l, --active-low:	set the line active state to low
  -F, --format=FMT	specify custom output format
`;
const V2_HELP = `Usage: gpiomon [OPTIONS] <line>...

Wait for events on GPIO lines and print them to standard output.

Options:
  -b, --bias <bias>	specify the line bias
  -c, --chip <chip>	restrict scope to a particular chip
  -e, --edges <edges>	specify the edges to monitor
  -F, --format <fmt>	specify a custom output format
`;
const PI4_GPIODETECT = `gpiochip0 [pinctrl-bcm2711] (58 lines)
gpiochip1 [raspberrypi-exp-gpio] (8 lines)
`;
const PI5_EARLY_GPIODETECT = `gpiochip0 [gpio-brcmstb@107d508500] (32 lines)
gpiochip1 [gpio-brcmstb@107d508520] (4 lines)
gpiochip2 [gpio-brcmstb@107d517c00] (17 lines)
gpiochip3 [gpio-brcmstb@107d517c20] (6 lines)
gpiochip4 [pinctrl-rp1] (54 lines)
`;

describe('gpiomon helpers', () => {
  it('parses --version output of both major versions', () => {
    expect(parseGpiomonVersion('gpiomon (libgpiod) v1.6.3\nCopyright (C) 2017-2018')).toEqual({
      major: 1,
      version: '1.6.3',
    });
    expect(parseGpiomonVersion('gpiomon (libgpiod) v2.1\n')).toEqual({ major: 2, version: '2.1' });
    expect(parseGpiomonVersion('garbage')).toBeNull();
  });

  it('detects features from --help', () => {
    expect(detectGpiomonFeatures('gpiomon (libgpiod) v1.6.3', V1_HELP)).toEqual({
      major: 1,
      version: '1.6.3',
      bias: true,
      lineBuffered: true,
      format: true,
    });
    expect(detectGpiomonFeatures('gpiomon (libgpiod) v1.2.1', V1_OLD_HELP)).toMatchObject({
      major: 1,
      bias: false,
      lineBuffered: false,
      format: true,
    });
    expect(detectGpiomonFeatures('gpiomon (libgpiod) v2.1.3', V2_HELP)).toMatchObject({
      major: 2,
      bias: true,
      lineBuffered: false,
    });
    // Unparseable version: the help text decides; no help: assume a current release.
    expect(detectGpiomonFeatures('', V2_HELP).major).toBe(2);
    expect(detectGpiomonFeatures('gpiomon v1.6.2', null)).toMatchObject({
      major: 1,
      bias: true,
      lineBuffered: true,
    });
  });

  it('builds the v1 and v2 command lines', () => {
    const v1: GpiomonFeatures = {
      major: 1,
      version: '1.6.3',
      bias: true,
      lineBuffered: true,
      format: true,
    };
    expect(
      buildGpiomonArgs({ features: v1, chip: 'gpiochip0', offsets: [17, 27], pullUp: true }),
    ).toEqual(['--bias=pull-up', '--line-buffered', '--format=%o %e', 'gpiochip0', '17', '27']);
    const v2: GpiomonFeatures = {
      major: 2,
      version: '2.1.3',
      bias: true,
      lineBuffered: false,
      format: true,
    };
    expect(
      buildGpiomonArgs({ features: v2, chip: 'gpiochip4', offsets: [5], pullUp: true }),
    ).toEqual([
      '--chip=gpiochip4',
      '--consumer=carheadsup',
      '--bias=pull-up',
      '--format=%o %E',
      '5',
    ]);
    expect(
      buildGpiomonArgs({
        features: { ...v1, bias: false },
        chip: 'gpiochip0',
        offsets: [17],
        pullUp: true,
      }),
    ).not.toContain('--bias=pull-up');
  });

  it('parses our formats and both default formats', () => {
    expect(parseGpiomonLine('17 0')).toEqual({ offset: 17, edge: 'falling' });
    expect(parseGpiomonLine('17 1')).toEqual({ offset: 17, edge: 'rising' });
    expect(parseGpiomonLine('22 2')).toEqual({ offset: 22, edge: 'falling' }); // v2 %e
    expect(parseGpiomonLine('27 rising')).toEqual({ offset: 27, edge: 'rising' });
    expect(parseGpiomonLine('  27 falling\r')).toEqual({ offset: 27, edge: 'falling' });
    expect(
      parseGpiomonLine('event:  RISING EDGE offset: 17 timestamp: [1603206532.487346353]'),
    ).toEqual({
      offset: 17,
      edge: 'rising',
    });
    expect(
      parseGpiomonLine('event: FALLING EDGE offset: 5 timestamp: [     173.574306530]'),
    ).toEqual({
      offset: 5,
      edge: 'falling',
    });
    expect(parseGpiomonLine('1675271826.573214584\tfalling\tgpiochip0 17')).toEqual({
      offset: 17,
      edge: 'falling',
    });
    for (const junk of ['', 'hello', '17', '17 3', 'x 1', 'gpiomon: error']) {
      expect(parseGpiomonLine(junk)).toBeNull();
    }
  });

  it('finds the header chip by label (Pi 4, early Pi 5, Pi 3, unknown boards)', () => {
    expect(parseGpiodetect(PI4_GPIODETECT)).toEqual([
      { chip: 'gpiochip0', label: 'pinctrl-bcm2711' },
      { chip: 'gpiochip1', label: 'raspberrypi-exp-gpio' },
    ]);
    expect(pickHeaderChip(parseGpiodetect(PI4_GPIODETECT))).toBe('gpiochip0');
    expect(pickHeaderChip(parseGpiodetect(PI5_EARLY_GPIODETECT))).toBe('gpiochip4');
    expect(
      pickHeaderChip(
        parseGpiodetect(
          'gpiochip0 [pinctrl-rp1] (54 lines)\ngpiochip10 [gpio-brcmstb@107d508500] (32 lines)',
        ),
      ),
    ).toBe('gpiochip0');
    expect(pickHeaderChip(parseGpiodetect('gpiochip0 [pinctrl-bcm2835] (54 lines)'))).toBe(
      'gpiochip0',
    );
    expect(pickHeaderChip(parseGpiodetect('gpiochip0 [1f000d0000.gpio] (32 lines)'))).toBeNull();
  });

  it('maps device-tree compatibles to pinctrl labels', () => {
    expect(labelForCompatible('raspberrypi,rp1-gpio\0')).toBe('pinctrl-rp1');
    expect(labelForCompatible('brcm,bcm2711-gpio\0brcm,bcm2835-gpio\0')).toBe('pinctrl-bcm2711');
    expect(labelForCompatible('brcm,bcm2835-gpio')).toBe('pinctrl-bcm2835');
    expect(labelForCompatible('vendor,other-gpio')).toBeNull();
  });

  it('classifies gpiomon failures', () => {
    expect(classifyGpiomonError(["gpiomon: unrecognized option '--bias=pull-up'"]).kind).toBe(
      'no-bias',
    );
    expect(
      classifyGpiomonError(['gpiomon: error waiting for events: bias not supported']).kind,
    ).toBe('no-bias');
    expect(
      classifyGpiomonError(['gpiomon: error requesting GPIO lines: Device or resource busy']).kind,
    ).toBe('busy');
    expect(
      classifyGpiomonError(['gpiomon: unable to open chip gpiochip0: Permission denied']).kind,
    ).toBe('permission');
    expect(classifyGpiomonError([]).kind).toBe('other');
  });
});

/** In-memory sysfs: `links` resolve paths, `files` and `dirs` hold contents. */
function fakeSysfs(
  links: Record<string, string>,
  dirs: Record<string, string[]>,
  files: Record<string, string>,
): SysFs {
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
  return {
    readdir: async (path) => {
      const entries = dirs[path];
      if (entries === undefined) throw missing(path);
      return entries;
    },
    readFile: async (path) => {
      const content = files[path];
      if (content === undefined) throw missing(path);
      return content;
    },
    realpath: async (path) => {
      const target = links[path];
      if (target === undefined) throw missing(path);
      return target;
    },
  };
}

const PI5_SYSFS = fakeSysfs(
  {
    '/sys/bus/gpio/devices/gpiochip0': '/sys/devices/platform/soc/107d508500.gpio/gpiochip0',
    '/sys/bus/gpio/devices/gpiochip4':
      '/sys/devices/platform/axi/1000120000.pcie/1f000d0000.gpio/gpiochip4',
  },
  {
    '/sys/bus/gpio/devices': ['gpiochip4', 'gpiochip0'],
    '/sys/devices/platform/soc/107d508500.gpio/gpio': ['gpiochip512'],
    // The RP1 controller exposes no legacy directory here: its device-tree node identifies it.
  },
  {
    '/sys/devices/platform/soc/107d508500.gpio/gpio/gpiochip512/label': 'gpio-brcmstb@107d508500\n',
    '/sys/devices/platform/axi/1000120000.pcie/1f000d0000.gpio/of_node/compatible':
      'raspberrypi,rp1-gpio\0',
  },
);

describe('header chip detection', () => {
  it('reads labels from sysfs (legacy label or device-tree compatible)', async () => {
    expect(await listChipsFromSysfs(PI5_SYSFS)).toEqual([
      { chip: 'gpiochip0', label: 'gpio-brcmstb@107d508500' },
      { chip: 'gpiochip4', label: 'pinctrl-rp1' },
    ]);
    expect(await listChipsFromSysfs(fakeSysfs({}, {}, {}))).toEqual([]);
  });

  it('prefers gpiodetect, then sysfs, then gpiochip0', async () => {
    const clock = new FakeClock();
    const withGpiodetect = fakeSpawn((child) => respond(child, PI5_EARLY_GPIODETECT));
    expect(
      await detectHeaderChip({ spawn: withGpiodetect, timers: clock, fs: fakeSysfs({}, {}, {}) }),
    ).toEqual({
      chip: 'gpiochip4',
      source: 'gpiodetect',
      label: 'pinctrl-rp1',
    });
    const noGpiodetect = fakeSpawn((child) => child.failToStart());
    expect(await detectHeaderChip({ spawn: noGpiodetect, timers: clock, fs: PI5_SYSFS })).toEqual({
      chip: 'gpiochip4',
      source: 'sysfs',
      label: 'pinctrl-rp1',
    });
    expect(
      await detectHeaderChip({ spawn: noGpiodetect, timers: clock, fs: fakeSysfs({}, {}, {}) }),
    ).toEqual({
      chip: 'gpiochip0',
      source: 'default',
      label: null,
    });
  });
});

describe('ButtonDebouncer', () => {
  function setup() {
    const clock = new FakeClock(0);
    const actions: Array<{ action: InputAction; at: number }> = [];
    const debouncer = new ButtonDebouncer({
      timers: clock,
      onAction: (action) => actions.push({ action, at: clock.now() }),
    });
    return { clock, actions, debouncer };
  }

  it('acts on secondary and next as soon as the press is stable', async () => {
    const { clock, actions, debouncer } = setup();
    debouncer.edge('secondary', true);
    await clock.advance(29);
    expect(actions).toEqual([]);
    await clock.advance(1);
    expect(actions).toEqual([{ action: 'secondary', at: 30 }]);
    debouncer.edge('secondary', false);
    debouncer.edge('next', true);
    await clock.advance(100);
    debouncer.edge('next', false);
    await clock.advance(100);
    expect(actions.map((a) => a.action)).toEqual(['secondary', 'next-page']);
  });

  it('filters contact bounce', async () => {
    const { clock, actions, debouncer } = setup();
    // Bouncy press: 5 transitions within 12 ms, then stable low.
    for (const level of [true, false, true, false, true]) {
      debouncer.edge('next', level);
      await clock.advance(3);
    }
    await clock.advance(50);
    // Bouncy release.
    for (const level of [false, true, false]) {
      debouncer.edge('next', level);
      await clock.advance(4);
    }
    await clock.advance(50);
    expect(actions.map((a) => a.action)).toEqual(['next-page']);
    // A glitch shorter than the debounce time is ignored entirely.
    debouncer.edge('next', true);
    await clock.advance(10);
    debouncer.edge('next', false);
    await clock.advance(100);
    expect(actions.map((a) => a.action)).toEqual(['next-page']);
  });

  it('short primary press acts on release; a long press blanks while still held', async () => {
    const { clock, actions, debouncer } = setup();
    debouncer.edge('primary', true);
    await clock.advance(300);
    expect(actions).toEqual([]);
    debouncer.edge('primary', false);
    await clock.advance(30);
    expect(actions).toEqual([{ action: 'primary', at: 330 }]);

    debouncer.edge('primary', true);
    await clock.advance(30 + 800);
    expect(actions.at(-1)).toEqual({ action: 'toggle-blank', at: clock.now() });
    expect(debouncer.isPressed('primary')).toBe(true);
    await clock.advance(2000);
    debouncer.edge('primary', false);
    await clock.advance(100);
    expect(actions.map((a) => a.action)).toEqual(['primary', 'toggle-blank']); // release swallowed
  });

  it('ignores a release without a press (button held at start-up) and reset() cancels timers', async () => {
    const { clock, actions, debouncer } = setup();
    debouncer.edge('primary', false);
    await clock.advance(100);
    expect(actions).toEqual([]);
    debouncer.edge('primary', true);
    await clock.advance(40);
    debouncer.reset();
    expect(clock.pendingTimers).toBe(0);
    await clock.advance(2000);
    expect(actions).toEqual([]);
  });
});

describe('buttonLineMap', () => {
  it('maps configured lines to roles and reports duplicates', () => {
    const dupes: Array<[number, string]> = [];
    const map = buttonLineMap({ primary: 17, secondary: 27, next: 17 }, (o, r) =>
      dupes.push([o, r]),
    );
    expect([...map]).toEqual([
      [17, 'primary'],
      [27, 'secondary'],
    ]);
    expect(dupes).toEqual([[17, 'next']]);
    expect(buttonLineMap({ primary: null, secondary: null, next: null }).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The source against a fake gpiomon

function buttonsConfig(buttons: HudConfig['sensors']['buttons']): HudConfig {
  const config = structuredClone(DEFAULT_CONFIG) as HudConfig;
  config.sensors = { ...config.sensors, buttons };
  return config;
}

interface ToolBehaviour {
  version?: string | null;
  help?: string;
  gpiodetect?: string | null;
  /** Called for each started gpiomon monitor. */
  monitor?: (child: FakeChild) => void;
}

/** A fake system with libgpiod tools. `version: null` = gpiomon not installed. */
function gpioSystem(behaviour: ToolBehaviour) {
  const monitors: FakeChild[] = [];
  const spawn = fakeSpawn((child) => {
    const tool = child.command === 'stdbuf' ? child.args[1] : child.command;
    if (tool === 'gpiomon' && behaviour.version === null) return child.failToStart();
    if (tool === 'gpiodetect') {
      if (behaviour.gpiodetect === null) return child.failToStart();
      return respond(child, behaviour.gpiodetect ?? PI4_GPIODETECT);
    }
    if (child.args.includes('--version'))
      return respond(child, behaviour.version ?? 'gpiomon (libgpiod) v1.6.3\n');
    if (child.args.includes('--help')) return respond(child, behaviour.help ?? V1_HELP);
    monitors.push(child);
    behaviour.monitor?.(child);
  });
  return { spawn, monitors };
}

describe('GpioButtonSource', () => {
  it('runs gpiomon on the header chip and turns edges into inputs', async () => {
    const clock = new FakeClock();
    const system = gpioSystem({});
    const src = new GpioButtonSource(buttonsConfig({ primary: 17, secondary: 27, next: 22 }), {
      spawn: system.spawn,
      fs: fakeSysfs({}, {}, {}),
    });
    const { ctx, ofType, logger } = recordingContext(clock);
    await src.start(ctx);
    await src.whenReady();
    await clock.advance(10);
    const [monitor] = system.monitors;
    expect(monitor?.command).toBe('gpiomon');
    expect(monitor?.args).toEqual([
      '--bias=pull-up',
      '--line-buffered',
      '--format=%o %e',
      'gpiochip0',
      '17',
      '27',
      '22',
    ]);
    expect(logger.lines('info').join('\n')).toMatch(
      /watching GPIO17, GPIO27, GPIO22 on gpiochip0 \(pinctrl-bcm2711\)/,
    );

    monitor!.print('27 0'); // secondary pressed
    await clock.advance(50);
    monitor!.print('27 1', '22 0');
    await clock.advance(50);
    monitor!.print('22 1', '17 0');
    await clock.advance(100);
    monitor!.print('17 1');
    await clock.advance(50);
    monitor!.print('5 0', 'nonsense'); // unknown line and junk are ignored
    await clock.advance(50);
    expect(ofType('input').map((e) => e.action)).toEqual(['secondary', 'next-page', 'primary']);

    await src.stop();
    expect(monitor!.signals).toEqual(['SIGTERM']);
    expect(clock.pendingTimers).toBe(0);
  });

  it('uses the v2 syntax and the RP1 chip on a Pi 5', async () => {
    const clock = new FakeClock();
    const system = gpioSystem({
      version: 'gpiomon (libgpiod) v2.1.3\n',
      help: V2_HELP,
      gpiodetect: PI5_EARLY_GPIODETECT,
    });
    const src = new GpioButtonSource(buttonsConfig({ primary: 17, secondary: null, next: null }), {
      spawn: system.spawn,
      fs: fakeSysfs({}, {}, {}),
    });
    const { ctx, ofType } = recordingContext(clock);
    await src.start(ctx);
    await src.whenReady();
    await clock.advance(10);
    expect(system.monitors[0]?.args).toEqual([
      '--chip=gpiochip4',
      '--consumer=carheadsup',
      '--bias=pull-up',
      '--format=%o %E',
      '17',
    ]);
    system.monitors[0]!.print('17 falling');
    await clock.advance(1000); // long press
    system.monitors[0]!.print('17 rising');
    await clock.advance(100);
    expect(ofType('input').map((e) => e.action)).toEqual(['toggle-blank']);
    await src.stop();
  });

  it('wraps old gpiomon in stdbuf and warns that pull-ups must be external', async () => {
    const clock = new FakeClock();
    const system = gpioSystem({ version: 'gpiomon (libgpiod) v1.2\n', help: V1_OLD_HELP });
    const src = new GpioButtonSource(buttonsConfig({ primary: 17, secondary: null, next: null }), {
      spawn: system.spawn,
      fs: fakeSysfs({}, {}, {}),
    });
    const { ctx, logger } = recordingContext(clock);
    await src.start(ctx);
    await src.whenReady();
    await clock.advance(10);
    expect(system.monitors[0]?.command).toBe('stdbuf');
    expect(system.monitors[0]?.args).toEqual([
      '-oL',
      'gpiomon',
      '--format=%o %e',
      'gpiochip0',
      '17',
    ]);
    expect(logger.lines('warn').join('\n')).toMatch(/cannot enable pull-ups/);
    await src.stop();
  });

  it('logs an install hint once and stays idle without libgpiod tools', async () => {
    const clock = new FakeClock();
    const system = gpioSystem({ version: null });
    const src = new GpioButtonSource(buttonsConfig({ primary: 17, secondary: null, next: null }), {
      spawn: system.spawn,
      fs: fakeSysfs({}, {}, {}),
    });
    const { ctx, logger } = recordingContext(clock);
    await src.start(ctx);
    await src.whenReady();
    await clock.advance(60_000);
    expect(logger.lines('warn')).toEqual([
      expect.stringMatching(/install libgpiod tools .*sudo apt install gpiod/),
    ]);
    expect(system.monitors).toEqual([]);
    expect(clock.pendingTimers).toBe(0);
    await src.stop();
  });

  it('does nothing without configured buttons', async () => {
    const clock = new FakeClock();
    const system = gpioSystem({});
    const src = new GpioButtonSource(
      buttonsConfig({ primary: null, secondary: null, next: null }),
      {
        spawn: system.spawn,
        fs: fakeSysfs({}, {}, {}),
      },
    );
    const { ctx } = recordingContext(clock);
    await src.start(ctx);
    await src.whenReady();
    expect(system.spawn.children).toEqual([]);
    await src.stop();
  });

  it('restarts gpiomon with backoff, dropping --bias when the kernel rejects it', async () => {
    const clock = new FakeClock();
    let runs = 0;
    const system = gpioSystem({
      monitor: (child) => {
        runs += 1;
        if (runs <= 2) {
          child.printErr('gpiomon: error requesting GPIO lines: bias not supported');
          child.exit(1);
        }
      },
    });
    const src = new GpioButtonSource(buttonsConfig({ primary: null, secondary: 27, next: null }), {
      spawn: system.spawn,
      fs: fakeSysfs({}, {}, {}),
    });
    const { ctx, logger, ofType } = recordingContext(clock);
    await src.start(ctx);
    await src.whenReady();
    await clock.advance(10);
    expect(system.monitors).toHaveLength(1);
    await clock.advance(1000); // first restart after 1 s
    expect(system.monitors).toHaveLength(2);
    expect(system.monitors[1]!.args).not.toContain('--bias=pull-up');
    await clock.advance(2000); // then 2 s
    expect(system.monitors).toHaveLength(3);
    expect(logger.lines('warn').filter((l) => /pull-ups/.test(l))).toHaveLength(1);
    system.monitors[2]!.print('27 0');
    await clock.advance(50);
    expect(ofType('input').map((e) => e.action)).toEqual(['secondary']);
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('restarts only when the button lines change', async () => {
    const clock = new FakeClock();
    const system = gpioSystem({});
    const config = buttonsConfig({ primary: 17, secondary: null, next: null });
    const src = new GpioButtonSource(config, { spawn: system.spawn, fs: fakeSysfs({}, {}, {}) });
    const { ctx } = recordingContext(clock);
    await src.start(ctx);
    await src.whenReady();
    await clock.advance(10);
    const other = structuredClone(config);
    other.sensors.lightSensorGain = 3;
    await src.updateConfig(other);
    await src.whenReady();
    await clock.advance(10);
    expect(system.monitors).toHaveLength(1);
    await src.updateConfig(buttonsConfig({ primary: 17, secondary: 6, next: null }));
    await src.whenReady();
    await clock.advance(10);
    expect(system.monitors).toHaveLength(2);
    expect(system.monitors[0]!.exited).toBe(true);
    expect(system.monitors[1]!.args.slice(-2)).toEqual(['17', '6']);
    await src.updateConfig(buttonsConfig({ primary: null, secondary: null, next: null }));
    await src.whenReady();
    expect(system.monitors[1]!.exited).toBe(true);
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('stopping while still probing never starts gpiomon', async () => {
    const clock = new FakeClock();
    const system = gpioSystem({});
    const src = new GpioButtonSource(buttonsConfig({ primary: 17, secondary: null, next: null }), {
      spawn: system.spawn,
      fs: fakeSysfs({}, {}, {}),
    });
    const { ctx } = recordingContext(clock);
    await src.start(ctx);
    await src.stop();
    await clock.advance(1000);
    expect(system.monitors).toEqual([]);
  });
});
