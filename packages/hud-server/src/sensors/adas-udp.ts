/**
 * ADAS module feed: newline-delimited JSON datagrams on `sensors.adasUdpPort`, e.g.
 *   {"t":"blind-spot","left":true,"right":false}
 *   {"t":"collision","level":"warning","ttcSeconds":1.4}
 *   {"t":"heartbeat"}
 * Each line is validated with `parseAdasMessage`. The module counts as connected from its first
 * valid message until 2 s pass without one.
 *
 * Only senders listed in `sensors.adasAllowedSenders` are heard (an empty list accepts anyone,
 * with a warning); other datagrams are dropped unread, counted and reported at most every 10 s.
 * Each sender has its own datagram budget, so a flood from one device cannot starve another,
 * and oversize datagrams are dropped. The source address of a UDP datagram is not proof of who
 * sent it (anyone on the same network segment can forge it), so the list keeps out mistakes and
 * casual meddling, not a determined attacker.
 */
import { createSocket, type RemoteInfo } from 'node:dgram';
import {
  normalizeIpAddress,
  parseAdasMessage,
  type AdasMessage,
  type HudConfig,
  type HudEvent,
} from '@carheadsup/core';
import type { EventSource, SourceContext } from '../sources/types.ts';
import { OnceLogger, TokenBucket, errorCode, errorMessage } from './util.ts';

/** The module is considered gone after this long without a valid message. */
export const ADAS_SILENCE_MS = 2000;
/** Datagrams larger than this are ignored unread. */
export const ADAS_MAX_DATAGRAM_BYTES = 4096;
/** At most this many messages are taken from one datagram. */
export const ADAS_MAX_LINES_PER_DATAGRAM = 8;
/** Sustained datagram rate accepted from each sender (bursts up to the same number). */
export const ADAS_MAX_DATAGRAMS_PER_S = 50;
/**
 * Senders whose datagram budget is tracked; beyond this the one silent for longest is forgotten
 * (and starts afresh if it returns). With an allow-list this is never reached (the schema caps
 * the list at 32); it bounds memory when any sender is accepted.
 */
export const ADAS_MAX_TRACKED_SENDERS = 64;
/** Minimum interval between repeated warnings about bad traffic. */
const WARN_INTERVAL_MS = 10_000;
const BIND_RETRY_MS = 10_000;

