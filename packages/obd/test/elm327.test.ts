import { describe, expect, it } from 'vitest';
import { Elm327 } from '../src/elm327.ts';
import { ElmError } from '../src/errors.ts';
import { ScriptedTransport, cloneAdapter, flush, reply } from './helpers.ts';

const FAST = { timeoutMs: 60, settleMs: 5, resetTimeoutMs: 200, searchTimeoutMs: 500 } as const;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const CAN_OBD: Record<string, string[]> = {
  '0100': ['SEARCHING...', '7E8 06 41 00 BE 3F A8 13', '7E9 06 41 00 98 18 80 10'],
  '010D0C': ['7E8 06 41 0D 32 0C 1A F8', '7E9 03 41 0D 33'],
  '0101': ['7E8 06 41 01 83 07 65 04', '7E9 06 41 01 00 00 00 00'],
  '03': ['7E8 10 0A 43 04 01 43 01 96', '7E9 04 43 01 07 00', '7E8 21 02 34 02 35 00 00 00'],
  '07': ['7E8 02 47 00', '7E9 02 47 00'],
  '0902': [
    '7E8 10 14 49 02 01 57 50 30',
    '7E8 21 5A 5A 5A 39 39 5A 54',
    '7E8 22 53 33 39 32 31 32 34',
  ],
  '04': ['7E8 01 44', '7E9 01 44'],
};

async function connected(
  obd: Record<string, string[]> = CAN_OBD,
  extra: Record<string, string[]> = {},
  options: Partial<Record<keyof typeof FAST, number>> = {},
): Promise<{ elm: Elm327; transport: ScriptedTransport }> {
  const transport = cloneAdapter(obd, extra);
  await transport.open();
  const elm = new Elm327(transport, { ...FAST, ...options });
  await elm.initialize({ protocol: '0' });
  return { elm, transport };
}

async function errorOf(promise: Promise<unknown>): Promise<ElmError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ElmError) return err;
    throw err;
  }
  throw new Error('expected an ElmError');
}

