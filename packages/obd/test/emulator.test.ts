import { describe, expect, it } from 'vitest';
import { Elm327Emulator, SIM_TPMS_PIDS } from '../src/sim/elm327-emulator.ts';
import { encodeDtc, supportedBitmap } from '../src/sim/ecus.ts';
import { VehicleSimulator } from '../src/sim/vehicle-sim.ts';
import { FakeClock, flush } from './helpers.ts';

/** Talk to the emulator the way a terminal would: send a line, collect text up to the prompt. */
async function session(options: ConstructorParameters<typeof Elm327Emulator>[1] = {}) {
  const sim = new VehicleSimulator({ mode: 'manual', engineTempC: 90 });
  const emulator = new Elm327Emulator(sim, { latencyMs: 0, ...options });
  let buffer = '';
  emulator.onData((chunk) => (buffer += chunk));
  await emulator.open();
  const send = async (command: string): Promise<string> => {
    buffer = '';
    await emulator.write(`${command}\r`);
    for (let i = 0; i < 50 && !buffer.includes('>'); i++) await flush();
    return buffer;
  };
  return { sim, emulator, send };
}

describe('Elm327Emulator AT commands', () => {
  it('echoes by default and answers ATZ with its banner', async () => {
    const { send } = await session();
    expect(await send('ATZ')).toBe('ATZ\r\r\rELM327 v1.5\r\r>');
  });

  it('honours echo, linefeeds and spaces settings', async () => {
    const { send } = await session();
    expect(await send('ATE0')).toBe('ATE0\rOK\r\r>');
    expect(await send('ATL1')).toBe('OK\r\n\r\n>');
    expect(await send('ATL0')).toBe('OK\r\r>');
    expect(await send('ATI')).toBe('ELM327 v1.5\r\r>');
    expect(await send('AT@1')).toBe('OBDII to RS232 Interpreter\r\r>');
    expect(await send('STI')).toBe('?\r\r>');
    expect(await send('ATXYZ')).toBe('?\r\r>');
  });

  it('reports the protocol before and after the automatic search', async () => {
    const { send } = await session();
    await send('ATE0');
    expect(await send('ATDP')).toBe('AUTO\r\r>');
    expect(await send('ATDPN')).toBe('A0\r\r>');
    expect(await send('0100')).toMatch(/^SEARCHING\.\.\.\r41 00 /);
    expect(await send('ATDP')).toBe('AUTO, ISO 15765-4 (CAN 11/500)\r\r>');
    expect(await send('ATDPN')).toBe('A6\r\r>');
    await send('ATSP6');
    expect(await send('ATDPN')).toBe('6\r\r>');
  });

  it('answers AT RV with the simulated battery voltage', async () => {
    const { send, sim } = await session();
    await send('ATE0');
    sim.setControls({ voltageOverrideV: 11.84 });
    expect(await send('ATRV')).toBe('11.8V\r\r>');
  });

  it('repeats the last command on a bare CR', async () => {
    const { send } = await session();
    await send('ATE0');
    await send('0100');
    const first = await send('010D');
    expect(await send('')).toBe(first);
  });

  it('reports a wrong protocol the way the chip does', async () => {
    const { send } = await session();
    await send('ATE0');
    await send('ATSP3');
    expect(await send('010D')).toBe('BUS INIT: ...ERROR\r\r>');
    await send('ATSP8');
    expect(await send('010D')).toBe('CAN ERROR\r\r>');
  });
});