/** The part of `dgram.Socket` used here. */
export interface UdpSocketLike {
  on(event: 'message', listener: (msg: Buffer, rinfo: RemoteInfo) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  bind(port: number, address: string, callback: () => void): unknown;
  address(): { port: number };
  close(callback?: () => void): unknown;
}

export type UdpSocketFactory = () => UdpSocketLike;

export const defaultUdpSocketFactory: UdpSocketFactory = () => createSocket({ type: 'udp4' });

/**
 * The allow-list form of a datagram's source address: canonical (see `normalizeIpAddress`, so a
 * dual-stack socket's `::ffff:10.42.0.50` is `10.42.0.50`), without the zone index Node appends
 * to link-local IPv6 addresses (`fe80::1%wlan0`).
 */
function senderKey(address: string): string {
  const zone = address.indexOf('%');
  const bare = zone === -1 ? address : address.slice(0, zone);
  return normalizeIpAddress(bare) ?? bare;
}

/** `sensors.adasAllowedSenders` in canonical form; `null` = any sender. */
type SenderFilter = ReadonlySet<string> | null;

function senderFilter(list: readonly string[]): SenderFilter {
  // A non-empty list whose entries all fail to parse (the schema prevents it) accepts no one:
  // an unreadable list must not open the feed to everybody.
  if (list.length === 0) return null;
  const allowed = new Set<string>();
  for (const entry of list) {
    const address = normalizeIpAddress(entry);
    if (address !== null) allowed.add(address);
  }
  return allowed;
}

function sameFilter(a: SenderFilter, b: SenderFilter): boolean {
  if (a === null || b === null) return a === b;
  return a.size === b.size && [...a].every((address) => b.has(address));
}

/** Whether `next` refuses a sender that `previous` accepted. */
function narrows(previous: SenderFilter, next: SenderFilter): boolean {
  if (next === null) return false;
  if (previous === null) return true;
  return [...previous].some((address) => !next.has(address));
}

function describeFilter(filter: ReadonlySet<string>): string {
  return filter.size === 0 ? 'no valid address' : [...filter].join(', ');
}

const ANY_SENDER_WARNING =
  "ADAS feed: accepting datagrams from any device on the network, so anyone on the car's Wi-Fi can raise or hide collision warnings; list the module's address in sensors.adasAllowedSenders";

/** HUD events for one validated ADAS message (heartbeats only keep the link alive). */
export function adasMessageToEvents(message: AdasMessage, at: number): HudEvent[] {
  switch (message.t) {
    case 'blind-spot':
      return [{ type: 'adas/blind-spot', left: message.left, right: message.right, at }];
    case 'collision':
      return [
        {
          type: 'adas/collision',
          level: message.level,
          ttcSeconds: message.ttcSeconds ?? null,
          at,
        },
      ];
    case 'heartbeat':
      return [];
  }
}

export interface AdasUdpSourceOptions {
  createSocket: UdpSocketFactory;
  /** Bind address; default all interfaces (the module sits on the car's network). */
  bindAddress?: string;
}

export class AdasUdpSource implements EventSource {
  readonly name = 'adas-udp';
  private readonly options: AdasUdpSourceOptions;
  private port: number | null;
  private senders: SenderFilter;
  private ctx: SourceContext | null = null;
  private log: OnceLogger | null = null;
  private socket: UdpSocketLike | null = null;
  private bound = false;
  private connected = false;
  private silenceTimer: unknown = null;
  private retryTimer: unknown = null;
  /** Datagram budget per sender, least recently seen first. */
  private readonly buckets = new Map<string, TokenBucket>();
  private dropped = 0;
  private invalid = 0;
  private lastWarnAt = -Infinity;
  private rejected = 0;
  private lastRejectWarnAt = -Infinity;

  constructor(config: HudConfig, options: AdasUdpSourceOptions) {
    this.options = options;
    this.port = config.sensors.adasUdpPort;
    this.senders = senderFilter(config.sensors.adasAllowedSenders);
  }

  /** The bound UDP port (useful with port 0), or null when not listening. */
  get boundPort(): number | null {
    if (!this.bound || this.socket === null) return null;
    try {
      return this.socket.address().port;
    } catch {
      return null;
    }
  }

  async start(ctx: SourceContext): Promise<void> {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.log = new OnceLogger(ctx.logger);
    this.buckets.clear();
    await this.listen();
  }

  async stop(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx !== null) {
      if (this.retryTimer !== null) ctx.timers.clearTimeout(this.retryTimer);
      if (this.silenceTimer !== null) ctx.timers.clearTimeout(this.silenceTimer);
    }
    this.retryTimer = null;
    this.silenceTimer = null;
    this.connected = false;
    this.buckets.clear();
    await this.closeSocket();
  }

  /**
   * Only a port change rebinds the socket. A new sender list applies at once; if it refuses a
   * sender the old one accepted, the link restarts, so readings from a device no longer allowed
   * stop counting now rather than when they expire (an allowed module reconnects with its next
   * message).
   */
  async updateConfig(config: HudConfig): Promise<void> {
    const senders = senderFilter(config.sensors.adasAllowedSenders);
    const previous = this.senders;
    const sendersChanged = !sameFilter(previous, senders);
    if (sendersChanged) {
      this.senders = senders;
      for (const sender of [...this.buckets.keys()]) {
        if (!this.accepts(sender)) this.buckets.delete(sender);
      }
    }
    const port = config.sensors.adasUdpPort;
    if (port === this.port) {
      if (sendersChanged) this.applySenders(narrows(previous, senders));
      return;
    }
    this.port = port;
    const ctx = this.ctx;
    if (ctx === null) return;
    if (this.retryTimer !== null) ctx.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.closeSocket();
    this.markSilent();
    this.log?.reset();
    await this.listen();
  }