describe('Elm327.initialize', () => {
  it('runs the init sequence on a typical clone and reports adapter and protocol', async () => {
    const { elm, transport } = await connected();
    expect(transport.commands).toEqual([
      'ATZ',
      'ATE0',
      'ATL0',
      'ATS0',
      'ATH1',
      'ATSP0',
      'ATAT1',
      'ATI',
      'AT@1',
      'STI',
      '0100',
      'ATDPN',
      'ATDP',
      'ATRV',
    ]);
    expect(elm.info).toEqual({
      adapter: 'ELM327 v1.5',
      version: 'ELM327 v1.5',
      description: null,
      stn: null,
      protocolId: '6',
      protocol: 'ISO 15765-4 (CAN 11/500)',
      family: 'can11',
      headers: true,
      voltageSupported: true,
      maxPidsPerRequest: 6,
    });
  });

  it('strips echoes while echo is still on and identifies STN adapters', async () => {
    const echoing = new Set(['ATZ', 'ATE0']);
    const answers: Record<string, string[]> = {
      ATZ: ['', '', 'ELM327 v1.4b'],
      ATE0: ['OK'],
      ATI: ['ELM327 v1.4b'],
      'AT@1': ['OBDLink MX+'],
      STI: ['STN2255 v5.10.3'],
      ATDPN: ['7'],
      ATDP: ['ISO 15765-4 (CAN 29/500)'],
      ATRV: ['12.6V'],
      '0100': ['18 DA F1 10 06 41 00 BE 3F A8 13'],
    };
    const transport = new ScriptedTransport((command) => {
      const lines = answers[command] ?? ['OK'];
      return `${echoing.has(command) ? `${command}\r` : ''}${reply(...lines)}`;
    });
    const elm = new Elm327(transport, FAST);
    const info = await elm.initialize({ protocol: '7' });
    expect(info.adapter).toBe('STN2255 v5.10.3 (ELM327 v1.4b)');
    expect(info.description).toBe('OBDLink MX+');
    expect(info.family).toBe('can29');
    expect(info.protocolId).toBe('7');
    expect(transport.commands).toContain('ATSP7');
  });

  it('copes with a clone that rejects ATH1 and ATAT1 (headers off)', async () => {
    const { elm } = await connected(
      { '0100': ['41 00 BE 3F A8 13'], '010D': ['41 0D 32'] },
      { ATH1: ['?'], ATAT1: ['?'] },
    );
    expect(elm.info?.headers).toBe(false);
    const result = await elm.queryMode01([0x0d]);
    expect(result.values.speed).toBe(50);
    expect(result.answers.get(0x0d)?.[0]?.ecu).toBeNull();
  });

  it('notices a clone that says OK to ATH1 but still prints no headers', async () => {
    const { elm } = await connected({ '0100': ['41 00 BE 3F A8 13'] });
    expect(elm.info?.headers).toBe(false);
  });

  it('infers the framing when the adapter cannot report its protocol number', async () => {
    const { elm } = await connected(
      { '0100': ['18 DA F1 10 06 41 00 BE 3F A8 13'] },
      { ATDPN: ['?'], ATDP: ['?'] },
    );
    expect(elm.info?.family).toBe('can29');
    expect(elm.info?.protocol).toBe('Unknown protocol');
  });

  it('fails with UNABLE_TO_CONNECT when the ignition is off', async () => {
    const transport = cloneAdapter({ '0100': ['SEARCHING...', 'UNABLE TO CONNECT'] });
    const err = await errorOf(new Elm327(transport, FAST).initialize({ protocol: '0' }));
    expect(err.code).toBe('UNABLE_TO_CONNECT');
  });

  it('fails with NO_RESPONSE when the vehicle answers NO DATA', async () => {
    const transport = cloneAdapter({ '0100': ['NO DATA'] });
    const err = await errorOf(new Elm327(transport, FAST).initialize({ protocol: '6' }));
    expect(err.code).toBe('NO_RESPONSE');
  });

  it('retries ATZ once and fails with TIMEOUT when the adapter is mute', async () => {
    const transport = new ScriptedTransport(() => null);
    const err = await errorOf(new Elm327(transport, FAST).initialize({ protocol: '0' }));
    expect(['TIMEOUT', 'DESYNC']).toContain(err.code);
  });

  it('rejects an invalid protocol setting without touching the link', async () => {
    const transport = cloneAdapter({});
    await expect(new Elm327(transport, FAST).initialize({ protocol: 'Z' })).rejects.toThrow(
      RangeError,
    );
    expect(transport.commands).toEqual([]);
  });

  it('marks legacy protocols as one PID per request', async () => {
    const { elm } = await connected(
      { '0100': ['48 6B 10 41 00 BE 3F B8 13 B9'] },
      { ATDPN: ['A3'], ATDP: ['AUTO, ISO 9141-2'] },
    );
    expect(elm.info).toMatchObject({
      family: 'legacy',
      maxPidsPerRequest: 1,
      protocol: 'ISO 9141-2',
    });
    await expect(elm.queryMode01([0x0d, 0x0c])).rejects.toThrow(RangeError);
  });
});

