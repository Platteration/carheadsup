/**
 * ELM327 driver.
 *
 * Talks to an ELM327-compatible adapter (genuine ELM327, STN11xx/STN2xxx "OBDLink", and the
 * many PIC-based clones) over any {@link Transport}:
 *
 *  - Strictly one command in flight. Each response is framed by the `>` prompt; text that
 *    arrives while no command is outstanding is discarded (an identification banner there
 *    means the adapter reset, which is fatal for the session).
 *  - Per-command timeouts. After a timeout the adapter may still be busy or its prompt may have
 *    been lost, so the driver resynchronises before the next command: it waits briefly for a
 *    late prompt, otherwise sends a harmless `AT RV` (any character interrupts a busy ELM327;
 *    unlike a bare CR it cannot repeat the previous command, and unlike `ATI` its answer cannot
 *    be mistaken for a reset banner), then waits for the line to go quiet. If that fails the
 *    session is closed with a DESYNC error.
 *  - Replies are matched to commands by the prompt alone (echo is off), so a prompt arriving
 *    after a resynchronisation has ended would shift every later reply by one. Every reply is
 *    therefore checked against its request (the service answered, the PIDs echoed, "OK" for a
 *    setting, a voltage for `AT RV`); a reply that answers something else, garbage, or
 *    "STOPPED" (this command interrupted one the adapter was still busy with) fails that
 *    command and resynchronises again instead of being returned as data.
 *  - Multi-command operations (e.g. a custom-header query and the header restore) are
 *    serialised with a lock so concurrent callers can never interleave inside them.
 */
import { parseMonitorStatus } from '@carheadsup/core';
import { ElmError, describeNrc, isElmError, isLinkFatal } from './errors.ts';
import { parseEcuMessages, parseEcuResponse, type EcuMessage } from './frames.ts';
import { bytesToHex, hexByte, hexToBytes, isHex } from './hex.ts';
import {
  answersRequest,
  collectDtcs,
  collectMode01,
  decodeVin,
  negativeResponseCode,
  positiveResponses,
  transientRefusal,
  type Mode01Result,
} from './payloads.ts';
import {
  familyFromDescription,
  getProtocol,
  inferFamily,
  maxPidsPerRequest,
  normalizeProtocolSetting,
  type ProtocolFamily,
} from './protocols.ts';
import { classifyResponse, cleanResponse, parseVoltage, type CommandKind } from './response.ts';
import { SILENT_LOGGER, SYSTEM_TIMERS, type Logger, type Timers } from './runtime.ts';
import type { Transport } from './transport.ts';

export type { Mode01Answer, Mode01Result } from './payloads.ts';

export interface Elm327Options {
  /** Default per-command timeout. Default 1000 ms. */
  timeoutMs?: number;
  /** Timeout for `ATZ` (the adapter reboots; clones take up to ~1.5 s). Default 3000 ms. */
  resetTimeoutMs?: number;
  /** Timeout for the first `0100`, during which the adapter may search every protocol. Default 20 s. */
  searchTimeoutMs?: number;
  /** Quiet period that ends a resynchronisation or the post-reset settle. Default 150 ms. */
  settleMs?: number;
  timers?: Timers;
  logger?: Logger;
}

export interface Elm327Info {
  /** Display label, e.g. "ELM327 v1.5" or "STN2255 v5.10.3 (ELM327 v1.4b)". */
  adapter: string;
  /** `ATI` answer, e.g. "ELM327 v1.5". */
  version: string | null;
  /** `AT@1` answer, e.g. "OBDII to RS232 Interpreter". */
  description: string | null;
  /** `STI` answer on STN-based adapters, null on plain ELM327s. */
  stn: string | null;
  /** Negotiated protocol number ("6"). */
  protocolId: string;
  /** Negotiated protocol description, e.g. "ISO 15765-4 (CAN 11/500)". */
  protocol: string;
  family: ProtocolFamily;
  /** Whether responses carry headers (lets multi-ECU replies be told apart). */
  headers: boolean;
  /** Whether `AT RV` works (battery voltage at the OBD port). */
  voltageSupported: boolean;
  /** PIDs per service 01 request: 6 on CAN, 1 on legacy buses. */
  maxPidsPerRequest: number;
}