describe('Elm327Emulator OBD responses', () => {
  it('prints single frames with and without headers and spaces', async () => {
    const { send, sim } = await session();
    sim.setControls({ throttle: 0.3 });
    sim.step(4000);
    const kph = Math.round(sim.snapshot().speedKph);
    const speed = kph.toString(16).toUpperCase().padStart(2, '0');
    await send('ATE0');
    expect(await send('010D')).toBe(`SEARCHING...\r41 0D ${speed}\r\r>`);
    await send('ATH1');
    expect(await send('010D')).toBe(`7E8 03 41 0D ${speed}\r\r>`);
    await send('ATS0');
    expect(await send('010D')).toBe(`7E803410D${speed}\r\r>`);
  });

  it('answers 0100 from the engine and the transmission with consistent bitmaps', async () => {
    const { send } = await session();
    await send('ATE0');
    await send('ATH1');
    const lines = (await send('0100')).split('\r').filter((l) => l.startsWith('7E'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^7E8 06 41 00 /);
    expect(lines[1]).toBe('7E9 06 41 00 00 00 00 01'); // TCM: only the continuation bit
    expect(await send('01A4')).toMatch(/^7E9 06 41 A4 03 /);
  });

  it('frames long answers as ISO-TP first + consecutive frames (headers on)', async () => {
    const { send } = await session();
    await send('ATE0');
    await send('ATH1');
    await send('0100');
    const text = await send('0902');
    expect(text).toBe(
      [
        '7E8 10 14 49 02 01 31 48 47',
        '7E8 21 43 4D 38 32 36 33 33',
        '7E8 22 41 30 30 34 33 35 32',
      ].join('\r') + '\r\r>',
    );
  });

  it('prints multi-frame answers as length + numbered segments with headers off', async () => {
    const { send } = await session();
    await send('ATE0');
    await send('0100');
    const text = await send('0902');
    expect(text).toBe(
      ['014', '0: 49 02 01 31 48 47', '1: 43 4D 38 32 36 33 33', '2: 41 30 30 34 33 35 32'].join(
        '\r',
      ) + '\r\r>',
    );
  });

  it('pads the last consecutive frame', async () => {
    const { send, sim } = await session();
    sim.setDtcs({ stored: ['P0143', 'P0196', 'P0234', 'P0235'] });
    await send('ATE0');
    await send('ATH1');
    const text = await send('03');
    expect(text).toContain('7E8 10 0A 43 04 01 43 01 96\r7E8 21 02 34 02 35 00 00 00\r');
    expect(text).toContain('7E9 02 43 00\r');
  });

  it('answers multi-PID requests with only the supported PIDs', async () => {
    const { send } = await session();
    await send('ATE0');
    await send('ATH1');
    await send('0100');
    expect(await send('010D52E0')).toMatch(/^7E8 05 41 0D [0-9A-F]{2} 52 [0-9A-F]{2}\r\r>$/);
  });

  it('only lets the TPMS module answer after AT SH + AT CRA', async () => {
    const { send, sim } = await session();
    sim.setControls({ tirePressuresKpa: { fl: 230, fr: 231, rl: 180, rr: 229.5 } });
    await send('ATE0');
    await send('ATH1');
    await send('0100');
    expect(await send('224003')).toBe('NO DATA\r\r>'); // functional request: TPMS ignores it
    await send('ATSH7C6');
    expect(await send('224003')).toBe('NO DATA\r\r>'); // filtered: 7CE is outside 7E8–7EF
    await send('ATCRA7CE');
    expect(await send('224003')).toBe('7CE 05 62 40 03 07 08\r\r>'); // 1800 = 0x0708
    expect(await send('224099')).toBe('7CE 03 7F 22 31\r\r>');
    await send('ATCRA');
    await send('ATSH7DF');
    expect(await send('224003')).toBe('NO DATA\r\r>');
  });

  it('exports matching custom PID definitions for the TPMS module', () => {
    expect(SIM_TPMS_PIDS.map((p) => [p.signal, p.mode, p.pid, p.header])).toEqual([
      ['tirePressureFL', '22', '4001', '7C6'],
      ['tirePressureFR', '22', '4002', '7C6'],
      ['tirePressureRL', '22', '4003', '7C6'],
      ['tirePressureRR', '22', '4004', '7C6'],
    ]);
  });

  it('answers UNABLE TO CONNECT while the ignition is off', async () => {
    const { send, emulator } = await session();
    await send('ATE0');
    emulator.setEcuOnline(false);
    expect(await send('0100')).toBe('SEARCHING...\rUNABLE TO CONNECT\r\r>');
    emulator.setEcuOnline(true);
    await send('0100');
    emulator.setEcuOnline(false);
    expect(await send('010D')).toBe('NO DATA\r\r>');
  });

  it('refuses to clear codes while moving and clears them when stopped', async () => {
    const { send, sim } = await session();
    sim.setControls({ dtcs: ['P0420'], throttle: 0.5 });
    sim.step(3000);
    await send('ATE0');
    await send('ATH1');
    expect(await send('04')).toContain('7E8 03 7F 04 22');
    sim.setControls({ throttle: 0, brake: 1 });
    sim.step(10_000);
    expect(await send('04')).toContain('7E8 01 44');
    expect(sim.status().dtcs).toEqual([]);
  });

  it('is interrupted by a character received while a request is in progress', async () => {
    const { emulator } = await session({ latencyMs: 20 });
    let buffer = '';
    emulator.onData((chunk) => (buffer += chunk));
    await emulator.write('ATE0\r');
    await new Promise((r) => setTimeout(r, 40));
    buffer = '';
    await emulator.write('010D\r');
    await emulator.write('X');
    await flush();
    expect(buffer).toBe('STOPPED\r\r>');
  });
});

/** A line as an ELM327 prints it on ISO 9141-2 with headers on: header, data, checksum. */
const kline = (...data: number[]): string => {
  const bytes = [0x48, 0x6b, 0x10, ...data];
  const checksum = bytes.reduce((sum, b) => sum + b, 0) & 0xff;
  return [...bytes, checksum].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
};

describe('Elm327Emulator clone and K-line profiles', () => {
  it('prints only the first frame of a long answer without flow control (multiFrame: false)', async () => {
    const { send } = await session({ multiFrame: false });
    await send('ATE0');
    await send('ATH1');
    await send('0100');
    expect(await send('0902')).toBe('7E8 10 14 49 02 01 31 48 47\r\r>');
    // An answer that fits one frame is complete.
    expect(await send('010D0C')).toMatch(
      /^7E8 06 41 0D [0-9A-F]{2} 0C [0-9A-F]{2} [0-9A-F]{2}\r\r>$/,
    );
  });

  it('prints SEARCHING... at once and the answer when the search is done', async () => {
    const clock = new FakeClock(0);
    const sim = new VehicleSimulator({ mode: 'manual' });
    const emulator = new Elm327Emulator(sim, {
      latencyMs: 20,
      searchLatencyMs: 3000,
      timers: clock,
    });
    let buffer = '';
    emulator.onData((chunk) => (buffer += chunk));
    await emulator.open();
    await emulator.write('ATE0\r');
    await clock.advance(50);
    buffer = '';
    await emulator.write('0100\r');
    await clock.advance(100);
    expect(buffer).toBe('SEARCHING...\r');
    await clock.advance(3000);
    expect(buffer).toMatch(/^SEARCHING\.\.\.\r(41 00 [0-9A-F ]+\r)+\r>$/);
    // "A6" tries the car's protocol first: no long search.
    await emulator.write('ATSPA6\r');
    await clock.advance(50);
    buffer = '';
    await emulator.write('0100\r');
    await clock.advance(50);
    expect(buffer).toMatch(/^SEARCHING\.\.\.\r(41 00 [0-9A-F ]+\r)+\r>$/);
  });

  it('emulates an ISO 9141-2 car: bus init, one PID per request, headers with checksum', async () => {
    const { send, sim } = await session({
      bus: 'iso9141',
      requestLatencyMs: 0,
      busInitLatencyMs: 0,
    });
    await send('ATE0');
    await send('ATH1');
    expect(await send('ATSP3')).toBe('OK\r\r>');
    expect(await send('0100')).toMatch(
      /^BUS INIT: \.\.\.OK\r48 6B 10 41 00( [0-9A-F]{2}){5}\r\r>$/,
    );
    expect(await send('ATDPN')).toBe('3\r\r>');
    expect(await send('ATDP')).toBe('ISO 9141-2\r\r>');
    const speed = Math.round(sim.snapshot().speedKph);
    // Only the first PID of a multi-PID request is answered.
    expect(await send('010D0C')).toBe(`${kline(0x41, 0x0d, speed)}\r\r>`);
    // Trouble codes: three per line, no count byte, zero-padded.
    sim.setDtcs({ stored: ['P0143', 'P0196', 'P0234', 'P0235'] });
    expect(await send('03')).toBe(
      `${kline(0x43, 0x01, 0x43, 0x01, 0x96, 0x02, 0x34)}\r${kline(0x43, 0x02, 0x35, 0, 0, 0, 0)}\r\r>`,
    );
    expect(await send('07')).toBe(`${kline(0x47, 0, 0, 0, 0, 0, 0)}\r\r>`);
    // The VIN: five numbered lines of four bytes, padded with zeros in front.
    await send('ATH0');
    const vin = [...sim.vin].map((ch) => ch.charCodeAt(0));
    const padded = [0, 0, 0, ...vin];
    const lines = [0, 1, 2, 3, 4].map((i) =>
      [0x49, 0x02, i + 1, ...padded.slice(i * 4, i * 4 + 4)]
        .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' '),
    );
    expect(await send('0902')).toBe(`${lines.join('\r')}\r\r>`);
  });

  it('initialises the K-line again after the ECU was off', async () => {
    const { send, emulator } = await session({
      bus: 'iso9141',
      requestLatencyMs: 0,
      busInitLatencyMs: 0,
    });
    await send('ATE0');
    expect(await send('0100')).toMatch(/^SEARCHING\.\.\.\rBUS INIT: \.\.\.OK\r41 00 /);
    expect(await send('ATDPN')).toBe('A3\r\r>');
    expect(await send('010D')).toMatch(/^41 0D [0-9A-F]{2}\r\r>$/);
    emulator.setEcuOnline(false);
    expect(await send('010D')).toBe('BUS INIT: ...ERROR\r\r>');
    emulator.setEcuOnline(true);
    expect(await send('010D')).toMatch(/^BUS INIT: \.\.\.OK\r41 0D [0-9A-F]{2}\r\r>$/);
    await send('ATSP6');
    expect(await send('010D')).toBe('CAN ERROR\r\r>');
  });

  it('takes about 200 ms per K-line request and 2.5 s for the bus init', async () => {
    const clock = new FakeClock(0);
    const sim = new VehicleSimulator({ mode: 'manual' });
    const emulator = new Elm327Emulator(sim, { bus: 'iso9141', timers: clock });
    let buffer = '';
    emulator.onData((chunk) => (buffer += chunk));
    await emulator.open();
    for (const command of ['ATE0', 'ATSP3']) {
      await emulator.write(`${command}\r`);
      await clock.advance(100);
    }
    buffer = '';
    await emulator.write('010D\r');
    await clock.advance(100);
    expect(buffer).toBe('BUS INIT: ...');
    await clock.advance(2550); // 25 ms adapter + 175 ms bus + 2500 ms init
    expect(buffer).toBe('BUS INIT: ...');
    await clock.advance(100);
    expect(buffer).toMatch(/^BUS INIT: \.\.\.OK\r41 0D [0-9A-F]{2}\r\r>$/);
    buffer = '';
    await emulator.write('010C\r');
    await clock.advance(150);
    expect(buffer).toBe('');
    await clock.advance(100);
    expect(buffer).toMatch(/^41 0C [0-9A-F]{2} [0-9A-F]{2}\r\r>$/);
  });
});