  private async listen(): Promise<void> {
    const ctx = this.ctx;
    const port = this.port;
    if (ctx === null || port === null) return;
    const socket = this.options.createSocket();
    this.socket = socket;
    const bindAddress = this.options.bindAddress ?? '0.0.0.0';
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          this.log?.warn(
            'bind',
            `ADAS feed: cannot listen on UDP ${bindAddress}:${port} (${errorCode(err) ?? errorMessage(err)}); retrying every ${BIND_RETRY_MS / 1000} s`,
          );
          resolve(false);
          return;
        }
        ctx.logger.warn(`ADAS feed: socket error: ${errorMessage(err)}`);
      });
      socket.on('message', (msg, rinfo) => this.onDatagram(socket, msg, rinfo));
      // Closed (stop / reconfigure) before the bind completed.
      socket.on('close', () => {
        if (settled) return;
        settled = true;
        resolve(false);
      });
      try {
        socket.bind(port, bindAddress, () => {
          if (settled) return;
          settled = true;
          resolve(true);
        });
      } catch (err) {
        settled = true;
        this.log?.warn(
          'bind',
          `ADAS feed: cannot listen on UDP port ${port}: ${errorMessage(err)}`,
        );
        resolve(false);
      }
    });
    if (this.socket !== socket || this.ctx !== ctx) {
      // Stopped or reconfigured while binding.
      if (ok) closeQuietly(socket);
      return;
    }
    if (!ok) {
      this.socket = null;
      closeQuietly(socket);
      this.retryTimer = ctx.timers.setTimeout(() => {
        this.retryTimer = null;
        void this.listen();
      }, BIND_RETRY_MS);
      return;
    }
    this.bound = true;
    this.log?.reset('bind');
    const listening = `ADAS feed: listening on UDP ${bindAddress}:${this.boundPort ?? port}`;
    const senders = this.senders;
    if (senders === null) {
      ctx.logger.info(listening);
      this.log?.warn('any-sender', ANY_SENDER_WARNING);
    } else {
      ctx.logger.info(`${listening}, accepting only ${describeFilter(senders)}`);
    }
  }

  private accepts(sender: string): boolean {
    return this.senders === null || this.senders.has(sender);
  }

  /** Apply a changed sender list to the running feed (same port). */
  private applySenders(narrowed: boolean): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    if (narrowed) this.markSilent();
    if (!this.bound) return; // listen() reports the list once the port is open
    const senders = this.senders;
    if (senders === null) {
      this.log?.warn('any-sender', ANY_SENDER_WARNING);
    } else {
      this.log?.reset('any-sender');
      ctx.logger.info(`ADAS feed: now accepting only ${describeFilter(senders)}`);
    }
  }

  /** The sender's datagram budget, created (forgetting the longest-silent sender) if new. */
  private bucketFor(ctx: SourceContext, sender: string): TokenBucket {
    let bucket = this.buckets.get(sender);
    if (bucket === undefined) {
      if (this.buckets.size >= ADAS_MAX_TRACKED_SENDERS) {
        const oldest = this.buckets.keys().next();
        if (oldest.done !== true) this.buckets.delete(oldest.value);
      }
      bucket = new TokenBucket(ADAS_MAX_DATAGRAMS_PER_S, ADAS_MAX_DATAGRAMS_PER_S, ctx.now);
    } else {
      this.buckets.delete(sender); // re-inserted below as the most recently seen
    }
    this.buckets.set(sender, bucket);
    return bucket;
  }

  private onDatagram(socket: UdpSocketLike, msg: Buffer, rinfo: RemoteInfo): void {
    const ctx = this.ctx;
    if (ctx === null || socket !== this.socket) return;
    const sender = senderKey(rinfo.address);
    if (!this.accepts(sender)) {
      this.rejected += 1;
      this.warnRejected(ctx, sender);
      return;
    }
    if (!this.bucketFor(ctx, sender).take()) {
      this.dropped += 1;
      this.warnTraffic(ctx, `rate limit exceeded by ${sender}`);
      return;
    }
    if (msg.length > ADAS_MAX_DATAGRAM_BYTES) {
      this.dropped += 1;
      this.warnTraffic(ctx, `oversize datagram (${msg.length} bytes) from ${sender}`);
      return;
    }
    const lines = msg
      .toString('utf8')
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.trim().length > 0);
    let valid = 0;
    for (const line of lines.slice(0, ADAS_MAX_LINES_PER_DATAGRAM)) {
      const parsed = parseAdasMessage(line);
      if (!parsed.ok) {
        this.invalid += 1;
        this.warnTraffic(ctx, `invalid message from ${sender}: ${parsed.error}`);
        continue;
      }
      valid += 1;
      const at = ctx.now();
      if (!this.connected) {
        this.connected = true;
        ctx.logger.info(`ADAS feed: module connected (${sender})`);
        ctx.emit({ type: 'adas/link', connected: true, at });
      }
      for (const event of adasMessageToEvents(parsed.value, at)) ctx.emit(event);
    }
    if (lines.length > ADAS_MAX_LINES_PER_DATAGRAM) {
      this.dropped += lines.length - ADAS_MAX_LINES_PER_DATAGRAM;
      this.warnTraffic(ctx, `too many messages in one datagram (${lines.length})`);
    }
    if (valid > 0) this.armSilenceTimer(ctx);
  }

  private armSilenceTimer(ctx: SourceContext): void {
    if (this.silenceTimer !== null) ctx.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = ctx.timers.setTimeout(() => {
      this.silenceTimer = null;
      if (this.ctx !== ctx || !this.connected) return;
      this.connected = false;
      ctx.logger.warn(`ADAS feed: no data for ${ADAS_SILENCE_MS / 1000} s; module disconnected`);
      ctx.emit({ type: 'adas/link', connected: false, at: ctx.now() });
    }, ADAS_SILENCE_MS);
  }

  /** Emit a disconnect (e.g. before rebinding to a new port). */
  private markSilent(): void {
    const ctx = this.ctx;
    if (ctx !== null && this.silenceTimer !== null) ctx.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    if (ctx !== null && this.connected)
      ctx.emit({ type: 'adas/link', connected: false, at: ctx.now() });
    this.connected = false;
  }

  /** Warn about bad traffic at most every 10 s, with counts of what was dropped since. */
  private warnTraffic(ctx: SourceContext, detail: string): void {
    const now = ctx.now();
    if (Math.abs(now - this.lastWarnAt) < WARN_INTERVAL_MS) return; // abs: a clock stepped back
    this.lastWarnAt = now;
    ctx.logger.warn(
      `ADAS feed: ${detail} (dropped ${this.dropped}, invalid ${this.invalid} since the last warning)`,
    );
    this.dropped = 0;
    this.invalid = 0;
  }

  /** Report datagrams from senders not on the list at most every 10 s, with a count. */
  private warnRejected(ctx: SourceContext, sender: string): void {
    const now = ctx.now();
    if (Math.abs(now - this.lastRejectWarnAt) < WARN_INTERVAL_MS) return;
    this.lastRejectWarnAt = now;
    ctx.logger.warn(
      `ADAS feed: ignoring datagrams from ${sender}, which is not in sensors.adasAllowedSenders (${this.rejected} ignored since the last warning)`,
    );
    this.rejected = 0;
  }

  private async closeSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    const wasBound = this.bound;
    this.bound = false;
    if (socket === null) return;
    if (!wasBound) {
      closeQuietly(socket);
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}

function closeQuietly(socket: UdpSocketLike): void {
  try {
    socket.close();
  } catch {
    // already closed
  }
}