export interface DtcReport {
  /** Malfunction indicator lamp, from service 01 PID 01 (any ECU). */
  milOn: boolean;
  /** Confirmed codes (service 03). */
  stored: string[];
  /** Pending codes (service 07). */
  pending: string[];
  /** Permanent codes (service 0A; empty on vehicles that predate it). */
  permanent: string[];
}

export interface RawAnswer {
  ecu: string | null;
  /** Data bytes after the positive-response service id and the echoed PID. */
  data: Uint8Array;
}

export interface ClearDtcsResult {
  ok: boolean;
  message: string;
}

interface Job {
  command: string;
  timeoutMs: number;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

/** Probe written to resynchronise after a timeout (see the module comment). */
const RESYNC_PROBE = 'ATRV\r';
/** Guard against an adapter streaming forever without a prompt (e.g. stuck in monitor mode). */
const MAX_RESPONSE_CHARS = 64 * 1024;
/** How much text outside replies is kept to spot a reset banner split across reads. */
const SIDE_TEXT_CHARS = 64;
/** A reset banner or low-voltage reset notice in text that is not a reply to `ATZ` / `ATI`. */
const RESET_TEXT_RE = /ELM327|LV RESET/i;

const noop = (): void => {};

export class Elm327 {
  private readonly transport: Transport;
  private readonly timers: Timers;
  private readonly logger: Logger;
  private timeoutMs: number;
  private readonly resetTimeoutMs: number;
  private readonly searchTimeoutMs: number;
  private readonly settleMs: number;

  private readonly jobs: Job[] = [];
  private current: { job: Job; timer: unknown } | null = null;
  private rx = '';
  /** Receives raw text while resynchronising or settling. */
  private watcher: ((chunk: string) => void) | null = null;
  private resyncing = false;
  /** Recent text received outside replies (unsolicited, or while resynchronising). */
  private sideText = '';
  private failure: ElmError | null = null;
  private lockTail: Promise<unknown> = Promise.resolve();
  private readonly unsubscribe: Array<() => void> = [];
  private _info: Elm327Info | null = null;

  constructor(transport: Transport, options: Elm327Options = {}) {
    this.transport = transport;
    this.timers = options.timers ?? SYSTEM_TIMERS;
    this.logger = options.logger ?? SILENT_LOGGER;
    this.timeoutMs = options.timeoutMs ?? 1000;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 3000;
    this.searchTimeoutMs = options.searchTimeoutMs ?? 20_000;
    this.settleMs = options.settleMs ?? 150;
    this.unsubscribe.push(
      transport.onData((chunk) => this.handleData(chunk)),
      transport.onClose((err) =>
        this.fail(
          new ElmError('CLOSED', err ? `Link lost: ${err.message}` : 'Link closed', { cause: err }),
        ),
      ),
    );
  }

  /** Adapter and protocol details, available after {@link initialize}. */
  get info(): Elm327Info | null {
    return this._info;
  }

  /** True once the session is unusable (closed, desynchronised or reset). */
  get closed(): boolean {
    return this.failure !== null;
  }

  /** Change the default per-command timeout (config updates). */
  setTimeoutMs(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.timeoutMs = ms;
  }

  // -------------------------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------------------------

  /**
   * Reset and configure the adapter, then connect to the vehicle:
   * ATZ, ATE0, ATL0, ATS0, ATH1, ATSP<protocol>, ATAT1, ATI / AT@1 / STI, 0100, ATDPN, ATDP, ATRV.
   * Optional commands a clone rejects with "?" are skipped.
   *
   * @throws ElmError — e.g. UNABLE_TO_CONNECT / NO_RESPONSE when the vehicle does not answer.
   * @throws RangeError for an invalid protocol setting.
   */
  initialize(options: { protocol: string }): Promise<Elm327Info> {
    let protocolSetting: string;
    try {
      protocolSetting = normalizeProtocolSetting(options.protocol);
    } catch (err) {
      return Promise.reject(err);
    }
    return this.exclusive(async () => {
      this._info = null;
      this.sideText = '';
      await this.settle(); // discard whatever the adapter printed when the link came up

      const banner = await this.resetAdapter();
      await this.at('ATE0', { required: true });
      await this.at('ATL0');
      await this.at('ATS0');
      const headers = (await this.at('ATH1')) !== null;
      await this.at(`ATSP${protocolSetting}`, { required: true });
      await this.at('ATAT1');

      const version = firstLine(await this.at('ATI')) ?? banner;
      const description = firstLine(await this.at('AT@1'));
      const stn = firstLine(await this.at('STI'));

      const lines0100 = await this.request('0100', 'obd', this.searchTimeoutMs);
      if (lines0100.length === 0) {
        throw new ElmError('NO_RESPONSE', 'The vehicle did not answer (NO DATA to 0100)', {
          command: '0100',
        });
      }

      const protocol = await this.detectProtocol(protocolSetting, lines0100);
      const effectiveHeaders = headers && this.headersVisible(lines0100, protocol.family);
      const voltage = parseVoltage((await this.at('ATRV')) ?? []);

      const info: Elm327Info = {
        adapter: adapterLabel(version, stn),
        version,
        description,
        stn,
        protocolId: protocol.id,
        protocol: protocol.name,
        family: protocol.family,
        headers: effectiveHeaders,
        voltageSupported: voltage !== null,
        maxPidsPerRequest: maxPidsPerRequest(protocol.family),
      };
      this._info = info;
      this.logger.info(`OBD: ${info.adapter} connected via ${info.protocol}`);
      return info;
    });
  }

