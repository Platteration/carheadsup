/**
 * PID polling scheduler.
 *
 * After discovering which PIDs the vehicle supports (0100 → 0120 → … while the continuation
 * bit is set, union across ECUs), the poller runs cycles back to back, at most one per
 * `cycleIntervalMs`:
 *
 *  - fast tier (speed, rpm, throttle, pedal, MAF — or MAP without MAF —, fuel rate) every cycle;
 *  - medium (~1 s), slow (~5 s) and very slow (~10 s) tiers, earliest-deadline-first within a
 *    budget of extra requests per cycle, so a burst of due PIDs is spread over several cycles
 *    and no PID is ever starved;
 *  - custom PIDs (Torque-style formulas) at their own intervals, earliest-deadline-first within
 *    their own small budget per cycle (a custom PID behind a header costs five adapter round
 *    trips, so a long list must not hold up the fast tier); battery voltage (AT RV) every
 *    2 s; trouble codes right after connecting and every `dtcIntervalMs`; the VIN once.
 *
 * Service 01 requests carry up to six PIDs on CAN. A PID that keeps answering NO DATA while
 * others answer is backed off exponentially; when nothing answers at all (ignition off) the
 * poller drops to a slow probe instead and reports it on the link. The values a request
 * returns are emitted as an `obd/samples` event as soon as it completes, stamped with the
 * injected clock at that moment: a slow request later in the cycle must not make them look
 * fresher than they are (the HUD server also stamps events on arrival).
 *
 * Adapters that cannot take multi-PID requests: a request of six PIDs needs an answer longer
 * than one CAN frame, which clones without working ISO-TP flow control fail to receive. When
 * multi-PID requests keep failing for the same PIDs while a single-PID request for one of them
 * works, requests get smaller — six, then three, then two PIDs whose answer fits one frame,
 * then one — with a warning on the link.
 *
 * One PID per request (legacy K-line / J1850 buses, or after falling back): every request costs
 * a bus round trip (150–250 ms on ISO 9141), so only speed, rpm and the fuel-flow PID stay in
 * the fast tier (throttle and pedal join the medium one); trouble codes (four requests) and the
 * VIN are read in a cycle of their own with only speed and rpm, and put off while the vehicle
 * moves (for at most `maxReadDeferralMs`), so speed never goes stale while they are read.
 *
 * When a trouble-code read fails (e.g. a clone that cannot receive a long service 03 answer),
 * the MIL state is still read on its own (service 01 PID 01, one frame) and reported as an
 * incomplete `obd/dtcs` (`complete: false`), so a lit check-engine lamp is never missed.
 */
import {
  MODE01_PIDS,
  SIGNAL_IDS,
  compileFormula,
  isSupportedPidsQuery,
  nextSupportedPidsBase,
  parseMonitorStatus,
  parseSupportedPids,
  signalsForPids,
  type CustomPidConfig,
  type HudEvent,
  type SignalId,
} from '@carheadsup/core';
import type { DtcReport, RawAnswer } from './elm327.ts';
import { ElmError, isElmError, isLinkFatal, isVehicleSilence } from './errors.ts';
import { MODE01_DATA_LENGTHS, VARIABLE_LENGTH_PIDS, type Mode01Result } from './payloads.ts';
import {
  SILENT_LOGGER,
  SYSTEM_CLOCK,
  SYSTEM_TIMERS,
  Sleeper,
  errorMessage,
  type Clock,
  type Logger,
  type Timers,
} from './runtime.ts';

/** What the poller needs from a driver ({@link Elm327} implements it). */
export interface PollerDriver {
  queryMode01(pids: readonly number[]): Promise<Mode01Result>;
  readDtcs(): Promise<DtcReport>;
  readVin(): Promise<string | null>;
  readVoltage(): Promise<number | null>;
  raw(mode: string, pid: string, header?: string | null): Promise<RawAnswer[]>;
}

export interface PollerTuning {
  /** Minimum time between cycle starts. */
  cycleIntervalMs: number;
  mediumIntervalMs: number;
  slowIntervalMs: number;
  verySlowIntervalMs: number;
  voltageIntervalMs: number;
  /** Service 01 requests for non-fast PIDs per cycle. */
  extraRequestsPerCycle: number;
  /** Custom-PID requests per cycle (at least 1). */
  customRequestsPerCycle: number;
  /** Consecutive NO DATA answers before a PID is backed off. */
  backoffAfterEmpty: number;
  maxBackoffMs: number;
  /** Cycles without any answer before switching to the slow probe. */
  silentAfterCycles: number;
  silentProbeIntervalMs: number;
  /**
   * Consecutive failed requests (errors, not NO DATA) before giving up on the session. Only
   * an answer from the vehicle resets the count: the adapter answering AT RV says nothing
   * about the vehicle link.
   */
  maxConsecutiveErrors: number;
  /** Retry delay after a failed DTC read. */
  dtcRetryMs: number;
  vinRetryMs: number;
  vinAttempts: number;
  /**
   * Consecutive failed multi-PID requests including the same PID (with no answer for it in
   * between) before requests are made smaller.
   */
  batchFailuresBeforeStepDown: number;
  /**
   * With one PID per request, trouble-code and VIN reads wait while the vehicle moves — but no
   * longer than this.
   */
  maxReadDeferralMs: number;
}