describe('Elm327 requests', () => {
  it('queries several PIDs at once and merges ECUs (engine first)', async () => {
    const { elm, transport } = await connected();
    const result = await elm.queryMode01([0x0d, 0x0c]);
    expect(transport.commands.at(-1)).toBe('010D0C');
    expect(result.values).toEqual({ speed: 50, rpm: 1726 });
    expect(result.answers.get(0x0d)?.map((a) => a.ecu)).toEqual(['7E8', '7E9']);
  });

  it('returns an empty result for NO DATA', async () => {
    const { elm } = await connected();
    const result = await elm.queryMode01([0x52]);
    expect(result.answers.size).toBe(0);
    expect(result.values).toEqual({});
  });

  it('validates PID lists', async () => {
    const { elm } = await connected();
    await expect(elm.queryMode01([])).rejects.toThrow(RangeError);
    await expect(elm.queryMode01([1, 2, 3, 4, 5, 6, 7])).rejects.toThrow(RangeError);
    await expect(elm.queryMode01([0x0d, 0x0d])).rejects.toThrow(RangeError);
    await expect(elm.queryMode01([256])).rejects.toThrow(RangeError);
  });

  it('reads MIL status and stored/pending/permanent codes across ECUs', async () => {
    const { elm } = await connected();
    expect(await elm.readDtcs()).toEqual({
      milOn: true,
      stored: ['P0143', 'P0196', 'P0234', 'P0235', 'P0700'],
      pending: [],
      permanent: [],
    });
  });

  it('reads legacy DTCs without a count byte', async () => {
    const { elm } = await connected(
      {
        '0100': ['48 6B 10 41 00 BE 3F B8 13 B9'],
        '0101': ['48 6B 10 41 01 82 07 65 04 00'],
        '03': ['48 6B 10 43 01 33 03 00 04 20 00', '48 6B 10 43 01 71 00 00 00 00 00'],
      },
      { ATDPN: ['A3'] },
    );
    expect(await elm.readDtcs()).toEqual({
      milOn: true,
      stored: ['P0133', 'P0300', 'P0420', 'P0171'],
      pending: [],
      permanent: [],
    });
  });

  it('tolerates an odd answer to service 0A (older vehicles)', async () => {
    const { elm } = await connected({ ...CAN_OBD, '0A': ['7E8 03 7F 0A 11'] }, {});
    const report = await elm.readDtcs();
    expect(report.permanent).toEqual([]);
  });

  it('clears codes and reports refusals', async () => {
    expect(await (await connected()).elm.clearDtcs()).toEqual({
      ok: true,
      message: 'Trouble codes cleared (2 control units)',
    });
    const refused = await (
      await connected({ ...CAN_OBD, '04': ['7E8 03 7F 04 22'] })
    ).elm.clearDtcs();
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain('conditions not correct');
    const silent = await (await connected({ ...CAN_OBD, '04': ['NO DATA'] })).elm.clearDtcs();
    expect(silent.ok).toBe(false);
  });

  it('reads the VIN from a multi-frame answer', async () => {
    const { elm } = await connected();
    expect(await elm.readVin()).toBe('WP0ZZZ99ZTS392124');
    const { elm: noVin } = await connected({ ...CAN_OBD, '0902': ['NO DATA'] });
    expect(await noVin.readVin()).toBeNull();
  });

  it('reads the battery voltage, null when unsupported', async () => {
    expect(await (await connected()).elm.readVoltage()).toBe(12.4);
    expect(await (await connected(CAN_OBD, { ATRV: ['?'] })).elm.readVoltage()).toBeNull();
  });

  it('sends custom requests with a header and restores the default header and filter', async () => {
    const { elm, transport } = await connected({ ...CAN_OBD, '224001': ['7CE 05 62 40 01 08 FC'] });
    const before = transport.commands.length;
    const answers = await elm.raw('22', '4001', '7C6');
    expect(transport.commands.slice(before)).toEqual([
      'ATSH7C6',
      'ATCRA7CE',
      '224001',
      'ATSH7DF',
      'ATCRA',
    ]);
    expect(answers).toEqual([{ ecu: '7CE', data: Uint8Array.of(0x08, 0xfc) }]);
  });

  it('does not touch the receive filter for engine-range headers', async () => {
    const { elm, transport } = await connected({ ...CAN_OBD, '2101': ['7E8 04 61 01 12 34'] });
    const before = transport.commands.length;
    const answers = await elm.raw('21', '01', '7E0');
    expect(transport.commands.slice(before)).toEqual(['ATSH7E0', '2101', 'ATSH7DF']);
    expect(answers[0]?.data).toEqual(Uint8Array.of(0x12, 0x34));
  });

  it('falls back to AT AR when a clone lacks the argument-less AT CRA', async () => {
    const { elm, transport } = await connected(
      { ...CAN_OBD, '224001': ['7CE 05 62 40 01 08 FC'] },
      { ATCRA: ['?'] },
    );
    await elm.raw('22', '4001', '7C6');
    expect(transport.commands.slice(-2)).toEqual(['ATCRA', 'ATAR']);
    expect(elm.closed).toBe(false);
  });

  it('raises NEGATIVE_RESPONSE for a rejected custom request, still restoring the header', async () => {
    const { elm, transport } = await connected({
      ...CAN_OBD,
      '224009': ['7CE 03 7F 22 78', '7CE 03 7F 22 31'],
    });
    const err = await errorOf(elm.raw('22', '4009', '7C6'));
    expect(err.code).toBe('NEGATIVE_RESPONSE');
    expect(err.nrc).toBe(0x31);
    expect(transport.commands.slice(-2)).toEqual(['ATSH7DF', 'ATCRA']);
  });

  it('closes the session when the default header cannot be restored', async () => {
    const { elm } = await connected(
      { ...CAN_OBD, '224001': ['7CE 05 62 40 01 08 FC'] },
      { ATSH7DF: ['?'] },
    );
    const err = await errorOf(elm.raw('22', '4001', '7C6'));
    expect(err.code).toBe('DESYNC');
    expect(elm.closed).toBe(true);
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('DESYNC');
  });

  it('validates custom request arguments', async () => {
    const { elm } = await connected();
    await expect(elm.raw('2', '4001')).rejects.toThrow(RangeError);
    await expect(elm.raw('22', '40G1')).rejects.toThrow(RangeError);
    await expect(elm.raw('22', '4001', '18DA10F1')).rejects.toThrow(RangeError);
  });

  it('maps adapter errors to typed errors without killing the session', async () => {
    const { elm } = await connected({ ...CAN_OBD, '010C': ['STOPPED'], '0105': ['#%&@!~'] });
    expect((await errorOf(elm.queryMode01([0x0c]))).code).toBe('STOPPED');
    expect((await errorOf(elm.queryMode01([0x05]))).code).toBe('MALFORMED');
    expect(elm.closed).toBe(false);
    expect((await elm.queryMode01([0x0d, 0x0c])).values.speed).toBe(50);
  });
});