describe('Elm327Emulator fault injection', () => {
  it('drops, garbles, stops or answers NO DATA on demand', async () => {
    const { send, emulator } = await session();
    await send('ATE0');
    emulator.injectFault('garbage');
    expect(await send('010D')).toMatch(/^[#%&@!~?*]{12}\r7E8 Z Q\r\r>$/);
    emulator.injectFault('stopped');
    expect(await send('010D')).toBe('STOPPED\r\r>');
    emulator.injectFault('no-data');
    expect(await send('010D')).toBe('NO DATA\r\r>');
    emulator.injectFault('drop');
    expect(await send('010D')).toBe('');
  });

  it('can reset or drop the link', async () => {
    const { send, emulator } = await session();
    await send('ATE0');
    emulator.injectFault('reset');
    expect(await send('010D')).toBe('LV RESET\r\rELM327 v1.5\r\r>');
    let closedWith: Error | undefined | null = null;
    emulator.onClose((err) => (closedWith = err));
    emulator.injectFault('disconnect');
    await send('010D');
    expect(closedWith).toBeInstanceOf(Error);
    expect(emulator.isOpen).toBe(false);
    await expect(emulator.write('010D\r')).rejects.toThrow();
  });

  it('applies probabilistic faults deterministically from the seed', async () => {
    const run = async (): Promise<string[]> => {
      const { send } = await session({ faults: { dropRate: 0.3, garbageRate: 0.2, seed: 42 } });
      await send('ATE0');
      const out: string[] = [];
      for (let i = 0; i < 20; i++) out.push(await send('010D'));
      return out;
    };
    const first = await run();
    expect(await run()).toEqual(first);
    expect(first.filter((t) => t === '').length).toBeGreaterThan(0);
    expect(first.filter((t) => t.startsWith('41 0D')).length).toBeGreaterThan(0);
  });

  it('logs recent commands', async () => {
    const { send, emulator } = await session();
    await send('AT Z');
    await send('01 0d');
    expect(emulator.commandLog).toEqual(['ATZ', '010D']);
  });
});

describe('ECU encoding helpers', () => {
  it('encodes DTCs to the two-byte form', () => {
    expect(encodeDtc('P0420')).toEqual([0x04, 0x20]);
    expect(encodeDtc('U0100')).toEqual([0xc1, 0x00]);
    expect(encodeDtc('C1123')).toEqual([0x51, 0x23]);
    expect(() => encodeDtc('X0100')).toThrow(RangeError);
  });

  it('builds bitmaps with the continuation chain', () => {
    expect(supportedBitmap(0x00, [0x0c, 0x0d, 0xa6])).toEqual([0x00, 0x18, 0x00, 0x01]);
    expect(supportedBitmap(0xa0, [0x0c, 0x0d, 0xa6])).toEqual([0x04, 0x00, 0x00, 0x00]);
  });
});
