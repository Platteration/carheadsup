import { DEFAULT_CONFIG, type CanButtonRule, type HudConfig } from '@carheadsup/core';
import { describe, expect, it } from 'vitest';
import {
  buildCandumpArgs,
  candumpFilter,
  classifyCandumpError,
  parseCandumpLine,
  parseIpLinkDetails,
} from '../../src/sensors/can/candump.ts';
import {
  CanButtonEngine,
  canRuleIds,
  compileCanRules,
  ruleMatches,
  type CompiledCanRule,
} from '../../src/sensors/can/rules.ts';
import { CanButtonSource } from '../../src/sensors/can/source.ts';
import { FakeClock, fakeSpawn, recordingContext, respond, type FakeChild } from './fakes.ts';

const rule = (overrides: Partial<CanButtonRule> = {}): CanButtonRule => ({
  id: '5C1',
  byte: 0,
  mask: 'FF',
  value: '01',
  action: 'next-page',
  longPressAction: null,
  ...overrides,
});

// ---------------------------------------------------------------------------------------------
// candump and ip output

describe('parseCandumpLine', () => {
  it('parses classic frames with 11-bit and 29-bit ids', () => {
    expect(parseCandumpLine('(1690000000.123456) can0 5C1#0100000000000000')).toEqual({
      iface: 'can0',
      timestamp: 1690000000.123456,
      id: 0x5c1,
      extended: false,
      fd: false,
      remote: false,
      data: [1, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(parseCandumpLine('(1690000000.000001) can1 18FF1234#0A1b')).toMatchObject({
      iface: 'can1',
      id: 0x18ff1234,
      extended: true,
      data: [0x0a, 0x1b],
    });
    // An 8-digit id below 0x800 is still an extended frame.
    expect(parseCandumpLine('(1.0) can0 000005C1#01')).toMatchObject({ id: 0x5c1, extended: true });
    expect(parseCandumpLine('(1.0) can0 123#')).toMatchObject({ id: 0x123, data: [] });
  });

  it('parses CAN FD frames ("##", a flags nibble, up to 64 bytes)', () => {
    const data = '00'.repeat(20) + 'AB' + '00'.repeat(43);
    expect(parseCandumpLine(`(1690000000.5) can0 5C1##1${data}`)).toMatchObject({
      id: 0x5c1,
      extended: false,
      fd: true,
      remote: false,
    });
    expect(parseCandumpLine(`(1690000000.5) can0 5C1##1${data}`)?.data[20]).toBe(0xab);
    expect(parseCandumpLine('(1690000000.5) can0 18DAF110##4112233')).toMatchObject({
      id: 0x18daf110,
      extended: true,
      fd: true,
      data: [0x11, 0x22, 0x33],
    });
  });

  it('parses remote requests, raw DLCs and trailing direction markers', () => {
    expect(parseCandumpLine('(1.5) can0 5C1#R')).toMatchObject({ remote: true, data: [] });
    expect(parseCandumpLine('(1.5) can0 5C1#R3')).toMatchObject({ remote: true, data: [] });
    expect(parseCandumpLine('(1.5) can0 5C1#1122334455667788_E')?.data).toHaveLength(8);
    expect(parseCandumpLine('(1.5)  can0 5C1#01 R')).toMatchObject({ id: 0x5c1, data: [1] });
    expect(parseCandumpLine('  (1.5) can0 5C1#01\r')).toMatchObject({ id: 0x5c1 });
  });

  it('rejects error frames, CAN XL, bad ids and malformed payloads', () => {
    for (const line of [
      '(1.5) can0 20000080#0000000000000000', // CAN_ERR_FLAG
      '(1.5) can0 800#01', // not an 11-bit id
      '(1.5) can0 5C12#01', // 4 digits
      '(1.5) can0 5C1#012', // odd number of digits
      '(1.5) can0 5C1#010203040506070809', // 9 bytes in a classic frame
      `(1.5) can0 5C1##1${'00'.repeat(65)}`, // 65 bytes
      '(1.5) can0 5C1###80:00:00000000#11', // CAN XL
      'can0  5C1   [8]  01 00 00 00 00 00 00 00', // default (non-log) format
      'interface = can0, family = 29, type = 3, proto = 1',
      '',
    ]) {
      expect(parseCandumpLine(line), line).toBeNull();
    }
  });
});

describe('candump arguments', () => {
  it('builds kernel filters that pass only data frames of the right format', () => {
    expect(candumpFilter({ id: 0x5c1, extended: false })).toBe('5C1:C00007FF');
    expect(candumpFilter({ id: 0x21, extended: false })).toBe('021:C00007FF');
    // 8 digits make candump set CAN_EFF_FLAG on the filter id.
    expect(candumpFilter({ id: 0x18ff1234, extended: true })).toBe('18FF1234:DFFFFFFF');
    expect(
      buildCandumpArgs('can0', [
        { id: 0x5c1, extended: false },
        { id: 0x5c1, extended: true },
        { id: 0x5c1, extended: false },
      ]),
    ).toEqual(['-L', 'can0,5C1:C00007FF,000005C1:DFFFFFFF']);
  });

  it('classifies candump failures', () => {
    expect(classifyCandumpError(['SIOCGIFINDEX: No such device'], 'can0').kind).toBe('no-device');
    expect(classifyCandumpError(['read: Network is down'], 'can0')).toEqual({
      kind: 'down',
      hint: expect.stringContaining(
        'sudo ip link set can0 up type can bitrate 500000 listen-only on',
      ),
    });
    expect(
      classifyCandumpError(['socket: Address family not supported by protocol'], 'can0'),
    ).toMatchObject({ kind: 'no-can-support', hint: expect.stringContaining('AF_CAN') });
    expect(classifyCandumpError(['bind: Permission denied'], 'can0').kind).toBe('permission');
    expect(classifyCandumpError(['something else'], 'can0')).toEqual({ kind: 'other', hint: null });
  });
});

const IP_LISTEN_ONLY = `3: can0: <NOARP,UP,LOWER_UP,ECHO> mtu 16 qdisc pfifo_fast state UP mode DEFAULT group default qlen 10
    link/can  promiscuity 0 allmulti 0 minmtu 0 maxmtu 0
    can <LISTEN-ONLY> state ERROR-ACTIVE restart-ms 0
	  bitrate 500000 sample-point 0.875
	  tq 125 prop-seg 6 phase-seg1 7 phase-seg2 2 sjw 1 brp 1
	  mcp251x: tseg1 3..16 tseg2 2..8 sjw 1..4 brp 1..64 brp-inc 1
	  clock 8000000 numtxqueues 1 numrxqueues 1 gso_max_size 65536 gso_max_segs 65535 parentbus spi parentdev spi0.0
`;
const IP_NORMAL = `3: can0: <NOARP,UP,LOWER_UP,ECHO> mtu 16 qdisc pfifo_fast state UP mode DEFAULT group default qlen 10
    link/can  promiscuity 0 minmtu 0 maxmtu 0
    can <TRIPLE-SAMPLING> state ERROR-ACTIVE (berr-counter tx 0 rx 0) restart-ms 100
	  bitrate 125000 sample-point 0.875
`;
const IP_DOWN = `3: can0: <NOARP,ECHO> mtu 16 qdisc noop state DOWN mode DEFAULT group default qlen 10
    link/can  promiscuity 0 minmtu 0 maxmtu 0
    can state STOPPED restart-ms 0
	  mcp251x: tseg1 3..16 tseg2 2..8 sjw 1..4 brp 1..64 brp-inc 1
`;
const IP_VCAN = `5: vcan0: <NOARP,UP,LOWER_UP> mtu 72 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/can  promiscuity 0 minmtu 0 maxmtu 0
    vcan numtxqueues 1 numrxqueues 1 gso_max_size 65536 gso_max_segs 65535
`;
const IP_SLCAN = `7: slcan0: <NOARP,UP,LOWER_UP> mtu 16 qdisc pfifo_fast state UNKNOWN mode DEFAULT group default qlen 10
    link/can  promiscuity 0 minmtu 0 maxmtu 0 numtxqueues 1
`;
const IP_ETH = `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT group default qlen 1000
    link/ether dc:a6:32:00:00:01 brd ff:ff:ff:ff:ff:ff promiscuity 0
`;

describe('parseIpLinkDetails', () => {
  it('reads listen-only mode, state and bitrate of a CAN controller', () => {
    expect(parseIpLinkDetails(IP_LISTEN_ONLY)).toEqual({
      up: true,
      kind: 'can',
      listenOnly: true,
      state: 'ERROR-ACTIVE',
      bitrate: 500000,
    });
    expect(parseIpLinkDetails(IP_NORMAL)).toEqual({
      up: true,
      kind: 'can',
      listenOnly: false,
      state: 'ERROR-ACTIVE',
      bitrate: 125000,
    });
    expect(parseIpLinkDetails(IP_DOWN)).toEqual({
      up: false,
      kind: 'can',
      listenOnly: false,
      state: 'STOPPED',
      bitrate: null,
    });
    expect(
      parseIpLinkDetails(IP_LISTEN_ONLY.replace('<LISTEN-ONLY>', '<LOOPBACK,LISTEN-ONLY,FD>')),
    ).toMatchObject({ listenOnly: true });
  });

  it('tells virtual, other CAN and non-CAN links apart', () => {
    expect(parseIpLinkDetails(IP_VCAN)).toMatchObject({
      up: true,
      kind: 'virtual',
      listenOnly: null,
    });
    expect(parseIpLinkDetails(IP_SLCAN)).toMatchObject({ kind: 'can-unknown', listenOnly: null });
    expect(parseIpLinkDetails(IP_ETH)).toMatchObject({ kind: 'other' });
    expect(parseIpLinkDetails('Device "can9" does not exist.')).toBeNull();
    expect(parseIpLinkDetails('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Rules and the engine

const frame = (id: number, data: number[], extended = false) => ({
  id,
  extended,
  remote: false,
  data,
});

describe('compileCanRules', () => {
  it('turns the configured hex strings into numbers and labels', () => {
    const [compiled] = compileCanRules([rule({ id: '5c1', byte: 2, mask: '0f', value: '0a' })]);
    expect(compiled).toEqual({
      index: 0,
      id: 0x5c1,
      extended: false,
      byte: 2,
      mask: 0x0f,
      value: 0x0a,
      action: 'next-page',
      longPressAction: null,
      label: '5C1 byte 2 & 0F = 0A',
    });
  });

  it('skips and reports rules that cannot match', () => {
    const problems: string[] = [];
    const compiled = compileCanRules(
      [
        rule({ id: '800' }),
        rule({ mask: '00' }),
        rule({ mask: '0F', value: 'F0' }),
        rule({ byte: 64 }),
        rule(),
      ],
      (index, reason) => problems.push(`${index}: ${reason}`),
    );
    expect(compiled.map((r) => r.index)).toEqual([4]);
    expect(problems).toEqual([
      '0: bad CAN id "800"',
      '1: bad mask/value "00"/"01"',
      '2: bad mask/value "0F"/"F0"',
      '3: bad byte index 64',
    ]);
  });

  it('lists each id once, keeping 11-bit and 29-bit ids apart', () => {
    const rules = compileCanRules([
      rule(),
      rule({ value: '02' }),
      rule({ id: '000005C1' }),
      rule({ id: '3E0' }),
    ]);
    expect(canRuleIds(rules)).toEqual([
      { id: 0x5c1, extended: false },
      { id: 0x5c1, extended: true },
      { id: 0x3e0, extended: false },
    ]);
  });

  it('matches only frames of its own id and format that are long enough', () => {
    const [r] = compileCanRules([rule({ byte: 1, mask: '0F', value: '01' })]) as [CompiledCanRule];
    expect(ruleMatches(r, frame(0x5c1, [0xff, 0xf1]))).toBe(true);
    expect(ruleMatches(r, frame(0x5c1, [0x00, 0x02]))).toBe(false);
    expect(ruleMatches(r, frame(0x5c1, [0x01]))).toBeNull(); // too short
    expect(ruleMatches(r, frame(0x5c2, [0x00, 0x01]))).toBeNull();
    expect(ruleMatches(r, frame(0x5c1, [0x00, 0x01], true))).toBeNull();
    expect(ruleMatches(r, { ...frame(0x5c1, []), remote: true })).toBeNull();
  });
});

/** Drive an engine with frames at given times; returns the actions with their times. */
function run(
  rules: CanButtonRule[],
  steps: Array<[at: number, data: number[] | 'tick', id?: number]>,
  options: { releaseTimeoutMs?: number | null; debounceMs?: number } = {},
) {
  const engine = new CanButtonEngine(compileCanRules(rules), {
    releaseTimeoutMs: options.releaseTimeoutMs === undefined ? 500 : options.releaseTimeoutMs,
    debounceMs: options.debounceMs,
  });
  const out: string[] = [];
  for (const [at, data, id] of steps) {
    const actions = data === 'tick' ? engine.tick(at) : engine.frame(frame(id ?? 0x5c1, data), at);
    out.push(...actions.map((a) => `${a.at} ${a.kind} ${a.action}`));
  }
  return { out, engine };
}

/** A frame every `period` ms from `from` to `to` (inclusive) with `data`. */
function cyclic(from: number, to: number, period: number, data: number[]) {
  const steps: Array<[number, number[]]> = [];
  for (let at = from; at <= to; at += period) steps.push([at, data]);
  return steps;
}

describe('CanButtonEngine', () => {
  it('acts once per press while the frame repeats with the button held', () => {
    const { out } = run(
      [rule()],
      [
        ...cyclic(0, 200, 100, [0x00]),
        ...cyclic(300, 1500, 100, [0x01]), // held 1.2 s, repeated in 13 frames
        ...cyclic(1600, 1800, 100, [0x00]),
        ...cyclic(1900, 2000, 100, [0x01]),
        [2100, 'tick'],
      ],
    );
    expect(out).toEqual(['330 press next-page', '1930 press next-page']);
  });

  it('releases on another value, on another button of the same byte, or when frames stop', () => {
    const rules = [rule(), rule({ value: '02', action: 'prev-page' })];
    const { out, engine } = run(rules, [
      [0, [0x01]],
      [100, [0x02]], // straight from one button to the other
      [150, 'tick'],
      [200, [0x00]],
      [300, [0x01]],
      [400, 'tick'],
    ]);
    expect(out).toEqual(['30 press next-page', '130 press prev-page', '330 press next-page']);
    expect(engine.isPressed(0)).toBe(true);
    // No frame for 500 ms: released (and pressed again by the next frame).
    expect(engine.nextDeadline()).toBe(800);
    expect(engine.tick(800)).toEqual([]);
    expect(engine.nextDeadline()).toBe(830);
    engine.tick(830);
    expect(engine.isPressed(0)).toBe(false);
    expect(engine.nextDeadline()).toBeNull();
    expect(engine.frame(frame(0x5c1, [0x01]), 900)).toEqual([]);
    expect(engine.tick(930).map((a) => a.action)).toEqual(['next-page']);
  });

  it('keeps a button held without frames when the timeout is off (change-only cars)', () => {
    const { out, engine } = run(
      [rule({ longPressAction: 'toggle-blank' })],
      [
        [0, [0x01]],
        [5000, 'tick'],
      ],
      { releaseTimeoutMs: null },
    );
    // Held 5 s with one frame: the long press fired, nothing released it.
    expect(out).toEqual(['830 long-press toggle-blank']);
    expect(engine.isPressed(0)).toBe(true);
    expect(engine.frame(frame(0x5c1, [0x00]), 6000)).toEqual([]);
    expect(engine.tick(6030)).toEqual([]);
    expect(engine.isPressed(0)).toBe(false);
  });

  it('debounces: a level must hold for debounceMs', () => {
    const { out } = run(
      [rule()],
      [
        [0, [0x01]],
        [10, [0x00]], // bounce
        [20, [0x01]],
        [35, [0x00]],
        [100, 'tick'],
        [200, [0x01]],
        [260, [0x01]],
        [300, 'tick'],
      ],
    );
    expect(out).toEqual(['230 press next-page']);
    const immediate = run([rule()], [[0, [0x01]]], { debounceMs: 0 });
    expect(immediate.out).toEqual(['0 press next-page']);
  });

  it('with a long-press action: a short press acts on release, a long one once while held', () => {
    const rules = [rule({ action: 'primary', longPressAction: 'toggle-blank' })];
    const short = run(rules, [...cyclic(0, 400, 100, [0x01]), [500, [0x00]], [600, 'tick']]);
    expect(short.out).toEqual(['530 release primary']);
    const long = run(rules, [...cyclic(0, 2000, 100, [0x01]), [2100, [0x00]], [2200, 'tick']]);
    expect(long.out).toEqual(['830 long-press toggle-blank']);
  });

  it('reads CAN FD bytes beyond 8 and tests only the masked bits', () => {
    const data = new Array<number>(64).fill(0);
    const rules = [rule({ byte: 40, mask: '30', value: '10', action: 'brightness-up' })];
    const engine = new CanButtonEngine(compileCanRules(rules), { releaseTimeoutMs: 500 });
    data[40] = 0xcf; // bits 4–5 = 00: released, whatever the other bits say
    engine.frame(frame(0x5c1, data), 0);
    data[40] = 0xdf; // bits 4–5 = 01: held
    engine.frame(frame(0x5c1, data), 100);
    expect(engine.tick(130).map((a) => a.action)).toEqual(['brightness-up']);
  });

  it('keeps an 11-bit and a 29-bit id with the same number apart', () => {
    const engine = new CanButtonEngine(
      compileCanRules([rule(), rule({ id: '000005C1', action: 'secondary' })]),
      { releaseTimeoutMs: 500, debounceMs: 0 },
    );
    expect(engine.frame(frame(0x5c1, [1], true), 0).map((a) => a.action)).toEqual(['secondary']);
    expect(engine.frame(frame(0x5c1, [1]), 10).map((a) => a.action)).toEqual(['next-page']);
  });

  it('settles what fell due in time order when ticked late, and ignores time going backwards', () => {
    const rules = [rule(), rule({ id: '3E0', action: 'secondary' })];
    const engine = new CanButtonEngine(compileCanRules(rules), { releaseTimeoutMs: 200 });
    engine.frame(frame(0x3e0, [1]), 0);
    engine.frame(frame(0x5c1, [1]), 5);
    // One late tick: both presses, both timeouts; the 3E0 press came first.
    expect(engine.tick(10_000).map((a) => `${a.at} ${a.action}`)).toEqual([
      '30 secondary',
      '35 next-page',
    ]);
    expect(engine.isPressed(0)).toBe(false);
    expect(engine.frame(frame(0x5c1, [1]), 50)).toEqual([]); // clamped to 10 000
    expect(engine.nextDeadline()).toBe(10_030);
  });

  it('reset forgets held buttons and pending deadlines without acting', () => {
    const { engine } = run(
      [rule({ longPressAction: 'toggle-blank' })],
      [
        [0, [1]],
        [100, 'tick'],
      ],
    );
    expect(engine.isPressed(0)).toBe(true);
    engine.reset();
    expect(engine.isPressed(0)).toBe(false);
    expect(engine.nextDeadline()).toBeNull();
    expect(engine.tick(5000)).toEqual([]);
  });

  it('ignores frames of other ids, remote requests and short frames', () => {
    const { out } = run(
      [rule({ byte: 3 })],
      [
        [0, [1, 1, 1, 1], 0x5c2],
        [10, [1, 1, 1]],
        [20, 'tick'],
        [100, 'tick'],
      ],
    );
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The source against fake candump and ip

function canConfig(canButtons: Partial<HudConfig['sensors']['canButtons']>): HudConfig {
  const config = structuredClone(DEFAULT_CONFIG) as HudConfig;
  config.sensors.canButtons = { ...config.sensors.canButtons, ...canButtons };
  return config;
}

interface CanSystem {
  /** `ip -details link show` output; null = ip not installed; 'missing' = no such device. */
  ip?: string | null | 'missing';
  /** candump not installed. */
  noCandump?: boolean;
  monitor?: (child: FakeChild) => void;
}

function canSystem(behaviour: CanSystem = {}) {
  const dumps: FakeChild[] = [];
  const probes: FakeChild[] = [];
  const spawn = fakeSpawn((child) => {
    if (child.command === 'ip') {
      probes.push(child);
      const ip = behaviour.ip === undefined ? IP_LISTEN_ONLY : behaviour.ip;
      if (ip === null) return child.failToStart();
      if (ip === 'missing')
        return respond(child, '', 1, `Device "${child.args[3]}" does not exist.\n`);
      return respond(child, ip);
    }
    if (child.command === 'candump') {
      if (behaviour.noCandump) return child.failToStart();
      dumps.push(child);
      behaviour.monitor?.(child);
    }
  });
  return { spawn, dumps, probes };
}

async function started(config: HudConfig, system: ReturnType<typeof canSystem>, clock: FakeClock) {
  const src = new CanButtonSource(config, { spawn: system.spawn });
  const recording = recordingContext(clock);
  await src.start(recording.ctx);
  await src.whenReady();
  await clock.advance(10);
  return { src, ...recording };
}

const line = (id: string, data: string, t = 1690000000.1) => `(${t.toFixed(6)}) can0 ${id}#${data}`;

describe('CanButtonSource', () => {
  const rules = [
    rule({ id: '5C1', mask: '0F', value: '01', action: 'next-page' }),
    rule({
      id: '5C1',
      mask: '0F',
      value: '02',
      action: 'primary',
      longPressAction: 'toggle-blank',
    }),
    rule({ id: '18FF1234', byte: 2, mask: '80', value: '80', action: 'secondary' }),
  ];

  it('runs candump with filters on a listen-only interface and turns frames into inputs', async () => {
    const clock = new FakeClock();
    const system = canSystem();
    const { src, ofType, logger } = await started(
      canConfig({ interface: 'can0', rules }),
      system,
      clock,
    );
    expect(system.probes[0]?.args).toEqual(['-details', 'link', 'show', 'can0']);
    expect(system.dumps).toHaveLength(1);
    expect(system.dumps[0]!.args).toEqual(['-L', 'can0,5C1:C00007FF,18FF1234:DFFFFFFF']);
    expect(logger.lines('info').join('\n')).toMatch(
      /listening on can0 \(500 kbit\/s\) for 5C1, 18FF1234 with candump \(3 rules; receive only\)/,
    );
    expect(logger.lines('warn')).toEqual([]);

    const dump = system.dumps[0]!;
    // Next page: held for three frames, acts once.
    dump.print(line('5C1', '0100000000000000'), line('5C1', 'F100000000000000'));
    await clock.advance(100);
    dump.print(line('5C1', '0100000000000000'), 'junk', line('5C1', '0000000000000000'));
    await clock.advance(100);
    // The accept button, held 1 s: a long press blanks the HUD, the release does nothing.
    for (let i = 0; i < 10; i++) {
      dump.print(line('5C1', '02'));
      await clock.advance(100);
    }
    dump.print(line('5C1', '00'));
    await clock.advance(100);
    // A short press on it accepts, on release.
    dump.print(line('5C1', '02'));
    await clock.advance(100);
    dump.print(line('5C1', '00'));
    await clock.advance(100);
    // Extended frame, bit 7 of byte 2.
    dump.print(line('18FF1234', '0000800000000000'));
    await clock.advance(100);
    expect(ofType('input').map((e) => e.action)).toEqual([
      'next-page',
      'toggle-blank',
      'primary',
      'secondary',
    ]);
    expect(logger.lines('debug')).toContain(
      'CAN buttons: 5C1 byte 0 & 0F = 02 long-press → toggle-blank',
    );

    await src.stop();
    expect(dump.signals).toEqual(['SIGTERM']);
    expect(clock.pendingTimers).toBe(0);
  });

  it('releases a button whose frames stop', async () => {
    const clock = new FakeClock();
    const system = canSystem();
    const config = canConfig({ interface: 'can0', releaseTimeoutMs: 300, rules });
    const { src, ofType } = await started(config, system, clock);
    const dump = system.dumps[0]!;
    dump.print(line('5C1', '01'));
    await clock.advance(1000); // no release frame: the timeout releases it
    dump.print(line('5C1', '01'));
    await clock.advance(1000);
    expect(ofType('input').map((e) => e.action)).toEqual(['next-page', 'next-page']);
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('warns when the interface is not in listen-only mode, is down or is missing', async () => {
    for (const [ip, pattern] of [
      [IP_NORMAL, /can0 is NOT in listen-only mode.*bitrate 125000 listen-only on/],
      [IP_DOWN, /can0 is down; bring it up in listen-only mode/],
      ['missing', /interface can0 does not exist \(yet\)/],
      [IP_ETH, /can0 is not a CAN interface/],
    ] as const) {
      const clock = new FakeClock();
      const system = canSystem({ ip });
      const { src, logger } = await started(canConfig({ interface: 'can0', rules }), system, clock);
      expect(logger.lines('warn').join('\n'), String(ip)).toMatch(pattern);
      // Only the problem itself: a down interface gets its mode when it is brought up.
      expect(logger.lines('warn'), String(ip)).toHaveLength(1);
      // It listens anyway: the interface may come up later.
      expect(system.dumps).toHaveLength(1);
      await src.stop();
    }
  });

  it('checks the mode again once frames arrive after the interface was missing', async () => {
    const clock = new FakeClock();
    let ip: string = 'missing';
    const system = canSystem();
    const spawn = fakeSpawn((child) => {
      if (child.command === 'ip') {
        if (ip === 'missing') return respond(child, '', 1, 'Device "can0" does not exist.\n');
        return respond(child, ip);
      }
      system.dumps.push(child);
    });
    const src = new CanButtonSource(canConfig({ interface: 'can0', rules }), { spawn });
    const { ctx, logger } = recordingContext(clock);
    await src.start(ctx);
    await src.whenReady();
    await clock.advance(10);
    ip = IP_NORMAL; // brought up later, but not listen-only
    system.dumps[0]!.print(line('5C1', '00'));
    await clock.advance(10);
    expect(logger.lines('warn').join('\n')).toMatch(/NOT in listen-only mode/);
    expect(spawn.children.filter((c) => c.command === 'ip')).toHaveLength(2);
    system.dumps[0]!.print(line('5C1', '00'));
    await clock.advance(10);
    expect(spawn.children.filter((c) => c.command === 'ip')).toHaveLength(2);
    await src.stop();
  });

  it('logs an install hint once and stays idle without can-utils', async () => {
    const clock = new FakeClock();
    const system = canSystem({ noCandump: true, ip: null });
    const { src, logger } = await started(canConfig({ interface: 'can0', rules }), system, clock);
    await clock.advance(120_000);
    expect(logger.lines('warn')).toEqual([expect.stringMatching(/sudo apt install can-utils/)]);
    expect(logger.lines('debug').join('\n')).toMatch(/ip \(iproute2\) is not installed/);
    expect(system.spawn.children.filter((c) => c.command === 'candump')).toHaveLength(1);
    expect(clock.pendingTimers).toBe(0);
    await src.stop();
  });

  it('stays idle without an interface or without rules', async () => {
    const clock = new FakeClock();
    const off = canSystem();
    const a = await started(canConfig({ interface: null, rules }), off, clock);
    expect(off.spawn.children).toEqual([]);
    await a.src.stop();
    const empty = canSystem();
    const b = await started(canConfig({ interface: 'can0', rules: [] }), empty, clock);
    expect(empty.spawn.children).toEqual([]);
    expect(b.logger.lines('info').join('\n')).toMatch(
      /no button rules configured; not listening on can0/,
    );
    await b.src.stop();
  });

  it('restarts candump after a failure, forgetting held buttons', async () => {
    const clock = new FakeClock();
    let runs = 0;
    const system = canSystem({
      monitor: (child) => {
        runs += 1;
        if (runs === 1) {
          child.print(line('5C1', '02')); // accept held …
          setImmediate(() => {
            child.printErr('read: Network is down');
            child.exit(1);
          });
        }
      },
    });
    const config = canConfig({ interface: 'can0', releaseTimeoutMs: null, rules });
    const { src, ofType, logger } = await started(config, system, clock);
    await clock.advance(1000);
    expect(system.dumps).toHaveLength(2);
    expect(logger.lines('warn').join('\n')).toMatch(/candump failed — interface can0 is down/);
    // … but candump died before its release: no action, no stale long press.
    await clock.advance(2000);
    system.dumps[1]!.print(line('5C1', '01'));
    await clock.advance(100);
    expect(ofType('input').map((e) => e.action)).toEqual(['next-page']);
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('restarts candump only for a new interface or new ids; other changes apply live', async () => {
    const clock = new FakeClock();
    const system = canSystem();
    const config = canConfig({ interface: 'can0', rules });
    const { src, ofType } = await started(config, system, clock);

    // Different actions and timing, same ids: the running candump carries on.
    const remapped = canConfig({
      interface: 'can0',
      releaseTimeoutMs: 200,
      rules: [rule({ id: '5C1', mask: '0F', value: '01', action: 'brightness-up' }), rules[2]!],
    });
    await src.updateConfig(remapped);
    await src.whenReady();
    await clock.advance(10);
    expect(system.dumps).toHaveLength(1);
    system.dumps[0]!.print(line('5C1', '01'));
    await clock.advance(100);
    expect(ofType('input').map((e) => e.action)).toEqual(['brightness-up']);

    // Unrelated settings: nothing happens.
    const other = structuredClone(remapped);
    other.sensors.lightSensorGain = 2;
    await src.updateConfig(other);
    await clock.advance(10);
    expect(system.dumps).toHaveLength(1);

    // A new id: restart with new filters.
    await src.updateConfig(canConfig({ interface: 'can0', rules: [rule({ id: '3E0' })] }));
    await src.whenReady();
    await clock.advance(10);
    expect(system.dumps).toHaveLength(2);
    expect(system.dumps[0]!.exited).toBe(true);
    expect(system.dumps[1]!.args).toEqual(['-L', 'can0,3E0:C00007FF']);

    // Another interface: restart.
    await src.updateConfig(canConfig({ interface: 'can1', rules: [rule({ id: '3E0' })] }));
    await src.whenReady();
    await clock.advance(10);
    expect(system.dumps.map((d) => d.args[1])).toEqual([
      'can0,5C1:C00007FF,18FF1234:DFFFFFFF',
      'can0,3E0:C00007FF',
      'can1,3E0:C00007FF',
    ]);

    // Off.
    await src.updateConfig(canConfig({ interface: null, rules: [rule({ id: '3E0' })] }));
    await src.whenReady();
    expect(system.dumps.every((d) => d.exited)).toBe(true);
    await src.stop();
    expect(clock.pendingTimers).toBe(0);
  });

  it('stopping while still checking the interface never starts candump', async () => {
    const clock = new FakeClock();
    const system = canSystem();
    const src = new CanButtonSource(canConfig({ interface: 'can0', rules }), {
      spawn: system.spawn,
    });
    const { ctx } = recordingContext(clock);
    await src.start(ctx);
    await src.stop();
    await clock.advance(1000);
    expect(system.dumps).toEqual([]);
  });
});