describe('Elm327 framing, timeouts and resynchronisation', () => {
  it('keeps exactly one command in flight', async () => {
    const { elm, transport } = await connected();
    const handler = transport.handler;
    let awaitingReply = false;
    let overlapped = false;
    transport.handler = (command) => {
      if (awaitingReply) overlapped = true;
      awaitingReply = true;
      const text = handler(command);
      // Answer later, on a timer, like a real serial link.
      setTimeout(() => {
        awaitingReply = false;
        if (text !== null) transport.push(text);
      }, 2);
      return null;
    };
    const results = await Promise.all([
      elm.queryMode01([0x0d, 0x0c]),
      elm.readVin(),
      elm.readVoltage(),
      elm.queryMode01([0x0d, 0x0c]),
    ]);
    expect(overlapped).toBe(false);
    expect(results[1]).toBe('WP0ZZZ99ZTS392124');
    expect(transport.commands.slice(-4)).toEqual(['010D0C', '0902', 'ATRV', '010D0C']);
  });

  it('frames responses split across chunks and strips NUL bytes', async () => {
    const transport = cloneAdapter(CAN_OBD, {});
    const { elm } = { elm: new Elm327(transport, FAST) };
    await elm.initialize({ protocol: '0' });
    transport.handler = () => null;
    const pending = elm.queryMode01([0x0d]);
    await flush();
    transport.push('7E8 03 4');
    transport.push('1 0D\0 32\r');
    transport.push('\r>');
    expect((await pending).values.speed).toBe(50);
  });

  it('times out, resynchronises with a harmless probe and carries on', async () => {
    const { elm, transport } = await connected();
    const handler = transport.handler;
    transport.handler = (command) => (command === '010D0C' ? null : handler(command));
    const err = await errorOf(elm.queryMode01([0x0d, 0x0c]));
    expect(err.code).toBe('TIMEOUT');
    transport.handler = handler;
    const next = await elm.queryMode01([0x0d, 0x0c]);
    expect(next.values.speed).toBe(50);
    const tail = transport.commands.slice(-3);
    expect(tail).toEqual(['010D0C', 'ATRV', '010D0C']);
  });

  it('absorbs a late answer instead of handing it to the next command', async () => {
    const { elm, transport } = await connected();
    const handler = transport.handler;
    transport.handler = (command) => {
      if (command === '0105') {
        // Arrives after the 60 ms timeout but within the resync grace period.
        setTimeout(() => transport.push(reply('7E8 03 41 0D 63')), 80);
        return null;
      }
      return handler(command);
    };
    const probesBefore = transport.commands.filter((c) => c === 'ATRV').length;
    expect((await errorOf(elm.queryMode01([0x05]))).code).toBe('TIMEOUT');
    const next = await elm.queryMode01([0x0d, 0x0c]);
    expect(next.values.speed).toBe(50); // not the stale 0x63
    expect(transport.commands.filter((c) => c === 'ATRV').length).toBe(probesBefore);
  });

  it('gives up with DESYNC when the adapter stops answering entirely', async () => {
    const { elm, transport } = await connected();
    transport.handler = () => null;
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('TIMEOUT');
    const err = await errorOf(elm.queryMode01([0x0d]));
    expect(err.code).toBe('DESYNC');
    expect(elm.closed).toBe(true);
    expect(transport.closed).toBe(true);
  });

  it('treats an unsolicited reset banner as fatal', async () => {
    const { elm, transport } = await connected();
    transport.push('\r\rELM327 v1.5\r\r>');
    expect(elm.closed).toBe(true);
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('ADAPTER_RESET');
  });

  it('treats LV RESET inside a response as fatal', async () => {
    const { elm } = await connected({ ...CAN_OBD, '010D': ['LV RESET'] });
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('LV_RESET');
    expect(elm.closed).toBe(true);
  });

  it('rejects the command in flight and later ones when the link drops', async () => {
    const { elm, transport } = await connected();
    transport.handler = () => null;
    const pending = errorOf(elm.queryMode01([0x0d]));
    await flush();
    transport.drop(new Error('rfcomm hung up'));
    const err = await pending;
    expect(err.code).toBe('CLOSED');
    expect(err.message).toContain('rfcomm hung up');
    expect((await errorOf(elm.readVoltage())).code).toBe('CLOSED');
  });

  it('close() rejects pending work and closes the transport', async () => {
    const { elm, transport } = await connected();
    transport.handler = () => null;
    const pending = errorOf(elm.queryMode01([0x0d]));
    await flush();
    await elm.close();
    expect((await pending).code).toBe('CLOSED');
    expect(transport.closed).toBe(true);
    await sleep(FAST.timeoutMs + 20); // the cancelled timeout must not fire into anything
    expect(elm.closed).toBe(true);
  });
});