export const DEFAULT_POLLER_TUNING: Readonly<PollerTuning> = Object.freeze({
  cycleIntervalMs: 100,
  mediumIntervalMs: 1000,
  slowIntervalMs: 5000,
  verySlowIntervalMs: 10_000,
  voltageIntervalMs: 2000,
  extraRequestsPerCycle: 2,
  customRequestsPerCycle: 1,
  backoffAfterEmpty: 3,
  maxBackoffMs: 60_000,
  silentAfterCycles: 3,
  silentProbeIntervalMs: 2000,
  maxConsecutiveErrors: 8,
  dtcRetryMs: 5000,
  vinRetryMs: 60_000,
  vinAttempts: 3,
  batchFailuresBeforeStepDown: 3,
  maxReadDeferralMs: 300_000,
});

/** What discovery found: reused when reconnecting to the same vehicle. */
export interface PollerDiscovery {
  /** Supported service 01 PIDs (bitmap PIDs excluded). */
  readonly supported: readonly number[];
  /** PIDs per request after the multi-PID checks. */
  readonly pidsPerRequest: number;
  /** Whether multi-PID answers had to fit one frame. */
  readonly singleFrame: boolean;
  /** Whether the VIN has been read (or the vehicle reported none). */
  readonly vinRead: boolean;
}

export interface PollerOptions {
  /** PIDs per service 01 request (6 on CAN, 1 on legacy protocols). Default 6. */
  maxPidsPerRequest?: number;
  /**
   * An earlier discovery on this vehicle (see {@link ObdPoller.discovery}): `discover` then
   * skips the walk through the supported-PID bitmaps and the multi-PID probe, and the VIN is
   * not read again — several seconds on a K-line bus.
   */
  discovered?: PollerDiscovery;
  /** Whether the adapter answers AT RV. Default true. */
  voltageSupported?: boolean;
  customPids?: readonly CustomPidConfig[];
  /** Default 30 s. */
  dtcIntervalMs?: number;
  /** Adapter/protocol labels repeated in the poller's `obd/link` events. */
  link?: { adapter: string | null; protocol: string | null };
  now?: Clock;
  timers?: Timers;
  logger?: Logger;
  tuning?: Partial<PollerTuning>;
}

type Tier = 'fast' | 'medium' | 'slow' | 'verySlow';

interface Scheduled {
  intervalMs: number;
  dueAt: number;
  /** Consecutive polls without an answer. */
  empty: number;
}

interface PidItem extends Scheduled {
  pid: number;
  tier: Tier;
  /** Consecutive failed multi-PID requests that included this PID (see `noteBatchFailure`). */
  batchFailures: number;
}

interface CustomItem extends Scheduled {
  config: CustomPidConfig;
  key: string;
  evaluate: (data: Uint8Array) => number;
}

interface CycleOutcome {
  requests: number;
  answered: number;
}

const FAST_PIDS: readonly number[] = [0x0d, 0x0c, 0x11, 0x49, 0x5e];
/** Speed and rpm: polled every cycle even when every PID costs a request of its own. */
const PRIMARY_PIDS: ReadonlySet<number> = new Set([0x0d, 0x0c]);
const MAF_PID = 0x10;
const MAP_PID = 0x0b;
/** Where the fuel flow comes from, in the order the estimator prefers them. */
const FUEL_FLOW_PIDS: readonly number[] = [0x5e, MAF_PID, MAP_PID];
/**
 * PIDs behind a safety alert, with the age at which their reading goes before every other
 * due PID: coolant (the overheating alert; its readings go stale after 10 s).
 */
const KEEP_FRESH_MS: ReadonlyMap<number, number> = new Map([[0x05, 3000]]);
/** Monitor status (MIL and code count), read on its own when a trouble-code read fails. */
const MIL_PID = 0x01;
/** Largest service 01 answer (service byte + PIDs + data) that fits one CAN frame. */
const SINGLE_FRAME_BYTES = 7;
/** A speed sample older than this does not tell whether the vehicle is moving. */
const MOVING_SAMPLE_MAX_AGE_MS = 5000;
const MEDIUM_PIDS: readonly number[] = [0x05, 0x0f, 0x04, 0x43, 0x44, 0xa4, 0x0e, 0x45];
const VERY_SLOW_PIDS: readonly number[] = [0x2f, 0x46, 0xa6];
const TIER_RANK: Readonly<Record<Tier, number>> = { fast: 0, medium: 1, slow: 2, verySlow: 3 };
const DECODABLE_PIDS: ReadonlySet<number> = new Set(MODE01_PIDS.map((d) => d.pid));

const customKey = (c: CustomPidConfig): string =>
  `${c.mode}:${c.pid}:${c.header ?? ''}:${c.signal}:${c.formula}`.toUpperCase();

/** Bytes of a PID's answer (PID byte + data); variable-length PIDs count at their longest. */
const answerBytesOf = (pid: number): number =>
  1 + (MODE01_DATA_LENGTHS.get(pid) ?? 4) + (VARIABLE_LENGTH_PIDS.has(pid) ? 1 : 0);

/** Bytes of one ECU's answer to a service 01 request for `pids` (all answered). */
const answerBytes = (pids: Iterable<number>): number => {
  let total = 1;
  for (const pid of pids) total += answerBytesOf(pid);
  return total;
};

type SlowRead = 'dtc' | 'vin';