  /** ATZ, retried once; returns the identification banner if one was printed. */
  private async resetAdapter(): Promise<string | null> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const lines = await this.request('ATZ', 'at', this.resetTimeoutMs);
        await this.settle();
        return lines.find((line) => /ELM|STN|OBD/i.test(line)) ?? null;
      } catch (err) {
        if (isLinkFatal(err)) throw err;
        lastError = err;
        this.logger.warn(`OBD: ATZ failed (${String(err)}), retrying`);
      }
    }
    const code = isElmError(lastError) ? lastError.code : 'TIMEOUT';
    throw new ElmError(code, 'The adapter did not respond to ATZ (check power and pairing)', {
      command: 'ATZ',
      cause: lastError,
    });
  }

  private async detectProtocol(
    setting: string,
    lines0100: readonly string[],
  ): Promise<{ id: string; name: string; family: ProtocolFamily }> {
    const dpn = firstLine(await this.at('ATDPN'));
    const fromDpn = dpn ? getProtocol(dpn) : undefined;
    const fromSetting = setting === '0' ? undefined : getProtocol(setting);
    const known = fromDpn ?? fromSetting;
    const dp = firstLine(await this.at('ATDP'));
    const described = dp?.replace(/^AUTO,\s*/i, '').trim() || null;
    if (known) {
      return { id: known.id, name: described ?? known.name, family: known.family };
    }
    // Without headers the 0100 answer looks the same on every bus; CAN is by far the most
    // common (every car since 2008), so it is the default when nothing else tells.
    const family = familyFromDescription(described) ?? inferFamily(lines0100) ?? 'can11';
    this.logger.warn(`OBD: adapter did not report its protocol; assuming ${family}`);
    return { id: '0', name: described ?? 'Unknown protocol', family };
  }

  /** Whether the 0100 answer really carries headers (some clones ignore ATH1). */
  private headersVisible(lines: readonly string[], family: ProtocolFamily): boolean {
    const withHeaders = parseEcuMessages(lines, { family, headers: true });
    const hasId = withHeaders.some((m) => m.ecu !== null && m.data[0] === 0x41);
    if (!hasId) this.logger.warn('OBD: adapter does not show headers; ECUs cannot be separated');
    return hasId;
  }

  // -------------------------------------------------------------------------------------------
  // Public operations
  // -------------------------------------------------------------------------------------------

  /**
   * Send one raw command and return its cleaned data lines ([] for NO DATA).
   * @throws ElmError for adapter error messages, timeouts and link failures.
   */
  command(command: string, timeoutMs?: number): Promise<string[]> {
    const kind: CommandKind = /^(AT|ST)/i.test(command.trim()) ? 'at' : 'obd';
    return this.exclusive(() => this.request(command.trim(), kind, timeoutMs));
  }

  /**
   * Query service 01 PIDs (up to 6 per request on CAN, 1 on legacy protocols).
   * Unanswered PIDs are simply absent from the result ("NO DATA" is not an error).
   */
  queryMode01(pids: readonly number[]): Promise<Mode01Result> {
    const limit = this._info?.maxPidsPerRequest ?? 6;
    if (pids.length === 0 || pids.length > limit) {
      return Promise.reject(new RangeError(`Service 01 requests take 1–${limit} PIDs`));
    }
    if (new Set(pids).size !== pids.length || !pids.every(isByteValue)) {
      return Promise.reject(new RangeError(`Invalid PID list ${JSON.stringify(pids)}`));
    }
    return this.exclusive(async () => {
      const messages = await this.obd(`01${pids.map(hexByte).join('')}`, { pids });
      return collectMode01(messages, pids);
    });
  }

  /**
   * Read MIL status (0101) and stored (03), pending (07) and permanent (0A) codes. The report
   * replaces the HUD's code list, so it must be complete: a control unit that answered only
   * with a transient refusal (busy …), a multi-frame answer that lost a frame, or a unit that
   * counts confirmed codes in 0101 but did not answer 03 fails the read instead of reporting
   * "no codes". A permanent refusal (service not supported, as older vehicles answer 0A) is
   * an answer: that unit has nothing to report.
   *
   * @throws ElmError NEGATIVE_RESPONSE / MALFORMED for an incomplete read (retry later).
   */
  readDtcs(): Promise<DtcReport> {
    return this.exclusive(async () => {
      const hasCountByte = this.family !== 'legacy';
      const monitors = positiveResponses(await this.obd('0101', { pids: [0x01] }), 0x01).map(
        (m) => ({ ecu: m.ecu, status: parseMonitorStatus(m.data.slice(2)) }),
      );
      const milOn = monitors.some((m) => m.status?.milOn === true);
      const storedAnswer = await this.dtcAnswer('03');
      const listed = new Set(positiveResponses(storedAnswer, 0x03).map((m) => m.ecu));
      for (const { ecu, status } of monitors) {
        const count = status?.dtcCount ?? 0;
        if (count > 0 && !(ecu === null ? listed.size > 0 : listed.has(ecu))) {
          const unit = ecu === null ? 'A control unit' : `Control unit ${ecu}`;
          throw new ElmError('MALFORMED', `${unit} counts ${count} trouble code(s) but sent none`, {
            command: '03',
          });
        }
      }
      const stored = collectDtcs(storedAnswer, 0x03, hasCountByte);
      const pending = collectDtcs(await this.dtcAnswer('07'), 0x07, hasCountByte);
      // Service 0A only exists on 2010+ vehicles; older ones answer NO DATA or refuse it.
      const permanent = collectDtcs(await this.dtcAnswer('0A'), 0x0a, hasCountByte);
      return { milOn, stored, pending, permanent };
    });
  }

  /** Clear trouble codes and freeze frames (service 04). */
  clearDtcs(): Promise<ClearDtcsResult> {
    return this.exclusive(async () => {
      const messages = await this.obd('04', { timeoutMs: Math.max(this.timeoutMs, 5000) });
      const acknowledged = positiveResponses(messages, 0x04).length;
      const nrc = negativeResponseCode(messages, 0x04);
      if (nrc !== null) {
        // Any refusal means codes may remain, even if another control unit acknowledged.
        const refusedBy = messages.filter((m) => m.data[0] === 0x7f && m.data[2] !== 0x78);
        const who = refusedBy.map((m) => m.ecu).filter((ecu) => ecu !== null);
        const prefix = acknowledged > 0 ? 'Codes only partly cleared: ' : '';
        const unit = who.length > 0 ? `control unit ${who.join(', ')}` : 'the vehicle';
        return { ok: false, message: `${prefix}${unit} refused (${describeNrc(nrc)})` };
      }
      if (acknowledged > 0) {
        return {
          ok: true,
          message:
            acknowledged === 1
              ? 'Trouble codes cleared'
              : `Trouble codes cleared (${acknowledged} control units)`,
        };
      }
      return { ok: false, message: 'No control unit acknowledged the clear request' };
    });
  }

  /** Read the VIN (service 09 PID 02), or null when the vehicle does not provide it. */
  readVin(): Promise<string | null> {
    return this.exclusive(async () =>
      decodeVin(
        await this.obd('0902', { timeoutMs: Math.max(this.timeoutMs, 3000), pids: [0x02] }),
      ),
    );
  }

  /** Battery voltage at the OBD port (`AT RV`), or null when unsupported. */
  readVoltage(): Promise<number | null> {
    return this.exclusive(async () => {
      const lines = await this.at('ATRV');
      const volts = parseVoltage(lines ?? []);
      // Neither a voltage nor "?": the reply to some other command.
      if (volts === null && lines !== null) this.beginResync('unexpected answer to ATRV');
      return volts;
    });
  }

  /**
   * Send an arbitrary request (e.g. manufacturer PIDs, service 22) and return the data after
   * the echoed service and PID for every ECU that answered positively. With a header the
   * request is sent with `AT SH` (plus a receive filter for non-OBD 11-bit ids) and the default
   * header is restored afterwards — also when setting the header fails part-way, since the
   * adapter may have applied it anyway (e.g. its "OK" was lost); a failed restore closes the
   * session, since later requests would otherwise go to the wrong module.
   *
   * @throws ElmError NEGATIVE_RESPONSE when every answer was negative.
   * @throws RangeError for malformed mode / PID / header strings.
   */
  raw(mode: string, pidHex: string, header?: string | null): Promise<RawAnswer[]> {
    const modeText = mode.trim().toUpperCase();
    const pidText = pidHex.trim().toUpperCase();
    if (modeText.length !== 2 || !isHex(modeText)) {
      return Promise.reject(new RangeError(`Invalid mode ${JSON.stringify(mode)}`));
    }
    if (pidText.length > 8 || pidText.length % 2 !== 0 || (pidText.length > 0 && !isHex(pidText))) {
      return Promise.reject(new RangeError(`Invalid PID ${JSON.stringify(pidHex)}`));
    }
    const headerText = header?.replace(/\s+/g, '').toUpperCase() || null;
    return this.exclusive(async () => {
      const restore: string[] = [];
      let messages: EcuMessage[];
      try {
        if (headerText) await this.applyHeader(headerText, restore);
        messages = await this.obd(`${modeText}${pidText}`);
      } finally {
        await this.restoreHeader(restore);
      }
      const service = parseInt(modeText, 16);
      const echo = pidText.length > 0 ? hexToBytes(pidText) : new Uint8Array(0);
      const answers: RawAnswer[] = [];
      for (const message of positiveResponses(messages, service)) {
        const echoed = message.data.slice(1, 1 + echo.length);
        if (bytesToHex(echoed) !== bytesToHex(echo)) continue;
        answers.push({ ecu: message.ecu, data: message.data.slice(1 + echo.length) });
      }
      if (answers.length === 0) {
        const nrc = negativeResponseCode(messages, service);
        if (nrc !== null) {
          throw new ElmError('NEGATIVE_RESPONSE', `${modeText} ${pidText}: ${describeNrc(nrc)}`, {
            command: `${modeText}${pidText}`,
            nrc,
          });
        }
      }
      return answers;
    });
  }

  /** Close the session and the transport. Pending commands reject with CLOSED. */
  async close(): Promise<void> {
    this.fail(new ElmError('CLOSED', 'Link closed'), false);
    for (const off of this.unsubscribe.splice(0)) off();
    await this.transport.close();
  }

  // -------------------------------------------------------------------------------------------
  // Header handling
  // -------------------------------------------------------------------------------------------

  private get family(): ProtocolFamily {
    return this._info?.family ?? 'can11';
  }

  /**
   * Set a request header. Before each command is sent, the command undoing it is added to
   * `restore`, so that whatever the adapter may have applied is undone even if a later step
   * (or the reply to this one) fails. A command the adapter rejected with "?" changed nothing
   * and needs no undoing.
   *
   * @throws RangeError before sending anything when the header does not suit the protocol.
   */
  private async applyHeader(header: string, restore: string[]): Promise<void> {
    const info = this._info;
    const protocol = info ? getProtocol(info.protocolId) : undefined;
    const steps: Array<{ command: string; undo: string }> = [];

    const family = this.family;
    if (family === 'can11') {
      if (!/^[0-7][0-9A-F]{2}$/.test(header)) {
        throw new RangeError(`Header ${header} is not an 11-bit CAN id`);
      }
      steps.push({ command: `ATSH${header}`, undo: `ATSH${protocol?.defaultHeader ?? '7DF'}` });
      const id = parseInt(header, 16);
      // The adapter only listens to 7E8–7EF by default; other modules answer on id + 8.
      if (id !== 0x7df && (id < 0x7e0 || id > 0x7e7)) {
        const filter = (id + 8).toString(16).toUpperCase().padStart(3, '0');
        steps.push({ command: `ATCRA${filter}`, undo: 'ATCRA' });
      }
    } else if (family === 'can29') {
      if (!/^([0-9A-F]{2})?[0-9A-F]{6}$/.test(header)) {
        throw new RangeError(`Header ${header} is not a 29-bit CAN id`);
      }
      if (header.length === 8) {
        steps.push({ command: `ATCP${header.slice(0, 2)}`, undo: 'ATCP18' });
      }
      steps.push({
        command: `ATSH${header.slice(-6)}`,
        undo: `ATSH${(protocol?.defaultHeader ?? '18DB33F1').slice(-6)}`,
      });
    } else {
      if (!/^[0-9A-F]{6}$/.test(header)) {
        throw new RangeError(`Header ${header} is not a 3-byte header`);
      }
      steps.push({ command: `ATSH${header}`, undo: `ATSH${protocol?.defaultHeader ?? '686AF1'}` });
    }

    for (const { command, undo } of steps) {
      restore.push(undo);
      try {
        await this.at(command, { required: true });
      } catch (err) {
        if (isElmError(err, 'UNSUPPORTED')) restore.pop();
        throw err;
      }
    }
  }

  /** Undo {@link applyHeader}. A failure closes the session (see {@link raw}). */
  private async restoreHeader(commands: readonly string[]): Promise<void> {
    // A dead session needs no restoring; its own error says more than a failed restore would.
    if (commands.length === 0 || this.failure) return;
    try {
      for (const command of commands) {
        if (command === 'ATCRA') {
          // Older clones lack the argument-less form; AT AR also re-enables auto filtering.
          if ((await this.at('ATCRA')) === null) await this.at('ATAR', { required: true });
        } else {
          await this.at(command, { required: true });
        }
      }
    } catch (err) {
      const failure = new ElmError(
        'DESYNC',
        `Could not restore the default header: ${String(err)}`,
        {
          cause: err,
        },
      );
      this.fail(failure);
      throw failure;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Request helpers (callers hold the lock)
  // -------------------------------------------------------------------------------------------

  /**
   * An AT command. Returns its lines, or null when the adapter rejected it ("?", garbage or
   * a timeout) and `required` is false.
   */
  private async at(
    command: string,
    options: { required?: boolean } = {},
  ): Promise<string[] | null> {
    try {
      const lines = await this.request(command, 'at');
      if (options.required && isSetter(command) && !lines.some((l) => /OK/i.test(l))) {
        // "?" was raised as UNSUPPORTED above; anything else is another command's reply.
        this.beginResync(`unexpected answer to ${command}`);
        throw new ElmError('MALFORMED', `Unexpected answer to ${command}: ${lines.join(' | ')}`, {
          command,
          response: lines,
        });
      }
      return lines;
    } catch (err) {
      if (options.required || isLinkFatal(err) || !isElmError(err)) throw err;
      this.logger.debug(`OBD: optional ${command} failed: ${err.message}`);
      return null;
    }
  }

  /**
   * An OBD request parsed into ECU messages ([] for NO DATA). Every message must answer the
   * request's service (and one of `pids`, when given); `complete` also rejects an answer that
   * lost frames on the way.
   */
  private async obd(
    command: string,
    options: { timeoutMs?: number; pids?: readonly number[]; complete?: boolean } = {},
  ): Promise<EcuMessage[]> {
    const lines = await this.request(command, 'obd', options.timeoutMs);
    if (lines.length === 0) return [];
    const { messages, dropped } = parseEcuResponse(lines, {
      family: this.family,
      headers: this._info?.headers ?? true,
    });
    const service = parseInt(command.slice(0, 2), 16);
    if (messages.length === 0 || !answersRequest(messages, service, options.pids)) {
      // Garbage, or the reply to another request: the replies may be out of step with the
      // commands, so resynchronise before the next command rather than trust the next reply.
      this.beginResync(`unexpected answer to ${command}`);
      const what = messages.length === 0 ? 'Unparseable' : 'Mismatched';
      throw new ElmError('MALFORMED', `${what} response to ${command}: ${lines.join(' | ')}`, {
        command,
        response: lines,
      });
    }
    if (options.complete && dropped > 0) {
      throw new ElmError(
        'MALFORMED',
        `Incomplete response to ${command} (${dropped} frame(s) lost): ${lines.join(' | ')}`,
        { command, response: lines },
      );
    }
    return messages;
  }

  /**
   * The complete answer to a trouble-code service from every control unit that responded
   * (see {@link readDtcs}).
   */
  private async dtcAnswer(command: '03' | '07' | '0A'): Promise<EcuMessage[]> {
    const messages = await this.obd(command, { complete: true });
    const refusal = transientRefusal(messages, parseInt(command, 16));
    if (refusal) {
      const unit = refusal.ecu === null ? 'a control unit' : `control unit ${refusal.ecu}`;
      throw new ElmError(
        'NEGATIVE_RESPONSE',
        `Trouble codes (${command}): ${unit} refused (${describeNrc(refusal.nrc)})`,
        { command, nrc: refusal.nrc },
      );
    }
    return messages;
  }

  private async request(command: string, kind: CommandKind, timeoutMs?: number): Promise<string[]> {
    const text = await this.enqueue(command, timeoutMs ?? this.timeoutMs);
    try {
      return classifyResponse(cleanResponse(text, command), command, kind);
    } catch (err) {
      if (isLinkFatal(err) && isElmError(err)) this.fail(err);
      // "STOPPED": this command interrupted one the adapter was still busy with, so the
      // replies are behind the commands and this command's own reply is still to come.
      else if (isElmError(err, 'STOPPED')) this.beginResync(`${command} interrupted the adapter`);
      throw err;
    }
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lockTail.then(fn, fn);
    this.lockTail = run.then(noop, noop);
    return run;
  }

  // -------------------------------------------------------------------------------------------
  // Command queue and framing
  // -------------------------------------------------------------------------------------------

  private enqueue(command: string, timeoutMs: number): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.jobs.push({ command, timeoutMs, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || this.resyncing || this.failure) return;
    const job = this.jobs.shift();
    if (!job) return;
    this.rx = '';
    const timer = this.timers.setTimeout(() => this.onTimeout(job), job.timeoutMs);
    this.current = { job, timer };
    this.logger.debug(`OBD → ${job.command}`);
    this.transport.write(`${job.command}\r`).catch((err: unknown) => {
      this.fail(new ElmError('CLOSED', `Write failed: ${String(err)}`, { cause: err }));
    });
  }

  private handleData(chunk: string): void {
    const text = chunk.replace(/\0/g, '');
    if (text.length === 0) return;
    if (this.watcher) {
      // After initialisation nothing sent while resynchronising prints a banner (the settle
      // after ATZ is not a resynchronisation), so one means the adapter reset.
      if (this.resyncing && this._info !== null && this.noticeReset(text)) return;
      this.watcher(text);
      return;
    }
    const current = this.current;
    if (!current) {
      this.onUnsolicited(text);
      return;
    }
    this.rx += text;
    const prompt = this.rx.indexOf('>');
    if (prompt < 0) {
      if (this.rx.length > MAX_RESPONSE_CHARS) {
        this.fail(new ElmError('BUFFER_FULL', 'The adapter sent too much data without a prompt'));
      }
      return;
    }
    const response = this.rx.slice(0, prompt);
    const rest = this.rx.slice(prompt + 1);
    this.rx = '';
    this.current = null;
    this.timers.clearTimeout(current.timer);
    this.logger.debug(`OBD ← ${JSON.stringify(response)}`);
    current.job.resolve(response);
    if (rest.trim().length > 0) this.onUnsolicited(rest);
    this.pump();
  }

  private onUnsolicited(text: string): void {
    if (this.noticeReset(text)) return;
    this.logger.debug(`OBD: discarded unsolicited ${JSON.stringify(text)}`);
  }

  /**
   * Fail the session if text received outside a reply shows the adapter reset. The banner
   * may arrive split across reads, so the recent text is examined as a whole.
   */
  private noticeReset(text: string): boolean {
    this.sideText = (this.sideText + text).slice(-SIDE_TEXT_CHARS);
    if (!RESET_TEXT_RE.test(this.sideText)) return false;
    const shown = this.sideText.replace(/\s+/g, ' ').trim();
    this.fail(new ElmError('ADAPTER_RESET', `The adapter reset unexpectedly (${shown})`));
    return true;
  }

  private onTimeout(job: Job): void {
    if (this.current?.job !== job) return;
    this.current = null;
    this.rx = '';
    job.reject(
      new ElmError('TIMEOUT', `No response to ${job.command} within ${job.timeoutMs} ms`, {
        command: job.command,
      }),
    );
    this.beginResync(`no response to ${job.command}`);
  }

  /** Hold further commands until the adapter is back at an idle prompt (see {@link resync}). */
  private beginResync(reason: string): void {
    if (this.resyncing || this.failure) return;
    this.logger.debug(`OBD: out of step (${reason})`);
    this.resyncing = true;
    this.resync().then(
      () => {
        this.resyncing = false;
        this.pump();
      },
      (err: unknown) => {
        this.resyncing = false;
        this.fail(isElmError(err) ? err : new ElmError('DESYNC', String(err), { cause: err }));
      },
    );
  }

  /** Bring the adapter back to an idle prompt (see the module comment). */
  private async resync(): Promise<void> {
    const grace = Math.min(this.timeoutMs, 300);
    if (!(await this.waitFor((text) => text.includes('>'), grace))) {
      this.logger.debug('OBD: resynchronising');
      // Watch before writing: a fast adapter may answer before write() resolves.
      const prompt = this.waitFor((text) => text.includes('>'), Math.max(this.timeoutMs, 1000));
      // Not awaited, like every command write: a write that never completes (a stalled
      // Bluetooth link) must not hold the queue forever; the prompt deadline covers it.
      this.transport.write(RESYNC_PROBE).catch((err: unknown) => {
        this.fail(new ElmError('CLOSED', `Write failed: ${String(err)}`, { cause: err }));
      });
      if (!(await prompt)) throw new ElmError('DESYNC', 'The adapter stopped responding');
    }
    await this.waitQuiet(this.settleMs, Math.max(this.timeoutMs, 1000));
  }

  /** Discard input until the line has been quiet for `settleMs`. */
  private settle(): Promise<void> {
    return this.waitQuiet(this.settleMs, Math.max(this.resetTimeoutMs, 1000));
  }

  private waitFor(predicate: (received: string) => boolean, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let received = '';
      const done = (result: boolean): void => {
        this.timers.clearTimeout(timer);
        if (this.watcher === watch) this.watcher = null;
        resolve(result);
      };
      const watch = (chunk: string): void => {
        received += chunk;
        if (predicate(received)) done(true);
      };
      const timer = this.timers.setTimeout(() => done(false), ms);
      this.watcher = watch;
      if (this.failure) done(false);
    });
  }

  /** Resolve once no data has arrived for `quietMs` (or after `maxMs` regardless). */
  private waitQuiet(quietMs: number, maxMs: number): Promise<void> {
    return new Promise((resolve) => {
      let quietTimer: unknown = null;
      const finish = (): void => {
        this.timers.clearTimeout(quietTimer);
        this.timers.clearTimeout(maxTimer);
        if (this.watcher === watch) this.watcher = null;
        resolve();
      };
      const arm = (): void => {
        if (quietTimer !== null) this.timers.clearTimeout(quietTimer);
        quietTimer = this.timers.setTimeout(finish, quietMs);
      };
      const watch = (): void => arm();
      const maxTimer = this.timers.setTimeout(finish, maxMs);
      this.watcher = watch;
      arm();
    });
  }

  /** Mark the session dead: reject everything outstanding and close the transport. */
  private fail(err: ElmError, closeTransport = true): void {
    if (this.failure) return;
    this.failure = err;
    this.watcher = null;
    if (err.code !== 'CLOSED' || closeTransport) this.logger.warn(`OBD: ${err.message}`);
    const current = this.current;
    this.current = null;
    if (current) {
      this.timers.clearTimeout(current.timer);
      current.job.reject(err);
    }
    for (const job of this.jobs.splice(0)) job.reject(err);
    if (closeTransport) {
      this.transport.close().catch((closeErr: unknown) => {
        this.logger.debug(`OBD: error while closing the transport: ${String(closeErr)}`);
      });
    }
  }
}

function firstLine(lines: readonly string[] | null): string | null {
  return lines?.[0]?.trim() || null;
}

function adapterLabel(version: string | null, stn: string | null): string {
  if (stn) return version ? `${stn} (${version})` : stn;
  return version ?? 'ELM327 (unidentified)';
}

/** AT commands that only change a setting answer "OK". */
function isSetter(command: string): boolean {
  return !/^AT(Z|I|@\d|RV|DPN?|WS)$/i.test(command) && !/^ST/i.test(command);
}

function isByteValue(pid: number): boolean {
  return Number.isInteger(pid) && pid >= 0 && pid <= 0xff;
}