describe('Elm327 regressions', () => {
  it('restores the header when the receive filter is rejected after AT SH succeeded (obd-1)', async () => {
    const { elm, transport } = await connected(
      { ...CAN_OBD, '224001': ['7CE 05 62 40 01 08 FC'] },
      { ATCRA7CE: ['?'] },
    );
    const before = transport.commands.length;
    expect((await errorOf(elm.raw('22', '4001', '7C6'))).code).toBe('UNSUPPORTED');
    // The filter was never set, so only the header needs restoring.
    expect(transport.commands.slice(before)).toEqual(['ATSH7C6', 'ATCRA7CE', 'ATSH7DF']);
    expect(elm.closed).toBe(false);
    expect((await elm.queryMode01([0x0d, 0x0c])).values.speed).toBe(50);
  });

  it('restores the header when the reply to AT SH is lost although it was applied (obd-1)', async () => {
    const { elm, transport } = await connected();
    const handler = transport.handler;
    transport.handler = (command) => (command === 'ATSH7C6' ? null : handler(command));
    const before = transport.commands.length;
    expect((await errorOf(elm.raw('22', '4001', '7C6'))).code).toBe('TIMEOUT');
    // Resync probe, then the restore.
    expect(transport.commands.slice(before)).toEqual(['ATSH7C6', 'ATRV', 'ATSH7DF']);
    expect(elm.closed).toBe(false);
  });

  it('restores the CAN priority when the 29-bit header is rejected (obd-1)', async () => {
    const { elm, transport } = await connected(
      { '0100': ['18 DA F1 10 06 41 00 BE 3F A8 13'] },
      { ATDPN: ['A7'], ATDP: ['AUTO, ISO 15765-4 (CAN 29/500)'], ATSHDA10F1: ['?'] },
    );
    const before = transport.commands.length;
    expect((await errorOf(elm.raw('22', '4001', '1CDA10F1'))).code).toBe('UNSUPPORTED');
    expect(transport.commands.slice(before)).toEqual(['ATCP1C', 'ATSHDA10F1', 'ATCP18']);
    expect(elm.closed).toBe(false);
  });

  it('fails a DTC read when a control unit is busy instead of reporting no codes (obd-3)', async () => {
    // 0101: the engine ECU has the MIL on and 3 confirmed codes.
    const { elm } = await connected({ ...CAN_OBD, '03': ['7E8 03 7F 03 21'] });
    const err = await errorOf(elm.readDtcs());
    expect(err.code).toBe('NEGATIVE_RESPONSE');
    expect(err.nrc).toBe(0x21);
    expect(elm.closed).toBe(false);
  });

  it('fails a DTC read when a multi-frame answer lost a frame (obd-3)', async () => {
    const { elm } = await connected({
      ...CAN_OBD,
      // The ECM's consecutive frame arrived garbled; the TCM's answer is fine.
      '07': ['7E8 10 0A 47 04 01 43 01 96', '7E9 02 47 00', '7E8 2l 02 34 02 35 00 00 00'],
    });
    const err = await errorOf(elm.readDtcs());
    expect(err.code).toBe('MALFORMED');
    expect(err.message).toContain('Incomplete');
  });

  it('fails a DTC read when a unit counts codes in 0101 but sends no 03 answer (obd-3)', async () => {
    const { elm } = await connected({ ...CAN_OBD, '03': ['7E9 02 43 00'] });
    const err = await errorOf(elm.readDtcs());
    expect(err.code).toBe('MALFORMED');
    expect(err.message).toContain('7E8 counts 3 trouble code(s)');
  });

  it('accepts "response pending" followed by the answer, and permanent refusals (obd-3)', async () => {
    const { elm } = await connected({
      ...CAN_OBD,
      '03': ['7E8 03 7F 03 78', ...(CAN_OBD['03'] ?? [])],
      '07': ['7E8 02 47 00', '7E9 03 7F 07 11'],
    });
    expect(await elm.readDtcs()).toMatchObject({
      stored: ['P0143', 'P0196', 'P0234', 'P0235', 'P0700'],
      pending: [],
    });
  });

  it('detects a stray late reply after a resync instead of returning it as data (obd-5)', async () => {
    const { elm, transport } = await connected(CAN_OBD, {}, { timeoutMs: 300 });
    const handler = transport.handler;
    let first = true;
    transport.handler = (command) => {
      if (command === '0105') return null;
      const text = handler(command);
      if (command === '010D0C' && first && text !== null) {
        first = false;
        // The late answer to 0105 turns up only after the resynchronisation has ended and
        // the next command was sent (e.g. a TCP retransmit), followed by that command's own.
        setTimeout(() => transport.push(reply('7E8 03 41 05 7B')), 5);
        setTimeout(() => transport.push(text), 30);
        return null;
      }
      return text;
    };
    expect((await errorOf(elm.queryMode01([0x05]))).code).toBe('TIMEOUT');
    const mismatch = await errorOf(elm.queryMode01([0x0d, 0x0c]));
    expect(mismatch.code).toBe('MALFORMED');
    expect(mismatch.message).toContain('Mismatched');
    // Resynchronised: the next answers line up with their commands again.
    expect((await elm.queryMode01([0x0d, 0x0c])).values).toEqual({ speed: 50, rpm: 1726 });
    expect(await elm.readVoltage()).toBe(12.4);
    expect(elm.closed).toBe(false);
  });

  it('resynchronises after STOPPED, so the late answer is not taken for the next command (obd-5)', async () => {
    const { elm, transport } = await connected(
      { ...CAN_OBD, '010D': ['7E8 03 41 0D 32'] },
      {},
      { timeoutMs: 400 },
    );
    const handler = transport.handler;
    let first = true;
    transport.handler = (command) => {
      if (command === '010C') {
        // The adapter was still busy: it stops that, then answers this request late.
        setTimeout(() => transport.push(reply('7E8 04 41 0C 1A F8')), 30);
        return reply('STOPPED');
      }
      const text = handler(command);
      if (command === '010D' && first && text !== null) {
        first = false;
        setTimeout(() => transport.push(text), 100); // a busy adapter answers later
        return null;
      }
      return text;
    };
    expect((await errorOf(elm.queryMode01([0x0c]))).code).toBe('STOPPED');
    expect((await elm.queryMode01([0x0d])).values).toEqual({ speed: 50 });
  });

  it('notices a reset banner split across reads while idle (obd-6)', async () => {
    const { elm, transport } = await connected();
    transport.push('\r\rELM3');
    transport.push('27 v1.5\r\r>');
    expect(elm.closed).toBe(true);
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('ADAPTER_RESET');
  });

  it('notices a reset banner answering an AT command (obd-6)', async () => {
    const { elm, transport } = await connected();
    const handler = transport.handler;
    transport.handler = (command) =>
      command === 'ATRV' ? reply('', 'ELM327 v1.5') : handler(command);
    expect((await errorOf(elm.readVoltage())).code).toBe('ADAPTER_RESET');
    expect(elm.closed).toBe(true);
  });

  it('notices a reset banner while resynchronising (obd-6)', async () => {
    const { elm, transport } = await connected();
    transport.handler = () => null;
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('TIMEOUT');
    transport.push('\r\rELM327 v1.5\r\r>'); // during the resync grace period
    expect(elm.closed).toBe(true);
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('ADAPTER_RESET');
  });

  it('does not wait for ever on a resync probe whose write never completes (obd-7)', async () => {
    const { elm, transport } = await connected();
    transport.handler = () => null;
    const write = transport.write.bind(transport);
    transport.write = (data) => {
      void write(data);
      return new Promise<void>(() => {}); // e.g. an rfcomm link that stopped granting credits
    };
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('TIMEOUT');
    expect((await errorOf(elm.queryMode01([0x0d]))).code).toBe('DESYNC');
    expect(elm.closed).toBe(true);
  });

  it('assumes CAN, not a legacy bus, for a headerless clone that hides its protocol (obd-10)', async () => {
    const { elm } = await connected(
      {
        '0100': ['41 00 BE 3F A8 13'],
        '0101': ['41 01 82 07 65 04'],
        '03': ['43 02 01 43 01 96'],
      },
      { ATDPN: ['?'], ATDP: ['AUTO'] },
    );
    expect(elm.info).toMatchObject({ family: 'can11', headers: false, maxPidsPerRequest: 6 });
    expect((await elm.readDtcs()).stored).toEqual(['P0143', 'P0196']);
  });

  it('takes the framing from the AT DP description when AT DPN is not understood (obd-10)', async () => {
    const { elm } = await connected(
      { '0100': ['41 00 BE 3F A8 13'] },
      { ATDPN: ['?'], ATDP: ['AUTO, ISO 15765-4 (CAN 29/500)'] },
    );
    expect(elm.info).toMatchObject({ family: 'can29', maxPidsPerRequest: 6 });
  });

  it('accepts the protocol forms the config allows (obd-12)', async () => {
    const transport = cloneAdapter(CAN_OBD);
    await new Elm327(transport, FAST).initialize({ protocol: '6A' });
    expect(transport.commands).toContain('ATSPA6');
  });
});