export class ObdPoller {
  private readonly driver: PollerDriver;
  private readonly emit: (event: HudEvent) => void;
  private readonly now: Clock;
  private readonly logger: Logger;
  private readonly tuning: PollerTuning;
  private readonly sleeper: Sleeper;
  private readonly link: { adapter: string | null; protocol: string | null };
  private readonly voltageSupported: boolean;
  private maxPids: number;
  /** Largest answer (bytes) a multi-PID request may need, or null for no limit. */
  private answerBudget: number | null = null;
  /** Why requests carry fewer PIDs than the bus allows (shown on the link), or null. */
  private degraded: string | null = null;
  private dtcIntervalMs: number;
  /** A trouble-code read was asked for explicitly (it is not put off while moving). */
  private dtcRequested = false;
  /** Since when a due trouble-code / VIN read has been put off while moving. */
  private readonly deferredSince: Record<SlowRead, number | null> = { dtc: null, vin: null };

  private supported: number[] | null = null;
  private pidItems: PidItem[] = [];
  private customItems: CustomItem[] = [];
  private customSignals = new Set<SignalId>();
  /** The signal list last emitted as `obd/supported`. */
  private announcedSignals: string | null = null;
  private voltageDueAt = 0;
  private dtcDueAt = 0;
  private lastDtcReadAt: number | null = null;
  private vin: { attempts: number; dueAt: number; done: boolean; read: boolean } = {
    attempts: 0,
    dueAt: 0,
    done: false,
    read: false,
  };
  private discovered: PollerDiscovery | null;
  private silent = false;
  private silentCycles = 0;
  private consecutiveErrors = 0;
  private running = false;
  private stopped = false;
  private readonly latestSamples = new Map<SignalId, { value: number; at: number }>();

  constructor(driver: PollerDriver, options: PollerOptions, emit: (event: HudEvent) => void) {
    this.driver = driver;
    this.emit = (event) => {
      try {
        emit(event);
      } catch (err) {
        // A misbehaving consumer must not stop the polling loop.
        this.logger.error(`OBD: event handler failed: ${errorMessage(err)}`);
      }
    };
    this.now = options.now ?? SYSTEM_CLOCK;
    this.logger = options.logger ?? SILENT_LOGGER;
    this.tuning = { ...DEFAULT_POLLER_TUNING, ...options.tuning };
    this.sleeper = new Sleeper(options.timers ?? SYSTEM_TIMERS);
    this.link = options.link ?? { adapter: null, protocol: null };
    this.voltageSupported = options.voltageSupported ?? true;
    this.maxPids = Math.max(1, Math.floor(options.maxPidsPerRequest ?? 6));
    this.dtcIntervalMs = Math.max(1000, options.dtcIntervalMs ?? 30_000);
    this.discovered = options.discovered ?? null;
    this.setCustomPids(options.customPids ?? []);
  }

  /** Supported service 01 PIDs (bitmap PIDs excluded), or null before discovery. */
  get supportedPids(): readonly number[] | null {
    return this.supported;
  }

  /**
   * PIDs per service 01 request in use: it drops (6 → 3 → 2 → 1) when the ECU or the adapter
   * cannot handle multi-PID requests.
   */
  get pidsPerRequest(): number {
    return this.maxPids;
  }

  /** What discovery found, or null before it ran (see {@link PollerOptions.discovered}). */
  get discovery(): PollerDiscovery | null {
    if (this.supported === null) return null;
    return {
      supported: [...this.supported],
      pidsPerRequest: this.maxPids,
      singleFrame: this.answerBudget !== null,
      vinRead: this.vin.read,
    };
  }

  /** The most recent sample of a signal, if any. */
  latest(signal: SignalId): { value: number; at: number } | undefined {
    return this.latestSamples.get(signal);
  }

  /** Read trouble codes at the start of the next cycle (e.g. after clearing them). */
  requestDtcRead(): void {
    this.dtcDueAt = 0;
    this.dtcRequested = true;
    this.sleeper.wake();
  }

  /** Apply config changes that do not need a reconnect. */
  updateOptions(options: {
    customPids?: readonly CustomPidConfig[];
    dtcIntervalMs?: number;
  }): void {
    if (options.customPids) {
      this.setCustomPids(options.customPids);
      if (this.supported) {
        this.buildPidSchedule(this.supported);
        this.announceSupported();
      }
    }
    if (options.dtcIntervalMs !== undefined && Number.isFinite(options.dtcIntervalMs)) {
      this.dtcIntervalMs = Math.max(1000, options.dtcIntervalMs);
      if (this.lastDtcReadAt !== null) {
        this.dtcDueAt = Math.min(this.dtcDueAt, this.lastDtcReadAt + this.dtcIntervalMs);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------------------------

  /**
   * Discover supported PIDs, build the schedule and emit `obd/supported`.
   * @throws ElmError NO_RESPONSE when no ECU answers 0100.
   */
  async discover(): Promise<SignalId[]> {
    const earlier = this.discovered;
    if (earlier !== null) {
      this.discovered = null;
      this.supported = [...earlier.supported];
      this.buildPidSchedule(this.supported);
      if (earlier.singleFrame || earlier.pidsPerRequest < this.maxPids) {
        this.setPidsPerRequest(earlier.pidsPerRequest, null);
      }
      if (earlier.vinRead) this.vin = { ...this.vin, done: true, read: true };
      const signals = this.supportedSignals();
      this.logger.info(`OBD: same vehicle as before; polling ${this.pidItems.length} PIDs`);
      this.announceSupported(true);
      return signals;
    }
    const pids = new Set<number>();
    const visited = new Set<number>();
    let base: number | null = 0x00;
    while (base !== null && !visited.has(base)) {
      visited.add(base);
      const current: number = base;
      const result = await this.withRetries(() => this.driver.queryMode01([current]));
      const answers = result.answers.get(current) ?? [];
      if (current === 0x00 && answers.length === 0) {
        throw new ElmError('NO_RESPONSE', 'The vehicle did not report its supported PIDs');
      }
      let next: number | null = null;
      for (const answer of answers) {
        for (const pid of parseSupportedPids(current, answer.data)) pids.add(pid);
        next ??= nextSupportedPidsBase(current, answer.data);
      }
      base = next;
    }
    const supported = [...pids].filter((pid) => !isSupportedPidsQuery(pid)).sort((a, b) => a - b);
    this.supported = supported;
    this.buildPidSchedule(supported);
    await this.probeMultiPid();

    const signals = this.supportedSignals();
    this.logger.info(
      `OBD: ${supported.length} PIDs supported (${signals.length} signals); polling ${this.pidItems.length}`,
    );
    this.announceSupported(true);
    return signals;
  }

  private supportedSignals(): SignalId[] {
    const provided = new Set<SignalId>(signalsForPids(this.supported ?? []));
    for (const signal of this.customSignals) provided.add(signal);
    if (this.voltageSupported) provided.add('batteryVoltage');
    return SIGNAL_IDS.filter((id) => provided.has(id));
  }

  /** Emit `obd/supported` (after discovery, or when the custom PIDs change what is provided). */
  private announceSupported(always = false): void {
    const signals = this.supportedSignals();
    const key = signals.join(',');
    if (!always && key === this.announcedSignals) return;
    this.announcedSignals = key;
    this.emit({ type: 'obd/supported', signals, at: this.now() });
  }

  private async withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= attempts || isLinkFatal(err) || isVehicleSilence(err) || !isElmError(err)) {
          throw err;
        }
        this.logger.debug(`OBD: retrying after ${errorMessage(err)}`);
      }
    }
  }

  private buildPidSchedule(supported: readonly number[]): void {
    const previous = new Map(this.pidItems.map((item) => [item.pid, item]));
    const polled = supported.filter((pid) => {
      if (!DECODABLE_PIDS.has(pid)) return false;
      const def = MODE01_PIDS.find((d) => d.pid === pid);
      // A custom PID configured for the same signal replaces the standard one.
      return !(def && def.signals.every((signal) => this.customSignals.has(signal)));
    });
    const hasMaf = polled.includes(MAF_PID);
    const fuelFlow = FUEL_FLOW_PIDS.find((pid) => polled.includes(pid)) ?? null;
    this.pidItems = polled.map((pid) => {
      const tier = this.tierOf(pid, hasMaf, fuelFlow);
      const old = previous.get(pid);
      return {
        pid,
        tier,
        intervalMs: this.intervalOf(tier),
        dueAt: old?.dueAt ?? 0,
        empty: old?.empty ?? 0,
        batchFailures: old?.batchFailures ?? 0,
      };
    });
  }

  /**
   * Fast: speed, rpm, throttle, pedal, fuel rate and MAF (MAP without MAF). With one PID per
   * request every PID costs a bus round trip (150–250 ms on K-line), so only speed, rpm and the
   * PID the fuel flow comes from (`fuelFlow`: fuel rate, else MAF, else MAP — 3 s stale limit,
   * and the trip's fuel) stay fast; throttle and pedal (only gear-learning hints on the move)
   * join the medium tier. Otherwise the cycle would take 1.5–2 s and speed would go stale.
   */
  private tierOf(pid: number, hasMaf: boolean, fuelFlow: number | null): Tier {
    const fast = FAST_PIDS.includes(pid) || pid === MAF_PID || (pid === MAP_PID && !hasMaf);
    if (fast) {
      return this.maxPids > 1 || PRIMARY_PIDS.has(pid) || pid === fuelFlow ? 'fast' : 'medium';
    }
    if (MEDIUM_PIDS.includes(pid) || pid === MAP_PID) return 'medium';
    if (VERY_SLOW_PIDS.includes(pid)) return 'verySlow';
    return 'slow';
  }

  private intervalOf(tier: Tier): number {
    switch (tier) {
      case 'fast':
        return 0;
      case 'medium':
        return this.tuning.mediumIntervalMs;
      case 'slow':
        return this.tuning.slowIntervalMs;
      case 'verySlow':
        return this.tuning.verySlowIntervalMs;
    }
  }

  /**
   * Check that multi-PID requests work, with the first fast batch:
   *  - a few ECUs ignore them and answer only the first PID: if a lone query for a missing PID
   *    works, fall back to one PID per request;
   *  - clones without working ISO-TP flow control cannot receive an answer longer than one CAN
   *    frame, so the batch fails (garbled, timed out or "?") — twice, to rule out a hiccup. If
   *    speed and rpm together (a one-frame answer) then work, requests are kept to answers
   *    that fit one frame; if not, one PID per request.
   * Anything else is left to the step-down while polling (see {@link noteBatchFailure}).
   */
  private async probeMultiPid(): Promise<void> {
    const fast = this.pidItems.filter((item) => item.tier === 'fast');
    if (this.maxPids < 2 || fast.length < 2) return;
    const batch = (this.packBatches(fast)[0] ?? []).map((item) => item.pid);
    if (batch.length < 2) return;
    let result: Mode01Result;
    try {
      result = await this.withRetries(() => this.driver.queryMode01(batch), 2);
    } catch (err) {
      if (isLinkFatal(err)) throw err;
      if (!isElmError(err) || isVehicleSilence(err)) {
        this.logger.debug(`OBD: multi-PID probe failed: ${errorMessage(err)}`);
        return;
      }
      await this.probeShortBatch(
        fast.map((item) => item.pid),
        err,
      );
      return;
    }
    if (result.answers.size >= 2) return;
    const missing = batch.find((pid) => !result.answers.has(pid));
    if (missing === undefined) return;
    try {
      const single = await this.driver.queryMode01([missing]);
      if (single.answers.has(missing)) {
        this.setPidsPerRequest(1, 'the ECU ignores multi-PID requests');
      }
    } catch (err) {
      if (isLinkFatal(err)) throw err;
      this.logger.debug(`OBD: multi-PID probe failed: ${errorMessage(err)}`);
    }
  }

  /** After the full fast batch failed: do speed and rpm together (one frame) work? */
  private async probeShortBatch(fast: readonly number[], failure: ElmError): Promise<void> {
    const primary = fast.filter((pid) => PRIMARY_PIDS.has(pid));
    const pair = primary.length === 2 ? primary : fast.slice(0, 2);
    try {
      const result = await this.driver.queryMode01(pair);
      if (result.answers.size >= pair.length) {
        this.setPidsPerRequest(3, `answers longer than one frame fail (${failure.code})`);
        return;
      }
    } catch (err) {
      if (isLinkFatal(err)) throw err;
      this.logger.debug(`OBD: multi-PID probe failed: ${errorMessage(err)}`);
    }
    this.setPidsPerRequest(1, `multi-PID requests fail (${failure.code})`);
  }

  /**
   * Make requests smaller: at most `pids` PIDs, and (below six) only as many as fit a one-frame
   * answer. Logged with `reason` (unless null: known from before) and remembered for the link
   * status.
   */
  private setPidsPerRequest(pids: number, reason: string | null): void {
    this.maxPids = Math.max(1, Math.min(this.maxPids, pids));
    this.answerBudget = SINGLE_FRAME_BYTES;
    // With one PID per request fewer PIDs stay in the fast tier (see `tierOf`).
    if (this.supported) this.buildPidSchedule(this.supported);
    for (const item of this.pidItems) item.batchFailures = 0;
    this.degraded =
      this.maxPids === 1
        ? 'Polling one PID per request (multi-PID requests fail)'
        : `Polling up to ${this.maxPids} PIDs per request (long answers fail)`;
    if (reason !== null) {
      this.logger.warn(
        `OBD: ${reason}; polling ${this.maxPids === 1 ? 'one PID' : `up to ${this.maxPids} PIDs`} per request`,
      );
    }
  }

  /**
   * A multi-PID request failed (or came back with frames missing). Once some PID has been in
   * `batchFailuresBeforeStepDown` such requests in a row without being answered, and a request
   * for it alone works, requests are made smaller: 6 → 3 → 2 → 1 PIDs. A lone request that
   * fails too says the link is bad, not the batching: nothing changes (the error counts).
   */
  private async noteBatchFailure(
    batch: readonly PidItem[],
    unanswered: readonly PidItem[],
  ): Promise<void> {
    for (const item of unanswered) item.batchFailures += 1;
    const suspect = unanswered.find(
      (item) => item.batchFailures >= this.tuning.batchFailuresBeforeStepDown,
    );
    if (suspect === undefined || batch.length < 2) return;
    let single: Mode01Result;
    try {
      single = await this.driver.queryMode01([suspect.pid]);
    } catch (err) {
      suspect.batchFailures = 0;
      this.handleRequestError(err, null, `PID ${hex(suspect.pid)}`);
      return;
    }
    this.consecutiveErrors = 0;
    this.publishResult(single);
    if (!single.answers.has(suspect.pid)) {
      suspect.batchFailures = 0;
      return;
    }
    suspect.empty = 0;
    this.setPidsPerRequest(
      this.maxPids > 3 ? 3 : this.maxPids - 1,
      `requests for ${batch.length} PIDs keep failing`,
    );
    this.emitLink(this.degraded);
  }

  /**
   * Replace the custom PID list. An entry that was already configured keeps its item (and so
   * its schedule and back-off), also while a cycle that planned it is still running.
   */
  private setCustomPids(configs: readonly CustomPidConfig[]): void {
    const previous = new Map(this.customItems.map((item) => [item.key, item]));
    const items: CustomItem[] = [];
    for (const config of configs) {
      const key = customKey(config);
      const intervalMs = Math.max(0, Number.isFinite(config.intervalMs) ? config.intervalMs : 1000);
      const old = previous.get(key);
      if (old) {
        previous.delete(key); // an identical duplicate gets an item of its own
        old.config = config;
        old.intervalMs = intervalMs;
        items.push(old);
        continue;
      }
      try {
        items.push({
          config,
          key,
          evaluate: compileFormula(config.formula),
          intervalMs,
          dueAt: 0,
          empty: 0,
        });
      } catch (err) {
        this.logger.warn(`OBD: skipping custom PID for ${config.signal}: ${errorMessage(err)}`);
      }
    }
    this.customItems = items;
    this.customSignals = new Set(items.map((item) => item.config.signal));
  }

  // -------------------------------------------------------------------------------------------
  // Polling loop
  // -------------------------------------------------------------------------------------------

  /**
   * Poll until {@link stop}. Resolves when stopped; rejects when the session is lost
   * (link failure, adapter reset, or too many consecutive errors).
   */
  async run(): Promise<void> {
    if (this.running) throw new Error('The poller is already running');
    this.running = true;
    this.stopped = false;
    try {
      if (!this.supported) await this.discover();
      if (this.degraded !== null) this.emitLink(this.degraded);
      while (!this.stopped) {
        const started = this.now();
        await this.cycle();
        if (this.stopped) break;
        const interval = this.silent
          ? this.tuning.silentProbeIntervalMs
          : this.tuning.cycleIntervalMs;
        await this.sleeper.sleep(Math.max(0, interval - (this.now() - started)));
      }
    } catch (err) {
      if (!this.stopped) throw err;
    } finally {
      this.running = false;
    }
  }

  /** Stop after the request in flight (the caller closes the driver to abort it). */
  stop(): void {
    this.stopped = true;
    this.sleeper.wake();
  }

  private async cycle(): Promise<void> {
    const now = this.now();
    const outcome: CycleOutcome = { requests: 0, answered: 0 };
    const unanswered: Scheduled[] = [];
    // With one PID per request a trouble-code or VIN read gets a cycle of its own, with only
    // speed and rpm besides, and only one of the two per cycle.
    const onePid = this.maxPids === 1;
    const readDtcs = !this.silent && this.slowReadDue('dtc', now);
    const readVin = !this.silent && !(onePid && readDtcs) && this.slowReadDue('vin', now);
    const lean = onePid && (readDtcs || readVin);

    if (this.silent) {
      // Probe with the PIDs most likely to answer: fast ones that have not been backed off.
      const likely = [...this.pidItems].sort(
        (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.empty - b.empty,
      );
      const probe = this.packBatches(likely)[0];
      if (probe) await this.pollPids(probe, now, unanswered, outcome);
    } else {
      for (const batch of this.planPidRequests(now, lean)) {
        await this.pollPids(batch, now, unanswered, outcome);
      }
      if (!lean) {
        for (const item of this.planCustomRequests(now)) {
          await this.pollCustom(item, now, unanswered, outcome);
        }
      }
    }
    if (this.voltageSupported && this.voltageDueAt <= now) await this.pollVoltage(now);

    this.updateSilence(outcome, unanswered, now);

    if (!this.silent && readDtcs) await this.pollDtcs();
    if (!this.silent && readVin) await this.pollVin();
  }

  /**
   * Whether a due trouble-code or VIN read runs now. With one PID per request either costs
   * several bus round trips (a second or more on K-line), so while the vehicle moves it is put
   * off — for at most `maxReadDeferralMs` — and read at the next stop instead. A read asked for
   * explicitly (after clearing codes) is never put off.
   */
  private slowReadDue(kind: SlowRead, now: number): boolean {
    const due = kind === 'dtc' ? this.dtcDueAt <= now : !this.vin.done && this.vin.dueAt <= now;
    if (!due) return false;
    const speed = this.latestSamples.get('speed');
    const moving =
      speed !== undefined && speed.value > 0 && now - speed.at <= MOVING_SAMPLE_MAX_AGE_MS;
    if (this.maxPids > 1 || !moving || (kind === 'dtc' && this.dtcRequested)) {
      this.deferredSince[kind] = null;
      return true;
    }
    const since = (this.deferredSince[kind] ??= now);
    if (now - since < this.tuning.maxReadDeferralMs) return false;
    this.deferredSince[kind] = null;
    return true;
  }

  /** Emit the values a service 01 request returned (custom PIDs take precedence). */
  private publishResult(result: Mode01Result): void {
    this.publish(
      (Object.entries(result.values) as Array<[SignalId, number]>).filter(
        ([signal, value]) => !this.customSignals.has(signal) && Number.isFinite(value),
      ),
    );
  }

  /** Emit the values one request returned, stamped when it completed. */
  private publish(samples: ReadonlyArray<readonly [SignalId, number]>): void {
    if (samples.length === 0) return;
    const at = this.now();
    for (const [signal, value] of samples) this.latestSamples.set(signal, { value, at });
    this.emit({
      type: 'obd/samples',
      samples: samples.map(([signal, value]) => ({ signal, value })),
      at,
    });
  }

  /**
   * Most overdue first — except that a PID behind a safety alert whose reading is getting old
   * (see {@link KEEP_FRESH_MS}) goes before everything else. When the bus cannot keep up with
   * the medium tier (one PID per request on a car with many PIDs) every PID would otherwise
   * get the same share, and coolant would be read only every 10 s or so.
   */
  private sortedByUrgency<T extends PidItem>(items: readonly T[], now: number): T[] {
    const ageing = (item: T): number => {
      const maxAge = KEEP_FRESH_MS.get(item.pid);
      return maxAge !== undefined && now - (item.dueAt - item.intervalMs) >= maxAge ? 0 : 1;
    };
    return [...items].sort(
      (a, b) => ageing(a) - ageing(b) || a.dueAt - b.dueAt || TIER_RANK[a.tier] - TIER_RANK[b.tier],
    );
  }

  /**
   * Fast PIDs every cycle, plus the most overdue other PIDs within the extra budget. A `lean`
   * cycle — one that reads trouble codes or the VIN with one PID per request — polls speed and
   * rpm only. (The extra budget is not cut with one PID per request: with less, coolant — 10 s
   * stale limit, the overheating alert — would be read only every 8–10 s on a K-line car.)
   */
  private planPidRequests(now: number, lean = false): PidItem[][] {
    const due = this.pidItems.filter((item) => item.dueAt <= now);
    const fast = due.filter((item) => item.tier === 'fast');
    if (lean) return this.packBatches(fast.filter((item) => PRIMARY_PIDS.has(item.pid)));
    const others = this.sortedByUrgency(
      due.filter((item) => item.tier !== 'fast'),
      now,
    );
    const extra = this.packBatches(others).slice(0, this.tuning.extraRequestsPerCycle);
    return [...this.packBatches(fast), ...extra];
  }

  /** The most overdue custom PIDs within their per-cycle budget (ties in config order). */
  private planCustomRequests(now: number): CustomItem[] {
    return this.customItems
      .filter((item) => item.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, Math.max(1, this.tuning.customRequestsPerCycle));
  }

  /**
   * Group PIDs into requests of at most `maxPids` (and, once requests had to be made smaller,
   * with an answer that fits one frame), in order. A variable-length PID can only be parsed as
   * the last PID of a request, so each request holds at most one, placed last.
   */
  private packBatches(items: readonly PidItem[]): PidItem[][] {
    const batches: PidItem[][] = [];
    const budget = this.answerBudget;
    for (const item of items) {
      const variable = VARIABLE_LENGTH_PIDS.has(item.pid);
      const target = batches.find(
        (batch) =>
          batch.length < this.maxPids &&
          (!variable || !batch.some((b) => VARIABLE_LENGTH_PIDS.has(b.pid))) &&
          (budget === null || answerBytes([...batch, item].map((b) => b.pid)) <= budget),
      );
      if (target) target.push(item);
      else batches.push([item]);
    }
    return batches.map((batch) =>
      [...batch].sort(
        (a, b) => Number(VARIABLE_LENGTH_PIDS.has(a.pid)) - Number(VARIABLE_LENGTH_PIDS.has(b.pid)),
      ),
    );
  }

  private async pollPids(
    batch: readonly PidItem[],
    now: number,
    unanswered: Scheduled[],
    outcome: CycleOutcome,
  ): Promise<void> {
    for (const item of batch) item.dueAt = now + item.intervalMs;
    let result: Mode01Result;
    try {
      result = await this.driver.queryMode01(batch.map((item) => item.pid));
    } catch (err) {
      if (batch.length > 1 && isElmError(err) && !isLinkFatal(err) && !isVehicleSilence(err)) {
        // First: a lone request that works resets the error count before this one counts.
        await this.noteBatchFailure(batch, batch);
      }
      this.handleRequestError(err, outcome, `PIDs ${batch.map((i) => hex(i.pid)).join(' ')}`);
      return;
    }
    this.consecutiveErrors = 0;
    outcome.requests += 1;
    if (result.answers.size > 0) outcome.answered += 1;
    const missing: PidItem[] = [];
    for (const item of batch) {
      if (result.answers.has(item.pid)) {
        item.empty = 0;
        item.batchFailures = 0;
      } else {
        missing.push(item);
      }
    }
    this.publishResult(result);
    if (result.incomplete && batch.length > 1 && missing.length > 0) {
      // Frames were lost: the missing PIDs are not known to be unsupported, so they are not
      // backed off, but repeated losses make the requests smaller.
      await this.noteBatchFailure(batch, missing);
    } else {
      unanswered.push(...missing);
    }
  }

  private async pollCustom(
    item: CustomItem,
    now: number,
    unanswered: Scheduled[],
    outcome: CycleOutcome,
  ): Promise<void> {
    item.dueAt = now + item.intervalMs;
    const { mode, pid, header, signal } = item.config;
    let answers: RawAnswer[];
    try {
      answers = await this.driver.raw(mode, pid, header);
    } catch (err) {
      if (isElmError(err, 'NEGATIVE_RESPONSE')) {
        // The module is there but rejects the request: an answer, just not a useful one.
        this.consecutiveErrors = 0;
        outcome.requests += 1;
        outcome.answered += 1;
        unanswered.push(item);
        return;
      }
      if (err instanceof RangeError) {
        // E.g. a header that does not suit the vehicle's bus, which the config cannot know.
        this.logger.warn(`OBD: custom PID for ${signal} is invalid (${err.message}); disabling it`);
        this.setCustomPids(this.customItems.filter((c) => c !== item).map((c) => c.config));
        if (this.supported) {
          // The standard PID it replaced (if any) is polled again.
          this.buildPidSchedule(this.supported);
          this.announceSupported();
        }
        return;
      }
      this.handleRequestError(err, outcome, `custom PID ${mode}${pid} (${signal})`);
      return;
    }
    this.consecutiveErrors = 0;
    outcome.requests += 1;
    const first = answers[0];
    if (!first) {
      unanswered.push(item);
      return;
    }
    outcome.answered += 1;
    const value = item.evaluate(first.data);
    if (Number.isFinite(value)) {
      item.empty = 0;
      this.publish([[signal, value]]);
    } else {
      unanswered.push(item);
    }
  }

  private async pollVoltage(now: number): Promise<void> {
    this.voltageDueAt = now + this.tuning.voltageIntervalMs;
    try {
      const volts = await this.driver.readVoltage();
      // No reset of consecutiveErrors: the adapter answering says nothing about the vehicle.
      if (volts !== null) this.publish([['batteryVoltage', volts]]);
    } catch (err) {
      this.handleRequestError(err, null, 'battery voltage');
    }
  }

  private async pollDtcs(): Promise<void> {
    this.dtcRequested = false;
    try {
      const report = await this.driver.readDtcs();
      this.consecutiveErrors = 0;
      const at = this.now();
      this.lastDtcReadAt = at;
      this.dtcDueAt = at + this.dtcIntervalMs;
      this.emit({ type: 'obd/dtcs', ...report, at });
    } catch (err) {
      this.dtcDueAt = this.now() + this.tuning.dtcRetryMs;
      this.handleRequestError(err, null, 'trouble codes');
      if (!isVehicleSilence(err)) await this.pollMil();
    }
  }

  /**
   * The MIL state alone (service 01 PID 01: a one-frame answer), after a trouble-code read
   * failed — e.g. a clone that cannot receive a service 03 answer with three or more codes, or
   * a control unit that keeps answering "busy". Reported as an incomplete `obd/dtcs`: the HUD
   * keeps the codes it knows and learns that the lamp is on.
   */
  private async pollMil(): Promise<void> {
    let result: Mode01Result;
    try {
      result = await this.driver.queryMode01([MIL_PID]);
    } catch (err) {
      this.handleRequestError(err, null, 'MIL status');
      return;
    }
    this.consecutiveErrors = 0;
    const statuses = (result.answers.get(MIL_PID) ?? []).flatMap((answer) => {
      const status = parseMonitorStatus(answer.data);
      return status === null ? [] : [status];
    });
    if (statuses.length === 0) return;
    this.emit({
      type: 'obd/dtcs',
      complete: false,
      milOn: statuses.some((status) => status.milOn),
      stored: [],
      pending: [],
      permanent: [],
      at: this.now(),
    });
  }

  private async pollVin(): Promise<void> {
    this.vin.attempts += 1;
    try {
      const vin = await this.driver.readVin();
      this.consecutiveErrors = 0;
      this.vin.done = true;
      this.vin.read = true;
      if (vin) this.emit({ type: 'obd/vin', vin, at: this.now() });
    } catch (err) {
      this.vin.done = this.vin.attempts >= this.tuning.vinAttempts;
      this.vin.dueAt = this.now() + this.tuning.vinRetryMs;
      this.handleRequestError(err, null, 'VIN');
    }
  }

  /**
   * Classify a failed request: link-fatal errors end the session; "vehicle silent" errors count
   * as unanswered requests; anything else counts towards the consecutive-error limit.
   */
  private handleRequestError(err: unknown, outcome: CycleOutcome | null, what: string): void {
    if (isLinkFatal(err)) throw err;
    if (isVehicleSilence(err)) {
      if (outcome) outcome.requests += 1;
      return;
    }
    this.consecutiveErrors += 1;
    this.logger.debug(`OBD: ${what} failed: ${errorMessage(err)}`);
    if (this.consecutiveErrors >= this.tuning.maxConsecutiveErrors) {
      throw new ElmError(
        'DESYNC',
        `The adapter keeps failing (${this.consecutiveErrors} errors in a row; last: ${errorMessage(err)})`,
        { cause: err },
      );
    }
  }

  private updateSilence(
    outcome: CycleOutcome,
    unanswered: readonly Scheduled[],
    now: number,
  ): void {
    if (outcome.requests === 0) return;
    if (outcome.answered === 0) {
      // Nothing answered: the vehicle is off, not the individual PIDs unsupported.
      this.silentCycles += 1;
      if (!this.silent && this.silentCycles >= this.tuning.silentAfterCycles) {
        this.silent = true;
        this.logger.info('OBD: the vehicle stopped answering; probing slowly');
        this.emitLink('No response from the vehicle (ignition off?)');
      }
      return;
    }
    this.silentCycles = 0;
    if (this.silent) {
      this.silent = false;
      this.logger.info('OBD: the vehicle is answering again');
      for (const item of this.pidItems) item.dueAt = Math.min(item.dueAt, now);
      this.dtcDueAt = Math.min(this.dtcDueAt, now);
      this.emitLink(this.degraded);
    }
    for (const item of unanswered) this.backOff(item, now);
  }

  private backOff(item: Scheduled, now: number): void {
    item.empty += 1;
    const over = item.empty - this.tuning.backoffAfterEmpty;
    if (over < 0) return;
    const base = Math.max(item.intervalMs, 1000);
    item.dueAt = now + Math.min(this.tuning.maxBackoffMs, base * 2 ** over);
  }

  private emitLink(message: string | null): void {
    this.emit({
      type: 'obd/link',
      state: 'connected',
      adapter: this.link.adapter,
      protocol: this.link.protocol,
      message,
      at: this.now(),
    });
  }
}

const hex = (pid: number): string => pid.toString(16).toUpperCase().padStart(2, '0');
